import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'node:path'

import { edgeFunctionsPlugin } from './scripts/edge-dev-plugin'

// Bundle analyzer is opt-in via the ANALYZE=1 env var so that normal CI builds
// (and `npm run build`) carry zero overhead. See spec
// `performance-optimization` task 1.1 / Requirement 11.3-11.4.
const analyzerPlugin: PluginOption | null =
  process.env.ANALYZE === '1'
    ? visualizer({
        filename: 'dist/stats.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
        // Emit when the build wraps up but do not auto-open in CI.
        open: false,
      })
    : null

/**
 * Vendor chunk splitting — function form of manualChunks.
 *
 * Returns a chunk name for known vendor groups, or `undefined` for everything
 * else so Rollup applies its default splitting logic. The function form ensures
 * that if a dependency is tree-shaken away entirely, no empty vendor chunk is
 * emitted (Requirement 3.4).
 *
 * Design ref: S1.2 — vendor splitting for long-term cache stability.
 */
function manualChunks(id: string): string | undefined {
  // Only process modules inside node_modules
  if (!id.includes('node_modules')) return undefined

  // vendor-react: react, react-dom, scheduler
  if (
    id.includes('/react/') ||
    id.includes('/react-dom/') ||
    id.includes('/scheduler/')
  ) {
    return 'vendor-react'
  }

  // vendor-router: @tanstack/react-router
  if (id.includes('/@tanstack/react-router/')) {
    return 'vendor-router'
  }

  // vendor-query: @tanstack/react-query
  if (id.includes('/@tanstack/react-query/')) {
    return 'vendor-query'
  }

  // vendor-supabase: @supabase/auth-js (lightweight auth-only client)
  // Note: The full @supabase/supabase-js is no longer imported in the client
  // bundle. Only @supabase/auth-js is used directly (Design S1.3).
  if (id.includes('/@supabase/')) {
    return 'vendor-supabase'
  }

  // vendor-radix: @radix-ui/*, sonner, tailwind-merge, clsx
  if (
    id.includes('/@radix-ui/') ||
    id.includes('/sonner/') ||
    id.includes('/tailwind-merge/') ||
    id.includes('/clsx/')
  ) {
    return 'vendor-radix'
  }

  // vendor-icons: lucide-react
  if (id.includes('/lucide-react/')) {
    return 'vendor-icons'
  }

  return undefined
}

export default defineConfig({
  plugins: [
    // TanStack Router plugin must run BEFORE the React plugin.
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      autoCodeSplitting: true,
    }),
    react(),
    // Mounts every file under `netlify/edge-functions/*.ts` at
    // `/api/<file-stem>` during `vite` / `vite preview`. Replaces the
    // old `netlify dev` proxy so dev runs on a single port.
    edgeFunctionsPlugin(),
    analyzerPlugin,
  ],
  server: {
    // Pin the dev port. If 5173 is taken, fail loud instead of
    // silently jumping to 5174 — that's what bit us before.
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
        /**
         * Custom chunk file naming: route chunks produced by TanStack Router's
         * autoCodeSplitting get a `route-` prefix so the bundle-budget
         * classifier can identify them reliably.
         *
         * Design ref: S1.1, S2.1 — route code splitting naming convention.
         */
        chunkFileNames(chunkInfo) {
          // Route chunks produced by autoCodeSplitting are named after the
          // route file (e.g. `_authed.tasks`, `_authed.habits`, `sign-in`).
          // Detect them and prefix with `route-`.
          const routePatterns = [
            '_authed.tasks',
            '_authed.habits',
            '_authed.index',
            'sign-in',
          ]
          if (
            chunkInfo.name &&
            routePatterns.some((p) => chunkInfo.name === p)
          ) {
            // Normalize: _authed.tasks → route-tasks, sign-in → route-sign-in
            const normalized = chunkInfo.name
              .replace(/^_authed\./, '')
              .replace(/\./g, '-')
            return `assets/route-${normalized}-[hash].js`
          }
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Keep the MVP test directories (`tests/unit/**`, `tests/integration/**`)
    // wired into the default vitest run alongside the redesign-spec patterns
    // under `tests/**/*.spec.{ts,tsx}` (Requirement 16.1–16.8 non-regression).
    // The trailing wildcard pattern already covers the MVP directories, but
    // listing them explicitly documents the contract: the redesign run MUST
    // execute the MVP suites unchanged whenever they are present.
    include: [
      'tests/unit/**/*.spec.{ts,tsx}',
      'tests/integration/**/*.spec.{ts,tsx}',
      'tests/**/*.spec.{ts,tsx}',
    ],
    setupFiles: ['./tests/setup.ts'],
  },
})
