import { useCallback, useSyncExternalStore } from 'react'

/**
 * Options for {@link useMediaQuery}.
 *
 * `defaultMatches` controls the value returned when `window.matchMedia` is
 * unavailable — either because the hook is evaluated outside a browser (SSR,
 * static pre-render) or because a test environment has deleted the API. The
 * default of `false` lets `AppShell` fall back to the mobile layout on the
 * first paint when viewport detection is inconclusive, matching
 * Requirement 12.5.
 */
export interface UseMediaQueryOptions {
  defaultMatches?: boolean
}

/**
 * Reactive media-query hook backed by `window.matchMedia` and
 * `useSyncExternalStore`. Returns `true` while the supplied CSS media query
 * currently matches the viewport and re-renders the consumer whenever the
 * match state flips.
 *
 * Used by `AppShell` to drive the single responsive breakpoint
 * (`(min-width: 768px)`) that switches between `<Sidebar />` and
 * `<BottomNav />` without a page reload, satisfying Requirement 12.6.
 *
 * When `window.matchMedia` is unavailable (SSR or a test environment that
 * has explicitly deleted the API), both the snapshot and the server snapshot
 * return `options.defaultMatches`, which defaults to `false`. The consumer
 * (`AppShell`) uses `false` so the first render prefers the mobile shell —
 * see Requirement 12.5.
 *
 * Older Safari browsers predate `MediaQueryList.addEventListener`; the
 * subscribe path falls back to the deprecated `addListener`/`removeListener`
 * pair so those browsers still receive live breakpoint change notifications.
 */
export function useMediaQuery(
  query: string,
  { defaultMatches = false }: UseMediaQueryOptions = {},
): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {}
      }
      const mql = window.matchMedia(query)
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', notify)
        return () => mql.removeEventListener('change', notify)
      }
      // Fallback for older Safari where `addEventListener` is not implemented
      // on `MediaQueryList`. The deprecated `addListener`/`removeListener`
      // pair still exists and fires the same change notifications.
      mql.addListener(notify)
      return () => {
        mql.removeListener(notify)
      }
    },
    [query],
  )

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return defaultMatches
    }
    return window.matchMedia(query).matches
  }, [query, defaultMatches])

  const getServerSnapshot = useCallback(() => defaultMatches, [defaultMatches])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
