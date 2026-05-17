import * as fs from 'node:fs'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { Connect, Plugin } from 'vite'/**
 * In-process edge-function dev server.
 *
 * Replaces `netlify dev` so we run on a single Vite port and don't need
 * a Deno proxy in the loop. Each file under `netlify/edge-functions/`
 * (excluding `_lib`) is treated as one HTTP route mounted under
 * `/api/<file-stem>`. The file's default export is invoked with a
 * standard `Request` and is expected to return a `Response`.
 *
 * Mounting rules:
 *   - `netlify/edge-functions/tasks.ts`     → `/api/tasks` and `/api/tasks/*`
 *   - `netlify/edge-functions/habits.ts`    → `/api/habits` and `/api/habits/*`
 *   - `netlify/edge-functions/chat.ts`      → `/api/chat` and `/api/chat/*`
 *   - `netlify/edge-functions/ai.ts`        → `/api/ai/*`
 *   - `netlify/edge-functions/profile.ts`   → `/api/profile`
 *   - `netlify/edge-functions/pomodoro.ts`  → `/api/pomodoro/*`
 *   - `netlify/edge-functions/review.ts`    → `/api/review`
 *   - `netlify/edge-functions/briefing.ts`  → `/api/briefing`
 *   - `netlify/edge-functions/notebooks.ts` → `/api/notebooks`, `/api/notebooks/*`
 *
 * (The handlers themselves do further sub-routing on the URL pathname,
 * e.g. `tasks.ts` matches `/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/completion`,
 * etc.)
 *
 * The plugin shims `globalThis.Deno.env` to read from `process.env`
 * so the existing edge functions (which use `Deno.env.get(...)`)
 * keep working unchanged. Production deploy targets — Netlify or
 * otherwise — get a real Deno runtime, no shim.
 */
export function edgeFunctionsPlugin(opts?: {
  /** Absolute path to the edge-functions directory. */
  edgeDir?: string
}): Plugin {
  const edgeDir =
    opts?.edgeDir ?? path.resolve(process.cwd(), 'netlify/edge-functions')

  return {
    name: 'edge-functions-dev',
    apply: 'serve',
    /**
     * Edge functions use Deno's explicit-extension import style
     * (`import { … } from './_lib/handler.ts'`). Vite's SSR resolver
     * doesn't follow `.ts` extensions on relative imports. Rather
     * than fight Vite's resolver pipeline, we rewrite each relative
     * `.ts`/`.tsx` import in the source code to an absolute file
     * URL so SSR has nothing to resolve. Real Deno in production
     * never sees this transform — production deploys don't run
     * the dev plugin.
     */
    enforce: 'pre',
    transform(code, id, options) {
      if (!options?.ssr) return null
      const normalized = id.startsWith('file://') ? new URL(id).pathname : id
      const inEdge =
        normalized.includes('netlify/edge-functions') ||
        normalized.includes('netlify\\edge-functions')
      const inShared =
        normalized.includes('src/shared') ||
        normalized.includes('src\\shared')
      if (!inEdge && !inShared) return null

      const importerDir = path.dirname(normalized)

      // Match every relative `from '<rel>.ts(x)?'` and replace the
      // path with an absolute POSIX path. Vite normalizes its module
      // ids that way, so the SSR loader will see this as a known id
      // and run our `transform` again on the target file. We do NOT
      // emit a `file://` URL — that would route through Node's native
      // ESM loader, which has no `.ts` plugin.
      const out = code.replace(
        /(from\s*['"])(\.{1,2}\/[^'"]+\.tsx?)(['"])/g,
        (_full, pre, rel, post) => {
          const abs = path.resolve(importerDir, rel)
          if (!fs.existsSync(abs)) return _full
          // Forward slashes throughout, but keep the drive letter so
          // Windows path equality still works in Vite's module graph.
          const id = abs.replace(/\\/g, '/')
          return `${pre}/@fs/${id}${post}`
        },
      )
      if (out === code) return null
      return { code: out, map: null }
    },
    async configureServer(server) {
      // Install the Deno shim once per dev session. process.env is
      // populated below, then `Deno.env.get(k)` forwards to it.
      loadEnvFile()
      installDenoShim()

      // Discover every top-level handler file. Underscored helpers
      // (`_lib/*`) are imports, not routes, so we skip them.
      const files = fs
        .readdirSync(edgeDir)
        .filter(
          (name) =>
            (name.endsWith('.ts') || name.endsWith('.tsx')) &&
            !name.startsWith('_'),
        )
        .map((name) => ({
          name: path.basename(name, path.extname(name)),
          file: path.join(edgeDir, name),
        }))

      const handlers = new Map<string, (req: Request) => Promise<Response>>()
      for (const { name, file } of files) {
        try {
          const mod = await server.ssrLoadModule(file)
          const handler = (mod.default ??
            mod.handler) as unknown
          if (typeof handler !== 'function') {
            console.warn(
              `[edge-dev] ${name}: no default export, skipping`,
            )
            continue
          }
          handlers.set(name, handler as (req: Request) => Promise<Response>)
          // Stamp success once at boot so the dev terminal shows a
          // similar log to what `netlify dev` used to print.
          console.log(`[edge-dev] mounted /api/${name}`)
        } catch (err) {
          console.error(`[edge-dev] failed to load ${name}:`, err)
        }
      }

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/')) return next()

        // First path segment after `/api/` selects the handler file.
        // We then dispatch the full Request — the handler does its
        // own per-route matching internally.
        const trimmed = url.replace(/^\/api\//, '')
        const segment = trimmed.split('/')[0].split('?')[0]
        const handler = handlers.get(segment)
        if (!handler) return next()

        try {
          const fetchReq = await nodeReqToFetchRequest(req)
          const fetchRes = await handler(fetchReq)
          await pipeFetchResponseToNode(fetchRes, res)
        } catch (err) {
          console.error(`[edge-dev] ${segment} handler crashed:`, err)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
            res.end(
              JSON.stringify({
                code: 'internal_error',
                message: 'Edge function crashed (see dev console)',
              }),
            )
          } else {
            res.end()
          }
        }
      })

      // HMR: when an edge function or its lib changes, re-import the
      // affected module so the next request gets the fresh handler.
      server.watcher.on('change', async (changed) => {
        if (!changed.startsWith(edgeDir)) return

        // Helper: invalidate the cached SSR module *and* its importers
        // before re-loading. Without this Vite's `ssrLoadModule` returns
        // the previous instance, which is why edits to `_lib/*.ts` look
        // like they don't take effect.
        const invalidate = (file: string) => {
          const mod = server.moduleGraph.getModuleById(
            file.replace(/\\/g, '/'),
          )
          if (mod) {
            server.moduleGraph.invalidateModule(mod)
          }
        }

        const top = files.find(
          ({ file }) => path.resolve(file) === path.resolve(changed),
        )
        if (top) {
          invalidate(top.file)
          try {
            const mod = await server.ssrLoadModule(top.file, { fixStacktrace: true })
            const handler = (mod.default ??
              mod.handler) as (req: Request) => Promise<Response>
            handlers.set(top.name, handler)
            console.log(`[edge-dev] reloaded /api/${top.name}`)
          } catch (err) {
            console.error(`[edge-dev] reload failed for ${top.name}:`, err)
          }
          return
        }

        // Library / shared file changed → invalidate every handler so
        // they pick up the new code on the next request.
        if (
          changed.includes('_lib') ||
          changed.includes('shared') ||
          changed.endsWith('.ts')
        ) {
          // Invalidate the changed lib first, then every handler that
          // could import it. We don't try to be clever about which
          // handlers actually import what — re-loading them all is
          // cheap during dev.
          invalidate(changed)
          for (const { name, file } of files) {
            invalidate(file)
            try {
              const mod = await server.ssrLoadModule(file)
              const handler = (mod.default ??
                mod.handler) as (req: Request) => Promise<Response>
              handlers.set(name, handler)
            } catch {
              // tolerate transient errors during typing
            }
          }
          console.log(`[edge-dev] reloaded all handlers (lib changed: ${path.basename(changed)})`)
        }
      })
    },
  }
}

