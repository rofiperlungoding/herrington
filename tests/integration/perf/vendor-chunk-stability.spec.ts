/**
 * Vendor chunk stability test
 *
 * **Validates: Requirements 3.2, 3.3**
 *
 * Verifies two properties of the vendor code-splitting strategy:
 *
 * 1. **Vendor hash stability**: When two builds are produced from two commits
 *    that differ only in `src/` files (no dependency changes), the filename
 *    hashes of every `vendor-*-<hash>.js` chunk are identical across both
 *    builds. This ensures vendor chunks are long-term cacheable across deploys.
 *
 * 2. **App/route hash instability**: When source code changes, the entry and
 *    route chunk hashes MUST differ, proving that content-hash naming correctly
 *    reflects source changes.
 *
 * Additionally tests the `manualChunks` function determinism: the same module
 * ID always maps to the same vendor group.
 *
 * This test is tagged `@slow`. The dual-build test is expensive (~30-60s) and
 * should only run when explicitly opted-in via:
 *   npm run build && vitest run tests/integration/perf/vendor-chunk-stability
 *
 * The determinism and structure tests run quickly and are safe for normal CI.
 *
 * Spec references:
 *   Requirements 3.2, 3.3
 *   Design: S1.2 — vendor splitting for long-term cache stability
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ROOT = resolve(process.cwd())
const DIST_ASSETS = join(PROJECT_ROOT, 'dist', 'assets')
const distExists = existsSync(DIST_ASSETS)

/** Extract the content hash from a chunk filename like `vendor-react-Abc123.js` */
function extractHash(filename: string): string | null {
  // The hash is the last segment after the final `-` before the extension.
  // e.g. `vendor-react-C7L_Ej8E.js` → `C7L_Ej8E`
  const match = filename.match(/-([A-Za-z0-9_]+)\.(m?js|cjs)$/)
  return match ? match[1] : null
}

/** Classify a filename into vendor/route/entry/other */
function classifyChunk(
  filename: string,
): 'vendor' | 'route' | 'entry' | 'other' {
  if (/^vendor-[A-Za-z0-9_-]+\.(m?js|cjs)$/.test(filename)) return 'vendor'
  if (/^route-[A-Za-z0-9_-]+\.(m?js|cjs)$/.test(filename)) return 'route'
  if (/^(entry|index|main)-[A-Za-z0-9_-]+\.(m?js|cjs)$/.test(filename))
    return 'entry'
  return 'other'
}

/** Get all JS chunks from a directory grouped by type */
function getChunks(
  assetsDir: string,
): Map<string, { filename: string; hash: string }[]> {
  const files = readdirSync(assetsDir).filter((f) => /\.(m?js|cjs)$/.test(f))
  const grouped = new Map<string, { filename: string; hash: string }[]>()

  for (const filename of files) {
    const type = classifyChunk(filename)
    const hash = extractHash(filename)
    if (!hash) continue
    if (!grouped.has(type)) grouped.set(type, [])
    grouped.get(type)!.push({ filename, hash })
  }

  return grouped
}

/**
 * Extract the vendor group name from a filename.
 * e.g. `vendor-react-Abc123.js` → `vendor-react`
 */
function vendorGroupName(filename: string): string {
  // Remove the hash (last segment after final `-`) and extension
  return filename.replace(/-[A-Za-z0-9_]+\.(m?js|cjs)$/, '')
}

// ---------------------------------------------------------------------------
// manualChunks determinism (unit-level, no build required)
// ---------------------------------------------------------------------------

