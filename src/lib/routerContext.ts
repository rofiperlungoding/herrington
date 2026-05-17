/**
 * Router context type shared between the router instance and route definitions.
 *
 * This is extracted into its own module to avoid circular imports between
 * `src/router.tsx` (which imports `routeTree.gen.ts`) and `src/routes/__root.tsx`
 * (which is imported by `routeTree.gen.ts`).
 *
 * Route loaders can declare their parameter as `{ context: RouterContext }`
 * to access the shared `queryClient` for prefetching data via `ensureQueryData`.
 */
import type { QueryClient } from '@tanstack/react-query'

export interface RouterContext {
  queryClient: QueryClient
}
