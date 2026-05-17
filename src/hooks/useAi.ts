import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'

import { useAuthedApi } from '@/hooks/useAuthedApi'
import { getUserTimezone } from '@/lib/timezone'

/**
 * AI utility hooks — small one-shot calls.
 *
 *   useParseTask  : turns "nugas AI besok jam 7 malam" into { title, category, deadline }
 *   useSliceTask  : turns a big task into 3-5 actionable sub-tasks
 *
 * Both go through the `/api/ai/*` edge function which proxies to
 * Mistral Small. Errors surface via the standard mutation error path;
 * components decide how to present them.
 */

// ─── Parse natural language ────────────────────────────────────────────────

const ParseTaskResponse = z.object({
  title: z.string(),
  category: z.string(),
  /** Unix seconds, or null if no time was implied. */
  deadline: z.number().nullable(),
  /** Up to 3 lowercase secondary labels inferred from the input. */
  tags: z.array(z.string()).default([]),
})

export type ParseTaskResult = z.infer<typeof ParseTaskResponse>

export function useParseTask() {
  const api = useAuthedApi()
  return useMutation({
    mutationFn: (input: string) =>
      api<ParseTaskResult>('/api/ai/parse-task', {
        method: 'POST',
        body: JSON.stringify({
          input,
          timezone: getUserTimezone(),
          nowUnix: Math.floor(Date.now() / 1000),
        }),
        schema: ParseTaskResponse,
      }),
  })
}

// ─── Slice big task ────────────────────────────────────────────────────────

const SliceTaskResponse = z.object({
  subtasks: z.array(z.string()).min(1).max(5),
})

export type SliceTaskResult = z.infer<typeof SliceTaskResponse>

export function useSliceTask() {
  const api = useAuthedApi()
  return useMutation({
    mutationFn: ({
      title,
      context,
    }: {
      title: string
      context?: string
    }) =>
      api<SliceTaskResult>('/api/ai/slice-task', {
        method: 'POST',
        body: JSON.stringify({ title, context }),
        schema: SliceTaskResponse,
      }),
  })
}

// ─── Break engine ──────────────────────────────────────────────────────────

const BreakRecommendation = z.object({
  title: z.string(),
  duration: z.string(),
  why: z.string(),
})

const BreakRecommendResponse = z.object({
  bucket: z.enum(['early', 'morning', 'midday', 'afternoon', 'evening', 'night']),
  recommendations: z.array(BreakRecommendation).min(1).max(3),
})

export type BreakRecommendation = z.infer<typeof BreakRecommendation>
export type BreakRecommendResult = z.infer<typeof BreakRecommendResponse>

export function useBreakRecommend() {
  const api = useAuthedApi()
  return useMutation({
    mutationFn: ({ mood }: { mood?: string } = {}) =>
      api<BreakRecommendResult>('/api/ai/break-recommend', {
        method: 'POST',
        body: JSON.stringify({
          timezone: getUserTimezone(),
          hour: new Date().getHours(),
          mood,
        }),
        schema: BreakRecommendResponse,
      }),
  })
}
