import { create } from 'zustand'

/**
 * Ephemeral UI state store (session-only, in-memory).
 *
 * Per Requirement 8.6: when the user activates the Sidebar's collapse control,
 * the chosen state must persist for the remainder of the session. "For the
 * remainder of the session" is interpreted as in-memory only — no
 * `localStorage` or `sessionStorage` persistence — so a full page reload
 * returns to the default expanded state.
 *
 * Server data belongs in TanStack Query; this store is reserved for
 * ephemeral UI state that does not round-trip to the API.
 */
type UiState = {
  /** Whether the desktop Sidebar is currently collapsed. Defaults to `false` (expanded). */
  sidebarCollapsed: boolean
  /** Flip `sidebarCollapsed` between expanded and collapsed presentations (Requirement 8.6). */
  toggleSidebar: () => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}))
