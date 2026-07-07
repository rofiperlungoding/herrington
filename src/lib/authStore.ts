import { create } from 'zustand';

export interface User {
  id: string;
  email: string;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in seconds
  user: User;
}

interface AuthState {
  session: Session | null;
  accessToken: string | null;
  ready: boolean;
  timedOut: boolean;
}

interface AuthActions {
  setSession: (session: Session | null) => void;
  _setReady: () => void;
  _setTimedOut: () => void;
  _clearTimedOut: () => void;
  _resetForRetry: () => void;
  signOut: () => Promise<void>;
}

const STORAGE_KEY = 'custom-auth-session';

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  session: null,
  accessToken: null,
  ready: false,
  timedOut: false,

  setSession: (session) => {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem?.(STORAGE_KEY);
    }
    set({
      session,
      accessToken: session?.access_token ?? null,
    });
  },

  _setReady: () => set({ ready: true }),
  _setTimedOut: () => set({ timedOut: true }),
  _clearTimedOut: () => set({ timedOut: false }),
  _resetForRetry: () => set({ ready: false, timedOut: false }),

  signOut: async () => {
    try {
      await fetch('/api/sign-out', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${get().accessToken}`,
        },
      });
    } catch {
      // Ignore network errors on sign out
    }
    get().setSession(null);
  },
}));

// ─── Module-level bootstrap ────────────────────────────────────────────────

let isBootstrapping = false;
let refreshPromise: Promise<Session | null> | null = null;

async function refreshSession(refreshToken: string): Promise<Session | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) {
        throw new Error('Refresh failed');
      }
      const data = await res.json();
      return data.session as Session;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function bootstrapAuth() {
  if (isBootstrapping) return;
  isBootstrapping = true;

  const { setSession, _setReady, _clearTimedOut } = useAuthStore.getState();

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setSession(null);
      return;
    }

    const session = JSON.parse(stored) as Session;
    
    // Check if token needs refresh (less than 5 mins left)
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at - now < 300) {
      const newSession = await refreshSession(session.refresh_token);
      setSession(newSession);
    } else {
      setSession(session);
    }
  } catch (err) {
    console.error('[auth] failed to restore session:', err);
    setSession(null);
  } finally {
    _setReady();
    _clearTimedOut();
    isBootstrapping = false;
  }
}

// Automatically bootstrap on module load if in browser
if (typeof window !== 'undefined') {
  bootstrapAuth();

  // Listen to cross-tab storage changes
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      if (e.newValue) {
        try {
          const session = JSON.parse(e.newValue) as Session;
          useAuthStore.getState().setSession(session);
        } catch {
          useAuthStore.getState().setSession(null);
        }
      } else {
        useAuthStore.getState().setSession(null);
      }
    }
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function useSession() {
  const session = useAuthStore((s) => s.session);
  const ready = useAuthStore((s) => s.ready);
  const timedOut = useAuthStore((s) => s.timedOut);
  return { session, ready, timedOut };
}

export function getCachedAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