// ─── Node ⇄ Fetch bridges ───────────────────────────────────────────────────

async function nodeReqToFetchRequest(req: IncomingMessage): Promise<Request> {
  const protocol =
    (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
  const host = req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `${protocol}://${host}`)

  const method = (req.method ?? 'GET').toUpperCase()
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value == null) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(name, v)
    } else {
      headers.set(name, value)
    }
  }

  // GET/HEAD have no body; everything else gets buffered then re-emitted.
  let body: BodyInit | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    if (chunks.length > 0) body = Buffer.concat(chunks)
  }

  return new Request(url.toString(), {
    method,
    headers,
    body,
  })
}

async function pipeFetchResponseToNode(
  fetchRes: Response,
  res: ServerResponse,
): Promise<void> {
  res.statusCode = fetchRes.status
  fetchRes.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  if (!fetchRes.body) {
    res.end()
    return
  }

  // ReadableStream → Node Readable.
  const nodeStream = Readable.fromWeb(
    fetchRes.body as unknown as Parameters<typeof Readable.fromWeb>[0],
  )
  nodeStream.pipe(res)
  await new Promise<void>((resolve, reject) => {
    nodeStream.on('end', resolve)
    nodeStream.on('error', reject)
    res.on('error', reject)
  })
}

// ─── Deno shim ──────────────────────────────────────────────────────────────

let envLoaded = false

/**
 * Hand-rolled `.env` loader.
 *
 * Vite only injects `VITE_*` env vars into the client bundle; nothing
 * automatically pushes the rest into `process.env` for SSR modules.
 * Edge functions need server-side keys (`TURSO_AUTH_TOKEN`,
 * `SUPABASE_URL`, `MISTRAL_API_KEY`, etc.) so we read `.env` directly
 * and stamp every key into `process.env` before the Deno shim wraps it.
 *
 * We don't pull in the `dotenv` package because we already have one
 * in the project (it's a transitive dep of @libsql/client) and bundlers
 * have trouble plumbing native `.env` parsing into Vite plugin code.
 * The format is simple enough to parse inline.
 */
function loadEnvFile() {
  if (envLoaded) return
  envLoaded = true

  const envPath = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(envPath)) return
  const raw = fs.readFileSync(envPath, 'utf-8')

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    // Strip optional surrounding quotes.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = val
    }
  }
}

let denoShimInstalled = false
function installDenoShim() {
  if (denoShimInstalled) return
  denoShimInstalled = true

  // Edge functions read env via `Deno.env.get(...)`. Vite already loaded
  // .env into process.env, so we forward each lookup. This keeps the
  // edge code identical between the Vite-driven dev path and the real
  // Deno production runtime.
  const denoLike = {
    env: {
      get: (k: string) => process.env[k],
      set: (k: string, v: string) => {
        process.env[k] = v
      },
      has: (k: string) => k in process.env,
      delete: (k: string) => {
        delete process.env[k]
      },
      toObject: () => ({ ...process.env }),
    },
  }

  if (typeof (globalThis as { Deno?: unknown }).Deno === 'undefined') {
    Object.defineProperty(globalThis, 'Deno', {
      value: denoLike,
      writable: false,
      configurable: false,
    })
  }
}

// Helper used solely so the type-checker imports `Connect` somewhere
// when bundlers strip unused type-only imports.
type _UnusedConnect = Connect.Server
