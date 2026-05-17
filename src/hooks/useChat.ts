import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { z } from 'zod'

import { ApiError, createApiFetch } from '@/lib/apiFetch'
import { getCachedAccessToken } from '@/lib/authStore'
import { useAuthedApi } from '@/hooks/useAuthedApi'
import { getUserTimezone } from '@/lib/timezone'

/**
 * Multi-session chat hooks. Each user owns N sessions; each session
 * owns N messages. Messages from session A never bleed into session
 * B's Mistral context — every conversation has its own thread.
 */

export type ChatRole = 'user' | 'assistant' | 'system'

// ─── DTOs ───────────────────────────────────────────────────────────────────

const Session = z.object({
  id: z.string(),
  title: z.string(),
  /**
   * Connection IDs enabled for this conversation. `null` ⇒ default
   * (only primary connection used). Array ⇒ that exact set of
   * connections is enabled. Empty array ⇒ explicitly disabled all.
   */
  activeConnectionIds: z.array(z.string()).nullable().optional().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type ChatSession = z.infer<typeof Session>

const Message = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  citations: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  toolEvents: z.array(z.unknown()).optional().default([]),
  createdAt: z.number(),
})
export type ChatMessage = z.infer<typeof Message>
export type ChatCitation = NonNullable<ChatMessage['citations']>[number]

const SessionListResponse = z.object({
  sessions: z.array(Session),
})

const MessageListResponse = z.object({
  messages: z.array(Message),
})

const SendResponse = z.object({
  user: Message,
  assistant: Message,
  session: Session,
})

// ─── Loader-friendly fetch (works outside React) ────────────────────────────

const loaderApiFetch = createApiFetch(getCachedAccessToken)

// ─── Query options ──────────────────────────────────────────────────────────

export const sessionsQueryOptions = queryOptions({
  queryKey: ['chat', 'sessions'] as const,
  queryFn: () =>
    loaderApiFetch('/api/chat/sessions', {
      method: 'GET',
      schema: SessionListResponse,
    }),
  staleTime: 60_000,
})

export const sessionMessagesQueryOptions = (sessionId: string) =>
  queryOptions({
    queryKey: ['chat', 'sessions', sessionId, 'messages'] as const,
    queryFn: () =>
      loaderApiFetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'GET',
        schema: MessageListResponse,
      }),
    staleTime: 60_000,
    enabled: !!sessionId,
  })

// ─── Hooks: read ────────────────────────────────────────────────────────────

export function useChatSessions() {
  return useQuery(sessionsQueryOptions)
}

export function useSessionMessages(sessionId: string | null) {
  return useQuery({
    ...sessionMessagesQueryOptions(sessionId ?? ''),
    enabled: !!sessionId,
  })
}

// ─── Hooks: write ───────────────────────────────────────────────────────────

export function useCreateSession() {
  const apiFetch = useAuthedApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      apiFetch('/api/chat/sessions', {
        method: 'POST',
        schema: Session,
      }),
    onSuccess: (newSession) => {
      queryClient.setQueryData(sessionsQueryOptions.queryKey, (old) => {
        const sessions = old?.sessions ?? []
        return { sessions: [newSession, ...sessions] }
      })
    },
  })
}

export function useDeleteSession() {
  const apiFetch = useAuthedApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch(`/api/chat/sessions/${sessionId}`, {
        method: 'DELETE',
        schema: z.void(),
      }),
    onSuccess: (_data, sessionId) => {
      queryClient.setQueryData(sessionsQueryOptions.queryKey, (old) => ({
        sessions: (old?.sessions ?? []).filter((s) => s.id !== sessionId),
      }))
      queryClient.removeQueries({
        queryKey: ['chat', 'sessions', sessionId],
      })
    },
  })
}

export function useRenameSession() {
  const apiFetch = useAuthedApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      apiFetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
        schema: Session,
      }),
    onSuccess: (renamed) => {
      queryClient.setQueryData(sessionsQueryOptions.queryKey, (old) => ({
        sessions: (old?.sessions ?? []).map((s) =>
          s.id === renamed.id ? renamed : s,
        ),
      }))
    },
  })
}

