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
 * Workspace connections — list, add, rename, set-default, test, remove.
 *
 * Server: `/api/connections`. Secrets are encrypted server-side and
 * never returned over the wire. The hook only ever sees public
 * shape (id, label, isDefault, timestamps).
 */

const Connection = z.object({
  id: z.string(),
  label: z.string(),
  isDefault: z.boolean(),
  connectedAt: z.number(),
  lastTestAt: z.number().nullable(),
  lastTestOk: z.boolean().nullable(),
  lastUsedAt: z.number().nullable(),
})
export type WorkspaceConnection = z.infer<typeof Connection>

const ListResponse = z.object({
  connections: z.array(Connection),
})

const ConnectionEnvelope = z.object({
  connection: Connection,
})

const TestResponse = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  testedAt: z.number(),
})

// ─── Loader-friendly fetch (works outside React) ───────────────────────────

const loaderFetch = createApiFetch(getCachedAccessToken)

export const connectionsQueryOptions = queryOptions({
  queryKey: ['workspace', 'connections'] as const,
  queryFn: () =>
    loaderFetch('/api/connections', {
      method: 'GET',
      schema: ListResponse,
    }),
  staleTime: 60_000,
})

export function useWorkspaceConnections() {
  return useQuery(connectionsQueryOptions)
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export function useAddConnection() {
  const apiFetch = useAuthedApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      label: string
      webhookUrl: string
      secret: string
      setAsDefault?: boolean
    }) =>
      apiFetch('/api/connections', {
        method: 'POST',
        body: JSON.stringify(input),
        schema: ConnectionEnvelope,
      }),
    onSuccess: () => {
      // Refetch — server may have re-flipped a previous default, so a
      // simple "append to array" optimistic update wouldn't be honest.
      queryClient.invalidateQueries({
        queryKey: connectionsQueryOptions.queryKey,
      })
    },
  })
}

export function useUpdateConnection() {
  const apiFetch = useAuthedApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      label,
      webhookUrl,
      secret,
      isDefault,
    }: {
      id: string
      label?: string
      webhookUrl?: string
      secret?: string
      isDefault?: true
    }) =>
      apiFetch(`/api/connections/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ label, webhookUrl, secret, isDefault }),
        schema: ConnectionEnvelope,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: connectionsQueryOptions.queryKey,
      })
    },
  })
}

export function useDeleteConnection() {
  const apiFetch = useAuthedApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/connections/${id}`, {
        method: 'DELETE',
        schema: z.void(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: connectionsQueryOptions.queryKey,
      })
    },
  })
}

export function useTestConnection() {
  const apiFetch = useAuthedApi()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/connections/${id}/test`, {
        method: 'POST',
        schema: TestResponse,
      }),
    onSettled: () => {
      // Refetch so the row gets the updated `lastTestAt`/`lastTestOk`.
      queryClient.invalidateQueries({
        queryKey: connectionsQueryOptions.queryKey,
      })
    },
  })
}
