/**
 * Zod contracts for the Tasks API.
 *
 * Imported by:
 *   - the Client (via `apiFetch`) to parse and validate API responses
 *     (Requirement 9.6: schema-failure rollback).
 *   - the Netlify Edge Functions to validate incoming request bodies
 *     before executing any Drizzle query (Requirement 3.2, 3.3).
 *
 * This module must stay Deno-compatible: no Node-only imports, only `zod`.
 */

import { z } from 'zod';

/**
 * Canonical shape of a task row as returned by the API.
 *
 * Mirrors the `tasks` Drizzle table in `src/shared/db/schema.ts`:
 *   - `deadline` and `createdAt` are serialized as unix seconds (integers),
 *     matching the `integer` timestamp columns.
 *   - `deadline` is nullable; `createdAt` is always present.
 *   - `rescheduleCount` is the number of consecutive times the task has
 *     been pushed to a later day via the reschedule endpoint. Resets to
 *     0 on completion or when the deadline is moved earlier.
 *   - `tags` is the parsed array form of the comma-separated `tags`
 *     column. The wire shape uses an array (not the raw CSV string) so
 *     clients never have to parse and the contract enforces uniqueness +
 *     trimming server-side.
 */
export const TaskDTO = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string().min(1),
  category: z.string().min(1),
  isCompleted: z.boolean(),
  deadline: z.number().nullable(),
  createdAt: z.number(),
  rescheduleCount: z.number().int().nonnegative().default(0),
  tags: z.array(z.string()).default([]),
});

/**
 * Response envelope for `GET /api/tasks`.
 */
export const TaskListResponse = z.object({
  tasks: z.array(TaskDTO),
});

/**
 * Request body for `POST /api/tasks`.
 *
 * The server trims `title` and `category`; empty/whitespace-only values
 * are rejected with HTTP 400 (Requirement 3.2, 3.3). `deadline` is an
 * optional unix-seconds integer and may be `null` to indicate "no deadline".
 * `tags` is an optional array of short labels — each tag is trimmed,
 * lower-cased, and deduplicated by the server before persistence.
 */
export const CreateTaskRequest = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  deadline: z.number().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * Request body for `PATCH /api/tasks/:id`.
 *
 * All fields are optional; the service updates only the fields that are
 * present and leaves `isCompleted`, `userId`, and `createdAt` unchanged
 * (Requirement 3.5). `deadline` may be set to `null` to clear it.
 * `tags` replaces the entire tag list (set semantics, not patch).
 */
export const UpdateTaskRequest = z.object({
  title: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  deadline: z.number().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * Request body for `PATCH /api/tasks/:id/completion` (Requirement 4.1).
 */
export const ToggleCompletionRequest = z.object({
  isCompleted: z.boolean(),
});

export type Task = z.infer<typeof TaskDTO>;
export type TaskListResponseBody = z.infer<typeof TaskListResponse>;
export type CreateTaskRequestBody = z.infer<typeof CreateTaskRequest>;
export type UpdateTaskRequestBody = z.infer<typeof UpdateTaskRequest>;
export type ToggleCompletionRequestBody = z.infer<typeof ToggleCompletionRequest>;