/**
 * Update which Workspace connections are enabled for a chat session.
 *
 * Pass `null` to revert to "default only" behaviour. Pass an array to
 * scope the conversation to exactly that set. Empty array disables
 * Workspace tools entirely for the session.
 *
 * Optimistic — the toggle UI flips instantly, server reconciles on
 * resolution. We rollback the optimistic change on failure to keep
 * the cached state honest.
 */
export function useUpdateSessionConnections() {
  const apiFetch = useAuthedApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      sessionId,
      activeConnectionIds,
    }: {
      sessionId: string
      activeConnectionIds: string[] | null
    }) =>
      apiFetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ activeConnectionIds }),
        schema: Session,
      }),
    onMutate: async ({ sessionId, activeConnectionIds }) => {
      await queryClient.cancelQueries({
        queryKey: sessionsQueryOptions.queryKey,
      })
      const previous = queryClient.getQueryData(sessionsQueryOptions.queryKey)
      queryClient.setQueryData(sessionsQueryOptions.queryKey, (old) => ({
        sessions: (old?.sessions ?? []).map((s) =>
          s.id === sessionId ? { ...s, activeConnectionIds } : s,
        ),
      }))
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(sessionsQueryOptions.queryKey, ctx.previous)
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(sessionsQueryOptions.queryKey, (old) => ({
        sessions: (old?.sessions ?? []).map((s) =>
          s.id === updated.id ? updated : s,
        ),
      }))
    },
  })
}

export function useSendMessage(sessionId: string) {
  const apiFetch = useAuthedApi()
  const queryClient = useQueryClient()
  const messagesKey = sessionMessagesQueryOptions(sessionId).queryKey

  return useMutation({
    mutationFn: async (message: string) => {
      // Client-side 429 retry. The edge function already retries Mistral
      // 429s and falls back to mistral-small, but if BOTH models are
      // saturated within the same second the request bubbles up here.
      // We retry transparently up to 3 times with a polite backoff so a
      // bursty user (or a tool-heavy turn) doesn't have to manually
      // re-send. Anything other than 429 fails fast.
      const attempts = [0, 1500, 3500]
      for (let i = 0; i < attempts.length; i++) {
        if (attempts[i] > 0) {
          await new Promise((r) => setTimeout(r, attempts[i]))
        }
        try {
          return await apiFetch(
            `/api/chat/sessions/${sessionId}/messages`,
            {
              method: 'POST',
              body: JSON.stringify({
                message,
                timezone: getUserTimezone(),
              }),
              schema: SendResponse,
            },
          )
        } catch (err) {
          const isRateLimit =
            err instanceof ApiError && err.status === 429
          if (!isRateLimit || i === attempts.length - 1) throw err
          // Otherwise, loop and retry after the next backoff window.
        }
      }
      // Unreachable — last iteration either returns or throws.
      throw new ApiError(429, 'rate_limited', 'Rate limited.')
    },
    onMutate: async (message: string) => {
      await queryClient.cancelQueries({ queryKey: messagesKey })
      const previous = queryClient.getQueryData(messagesKey)

      const optimisticUser: ChatMessage = {
        id: `temp_${Date.now()}`,
        role: 'user',
        content: message,
        citations: [],
        toolEvents: [],
        createdAt: Math.floor(Date.now() / 1000),
      }

      queryClient.setQueryData(messagesKey, (old) => ({
        messages: [...(old?.messages ?? []), optimisticUser],
      }))

      return { previous, tempId: optimisticUser.id }
    },
    onError: (_err, _msg, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(messagesKey, ctx.previous)
      }
    },
    onSuccess: (data, _msg, ctx) => {
      // Replace optimistic user with the server pair.
      queryClient.setQueryData(messagesKey, (old) => {
        const filtered = (old?.messages ?? []).filter(
          (m) => m.id !== ctx?.tempId,
        )
        return { messages: [...filtered, data.user, data.assistant] }
      })
      // Update the sessions list so the session bumps to the top with
      // its (possibly auto-derived) title.
      queryClient.setQueryData(sessionsQueryOptions.queryKey, (old) => {
        const others = (old?.sessions ?? []).filter(
          (s) => s.id !== data.session.id,
        )
        return { sessions: [data.session, ...others] }
      })
    },
  })
}
