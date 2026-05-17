import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { z } from 'zod'

import { createApiFetch } from '@/lib/apiFetch'
import { getCachedAccessToken } from '@/lib/authStore'
import { useAuthedApi } from '@/hooks/useAuthedApi'

/**
 * NotebookLM-style hooks. A notebook is a folder of source files;
 * each source becomes N embedded chunks. Q&A over a notebook fans
 * the question out via vector top-k against its chunks.
 */

const Notebook = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Notebook = z.infer<typeof Notebook>

const NotebookSource = z.object({
  id: z.string(),
  kind: z.enum(['file', 'web']).default('file'),
  url: z.string().nullable().default(null),
  filename: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  textLength: z.number().nullable(),
  chunkCount: z.number(),
  createdAt: z.number(),
})
export type NotebookSource = z.infer<typeof NotebookSource>

const NotebookListResponse = z.object({
  notebooks: z.array(Notebook),
})

const NotebookDetailResponse = z.object({
  notebook: Notebook,
  sources: z.array(NotebookSource),
})

const NotebookCitation = z.object({
  sourceId: z.string(),
  sourceFilename: z.string(),
  sourceKind: z.enum(['file', 'web']).default('file'),
  sourceUrl: z.string().nullable().default(null),
  chunkIndex: z.number(),
  snippet: z.string(),
})
export type NotebookCitation = z.infer<typeof NotebookCitation>

const NotebookMessage = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(NotebookCitation).optional().default([]),
  createdAt: z.number(),
})
export type NotebookMessage = z.infer<typeof NotebookMessage>

const MessageListResponse = z.object({
  messages: z.array(NotebookMessage),
})

const AskResponse = z.object({
  user: NotebookMessage,
  assistant: NotebookMessage,
  didResearch: z.boolean(),
})
export type NotebookAnswer = z.infer<typeof AskResponse>

// ─── Loader-friendly fetch ─────────────────────────────────────────────────

const loaderApiFetch = createApiFetch(getCachedAccessToken)

export const notebooksQueryOptions = queryOptions({
  queryKey: ['notebooks'] as const,
  queryFn: () =>
    loaderApiFetch('/api/notebooks', {
      method: 'GET',
      schema: NotebookListResponse,
    }),
  staleTime: 60_000,
})

export const notebookDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['notebooks', id] as const,
    queryFn: () =>
      loaderApiFetch(`/api/notebooks/${id}`, {
        method: 'GET',
        schema: NotebookDetailResponse,
      }),
    staleTime: 30_000,
    enabled: !!id,
  })

// ─── Hooks ─────────────────────────────────────────────────────────────────

export function useNotebooks() {
  return useQuery(notebooksQueryOptions)
}

export function useNotebookDetail(id: string | null) {
  return useQuery({
    ...notebookDetailQueryOptions(id ?? ''),
    enabled: !!id,
  })
}

export function useCreateNotebook() {
  const api = useAuthedApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { title?: string; description?: string } = {}) =>
      api<Notebook>('/api/notebooks', {
        method: 'POST',
        body: JSON.stringify(input),
        schema: Notebook,
      }),
    onSuccess: (created) => {
      qc.setQueryData(notebooksQueryOptions.queryKey, (old) => {
        const existing = old?.notebooks ?? []
        return { notebooks: [created, ...existing] }
      })
    },
  })
}

export function useUpdateNotebook() {
  const api = useAuthedApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      title,
      description,
    }: {
      id: string
      title?: string
      description?: string | null
    }) =>
      api<Notebook>(`/api/notebooks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, description }),
        schema: Notebook,
      }),
    onSuccess: (updated) => {
      qc.setQueryData(notebooksQueryOptions.queryKey, (old) => ({
        notebooks: (old?.notebooks ?? []).map((n) =>
          n.id === updated.id ? updated : n,
        ),
      }))
      qc.invalidateQueries({ queryKey: ['notebooks', updated.id] })
    },
  })
}

export function useDeleteNotebook() {
  const api = useAuthedApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/notebooks/${id}`, {
        method: 'DELETE',
        schema: z.void(),
      }),
    onSuccess: (_data, id) => {
      qc.setQueryData(notebooksQueryOptions.queryKey, (old) => ({
        notebooks: (old?.notebooks ?? []).filter((n) => n.id !== id),
      }))
      qc.removeQueries({ queryKey: ['notebooks', id] })
    },
  })
}

export function useUploadSource(notebookId: string) {
  const api = useAuthedApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      filename: string
      mimeType?: string
      sizeBytes?: number
      text: string
    }) =>
      api<NotebookSource>(`/api/notebooks/${notebookId}/sources`, {
        method: 'POST',
        body: JSON.stringify(input),
        schema: NotebookSource,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notebooks', notebookId] })
      qc.invalidateQueries({ queryKey: ['notebooks'] })
      // The server runs AI title generation fire-and-forget after the
      // upload responds, so the title may not be ready yet on the first
      // invalidation. Re-poke after a short delay to pick it up — the
      // small-model title call typically resolves in ~1s.
      window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['notebooks', notebookId] })
        qc.invalidateQueries({ queryKey: ['notebooks'] })
      }, 2500)
    },
  })
}

export function useDeleteSource(notebookId: string) {
  const api = useAuthedApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sourceId: string) =>
      api<void>(`/api/notebooks/${notebookId}/sources/${sourceId}`, {
        method: 'DELETE',
        schema: z.void(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notebooks', notebookId] })
    },
  })
}

export const notebookMessagesQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['notebooks', id, 'messages'] as const,
    queryFn: () =>
      loaderApiFetch(`/api/notebooks/${id}/messages`, {
        method: 'GET',
        schema: MessageListResponse,
      }),
    staleTime: 30_000,
    enabled: !!id,
  })

export function useNotebookMessages(id: string | null) {
  return useQuery({
    ...notebookMessagesQueryOptions(id ?? ''),
    enabled: !!id,
  })
}

export function useAskNotebook(notebookId: string) {
  const api = useAuthedApi()
  const qc = useQueryClient()
  const messagesKey = notebookMessagesQueryOptions(notebookId).queryKey

  return useMutation({
    mutationFn: (question: string) =>
      api<NotebookAnswer>(`/api/notebooks/${notebookId}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question }),
        schema: AskResponse,
      }),
    onMutate: async (question: string) => {
      // Optimistic: append a user turn so the UI doesn't go blank.
      await qc.cancelQueries({ queryKey: messagesKey })
      const previous = qc.getQueryData(messagesKey)
      const optimisticUser: NotebookMessage = {
        id: `temp_${Date.now()}`,
        role: 'user',
        content: question,
        citations: [],
        createdAt: Math.floor(Date.now() / 1000),
      }
      qc.setQueryData(messagesKey, (old) => ({
        messages: [...(old?.messages ?? []), optimisticUser],
      }))
      return { previous, tempId: optimisticUser.id }
    },
    onError: (_err, _q, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(messagesKey, ctx.previous)
      }
    },
    onSuccess: (data, _q, ctx) => {
      // Replace optimistic user with persisted pair.
      qc.setQueryData(messagesKey, (old) => {
        const filtered = (old?.messages ?? []).filter(
          (m) => m.id !== ctx?.tempId,
        )
        return { messages: [...filtered, data.user, data.assistant] }
      })
      // If the server pulled in fresh web sources, invalidate the
      // detail query so the Sources panel picks them up.
      if (data.didResearch) {
        qc.invalidateQueries({ queryKey: ['notebooks', notebookId] })
      }
      qc.invalidateQueries({ queryKey: ['notebooks'] })
    },
  })
}