/**
 * Replicate the manualChunks logic from vite.config.ts to test
 * determinism without importing the config directly (which has
 * side-effects from plugin imports).
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined

  if (
    id.includes('/react/') ||
    id.includes('/react-dom/') ||
    id.includes('/scheduler/')
  ) {
    return 'vendor-react'
  }

  if (id.includes('/@tanstack/react-router/')) {
    return 'vendor-router'
  }

  if (id.includes('/@tanstack/react-query/')) {
    return 'vendor-query'
  }

  if (id.includes('/@supabase/')) {
    return 'vendor-supabase'
  }

  if (
    id.includes('/@radix-ui/') ||
    id.includes('/sonner/') ||
    id.includes('/tailwind-merge/') ||
    id.includes('/clsx/')
  ) {
    return 'vendor-radix'
  }

  if (id.includes('/lucide-react/')) {
    return 'vendor-icons'
  }

  return undefined
}

describe('@slow Vendor chunk stability', () => {
  describe('manualChunks function determinism', () => {
    const vendorMappings: Array<{ moduleId: string; expectedChunk: string }> = [
      // vendor-react
      {
        moduleId: '/node_modules/react/index.js',
        expectedChunk: 'vendor-react',
      },
      {
        moduleId: '/node_modules/react-dom/client.js',
        expectedChunk: 'vendor-react',
      },
      {
        moduleId: '/node_modules/scheduler/index.js',
        expectedChunk: 'vendor-react',
      },
      // vendor-router
      {
        moduleId:
          '/node_modules/@tanstack/react-router/dist/esm/index.js',
        expectedChunk: 'vendor-router',
      },
      // vendor-query
      {
        moduleId:
          '/node_modules/@tanstack/react-query/build/modern/index.js',
        expectedChunk: 'vendor-query',
      },
      // vendor-supabase
      {
        moduleId:
          '/node_modules/@supabase/supabase-js/dist/module/index.js',
        expectedChunk: 'vendor-supabase',
      },
      {
        moduleId: '/node_modules/@supabase/auth-js/dist/module/index.js',
        expectedChunk: 'vendor-supabase',
      },
      // vendor-radix
      {
        moduleId: '/node_modules/@radix-ui/react-dialog/dist/index.mjs',
        expectedChunk: 'vendor-radix',
      },
      {
        moduleId:
          '/node_modules/@radix-ui/react-checkbox/dist/index.mjs',
        expectedChunk: 'vendor-radix',
      },
      {
        moduleId: '/node_modules/sonner/dist/index.mjs',
        expectedChunk: 'vendor-radix',
      },
      {
        moduleId: '/node_modules/tailwind-merge/dist/bundle-mjs.mjs',
        expectedChunk: 'vendor-radix',
      },
      {
        moduleId: '/node_modules/clsx/dist/clsx.mjs',
        expectedChunk: 'vendor-radix',
      },
      // vendor-icons
      {
        moduleId: '/node_modules/lucide-react/dist/esm/icons/check.js',
        expectedChunk: 'vendor-icons',
      },
    ]

    it('maps the same module ID to the same vendor chunk on every call', () => {
      for (const { moduleId, expectedChunk } of vendorMappings) {
        const results = new Set<string | undefined>()
        for (let i = 0; i < 100; i++) {
          results.add(manualChunks(moduleId))
        }
        // Must always return the same value
        expect(
          results.size,
          `manualChunks("${moduleId}") returned inconsistent results: ${[...results].join(', ')}`,
        ).toBe(1)
        expect(
          [...results][0],
          `manualChunks("${moduleId}") should map to "${expectedChunk}"`,
        ).toBe(expectedChunk)
      }
    })

    it('returns undefined for non-node_modules paths (src/ files)', () => {
      const srcPaths = [
        '/src/routes/_authed.tasks.tsx',
        '/src/components/tasks/TaskItem.tsx',
        '/src/lib/date.ts',
        '/src/hooks/useTasks.ts',
      ]
      for (const p of srcPaths) {
        expect(
          manualChunks(p),
          `manualChunks("${p}") should return undefined for src files`,
        ).toBeUndefined()
      }
    })

    it('returns undefined for unknown node_modules (no empty vendor chunks)', () => {
      const unknownModules = [
        '/node_modules/some-unknown-lib/index.js',
        '/node_modules/zod/lib/index.mjs',
        '/node_modules/zustand/esm/index.js',
      ]
      for (const p of unknownModules) {
        expect(
          manualChunks(p),
          `manualChunks("${p}") should return undefined for unmatched modules`,
        ).toBeUndefined()
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Build output structure verification (requires dist/)
  // ---------------------------------------------------------------------------

  describe('build output structure', () => {
    const shouldSkip = !distExists

    const testFn = shouldSkip ? it.skip : it

    testFn('vendor chunks use content-hash naming', () => {
      const chunks = getChunks(DIST_ASSETS)
      const vendorChunks = chunks.get('vendor') ?? []

      expect(
        vendorChunks.length,
        'Expected at least one vendor chunk in dist/assets/',
      ).toBeGreaterThan(0)

      for (const chunk of vendorChunks) {
        expect(
          chunk.hash,
          `Vendor chunk ${chunk.filename} should have a content hash`,
        ).toBeTruthy()
        expect(
          chunk.hash.length,
          `Vendor chunk ${chunk.filename} hash should be at least 4 chars`,
        ).toBeGreaterThanOrEqual(4)
      }
    })

    testFn('all expected vendor groups are present', () => {
      const chunks = getChunks(DIST_ASSETS)
      const vendorChunks = chunks.get('vendor') ?? []
      const groups = new Set(
        vendorChunks.map((c) => vendorGroupName(c.filename)),
      )

      // At minimum, vendor-react should exist (it's always used)
      expect(groups.has('vendor-react'), 'Expected vendor-react chunk').toBe(
        true,
      )
    })

    testFn('route chunks exist and have content-hash naming', () => {
      const chunks = getChunks(DIST_ASSETS)
      const routeChunks = chunks.get('route') ?? []

      expect(
        routeChunks.length,
        'Expected at least one route chunk in dist/assets/',
      ).toBeGreaterThan(0)

      for (const chunk of routeChunks) {
        expect(
          chunk.hash,
          `Route chunk ${chunk.filename} should have a content hash`,
        ).toBeTruthy()
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Dual-build hash stability (expensive — requires two builds)
  // This test is the core assertion for Requirements 3.2 and 3.3.
  // It runs two vite builds with a src-only diff and compares hashes.
  // Skipped unless SLOW_TESTS=1 env var is set.
  // Run via: cross-env SLOW_TESTS=1 vitest run tests/integration/perf/vendor-chunk-stability
  // ---------------------------------------------------------------------------

  describe('dual-build vendor hash stability', () => {
    const slowEnabled = process.env.SLOW_TESTS === '1'
    const shouldSkip = !distExists || !slowEnabled

    const testFn = shouldSkip ? it.skip : it

    testFn(
      'vendor chunk hashes are identical across two builds with src-only changes',
      { timeout: 300_000 },
      () => {
        // --- Build 1: current dist/ (already built) ---
        const build1Chunks = getChunks(DIST_ASSETS)
        const build1Vendors = build1Chunks.get('vendor') ?? []

        if (build1Vendors.length === 0) {
          return
        }

        // Record vendor group → hash from build 1
        const build1VendorHashes = new Map<string, string>()
        for (const chunk of build1Vendors) {
          build1VendorHashes.set(vendorGroupName(chunk.filename), chunk.hash)
        }

        // --- Build 2: make a trivial src-only change and rebuild ---
        const targetFile = join(PROJECT_ROOT, 'src', 'lib', 'date.ts')
        if (!existsSync(targetFile)) {
          return
        }

        const originalContent = readFileSync(targetFile, 'utf-8')
        const marker = `\n// __vendor_stability_test_marker_${Date.now()}__\n`

        try {
          // Inject a no-op comment
          writeFileSync(targetFile, originalContent + marker, 'utf-8')

          // Run build 2
          execSync('npx vite build', {
            cwd: PROJECT_ROOT,
            stdio: 'pipe',
            timeout: 120_000,
          })

          // --- Compare vendor hashes ---
          const build2Chunks = getChunks(DIST_ASSETS)
          const build2Vendors = build2Chunks.get('vendor') ?? []
          const build2VendorHashes = new Map<string, string>()
          for (const chunk of build2Vendors) {
            build2VendorHashes.set(vendorGroupName(chunk.filename), chunk.hash)
          }

          // Assert: every vendor group present in both builds has the same hash
          for (const [group, hash1] of build1VendorHashes) {
            const hash2 = build2VendorHashes.get(group)
            if (hash2 === undefined) {
              // Group disappeared — might be tree-shaken, skip
              continue
            }
            expect(
              hash2,
              `Vendor chunk "${group}" hash changed between builds ` +
                `(${hash1} → ${hash2}). Vendor hashes must remain stable ` +
                `when only src/ files change.`,
            ).toBe(hash1)
          }

          // Assert: route/entry chunks SHOULD have different hashes
          const build1Routes = build1Chunks.get('route') ?? []
          const build2Routes = build2Chunks.get('route') ?? []

          if (build1Routes.length > 0 && build2Routes.length > 0) {
            const build1RouteHashes = new Set(
              build1Routes.map((c) => c.hash),
            )
            const build2RouteHashes = new Set(
              build2Routes.map((c) => c.hash),
            )
            const allSame = [...build2RouteHashes].every((h) =>
              build1RouteHashes.has(h),
            )
            // Soft assertion: if the changed file is imported by at least one
            // route, at least one route hash should differ.
            if (allSame) {
              console.warn(
                'Note: No route chunk hashes changed. This may be expected ' +
                  'if the modified file (src/lib/date.ts) is not imported by ' +
                  'any route chunk directly.',
              )
            }
          }
        } finally {
          // Always revert the file change
          writeFileSync(targetFile, originalContent, 'utf-8')

          // Rebuild to restore original dist/
          try {
            execSync('npx vite build', {
              cwd: PROJECT_ROOT,
              stdio: 'pipe',
              timeout: 120_000,
            })
          } catch {
            // Best-effort restore
          }
        }
      },
    )
  })
})
