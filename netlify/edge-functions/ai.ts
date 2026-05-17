import { z } from 'zod';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { requireAuth } from './_lib/auth.ts';
import { jsonResponse } from './_lib/json.ts';

/**
 * AI utility endpoints — small, focused Mistral calls that power
 * specific UX features. Kept separate from `chat.ts` because they
 * don't deal with sessions or conversation history; they're stateless
 * one-shot transformers.
 *
 * Routes (all under `/api/ai/*`, all require auth):
 *   POST /api/ai/parse-task   → natural-language → structured task
 *   POST /api/ai/slice-task   → big task → 3-5 actionable sub-tasks
 *
 * Everything goes through Mistral Small (cheap, fast); these are
 * latency-sensitive interactive features, not deep reasoning.
 */

const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MODEL = 'mistral-small-latest';

// ─── Routing ────────────────────────────────────────────────────────────────

type Route =
  | { type: 'parse_task' }
  | { type: 'slice_task' }
  | { type: 'break_recommend' };

function matchRoute(method: string, pathname: string): Route | null {
  if (method !== 'POST') return null;
  if (pathname === '/api/ai/parse-task') return { type: 'parse_task' };
  if (pathname === '/api/ai/slice-task') return { type: 'slice_task' };
  if (pathname === '/api/ai/break-recommend') return { type: 'break_recommend' };
  return null;
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default composeHandler(async (req: Request): Promise<Response> => {
  await requireAuth(req);

  const url = new URL(req.url);
  const route = matchRoute(req.method, url.pathname);
  if (!route) {
    throw new HttpError(404, 'route_not_found', 'Route not found');
  }

  const apiKey = Deno.env.get('MISTRAL_API_KEY');
  if (!apiKey) {
    throw new HttpError(500, 'config_missing', 'AI is not configured');
  }

  if (route.type === 'parse_task') return handleParseTask(req, apiKey);
  if (route.type === 'slice_task') return handleSliceTask(req, apiKey);
  return handleBreakRecommend(req, apiKey);
});

// ─── Parse natural language → task ──────────────────────────────────────────

const ParseTaskBody = z.object({
  input: z.string().min(1).max(500),
  /** Client's IANA timezone so relative dates ("besok jam 7 malam") resolve correctly. */
  timezone: z.string().min(1).max(64).default('UTC'),
  /** Client's "now" as unix seconds — anchor for relative phrases. */
  nowUnix: z.number().int().positive(),
});

async function handleParseTask(req: Request, apiKey: string): Promise<Response> {
  const body = ParseTaskBody.parse(await req.json());
  const nowIso = new Date(body.nowUnix * 1000).toISOString();

  const systemPrompt = [
    'You extract a task from a single short user input.',
    '',
    'Rules:',
    '- Reply with ONLY a JSON object, no prose, no code fences.',
    `- Schema: { "title": string, "category": string, "deadline": string | null, "tags": string[] }`,
    `- "deadline" is an ISO 8601 datetime in the user's timezone (${body.timezone}) or null if no time was implied.`,
    `- The user's current time is ${nowIso} (UTC). Resolve relative phrases like "besok", "tomorrow", "jam 7 malam", "lusa", "next monday" accordingly.`,
    '- "category" is one short word (e.g. "kuliah", "kerja", "personal", "olahraga", "belanja"). Infer naturally if not stated.',
    '- "title" is the cleaned task description with the time/date words removed.',
    '- "tags" is an array of up to 3 short single-word labels (lowercase, no spaces) that add SECONDARY context the category alone does not capture. Examples: ["urgent"], ["waiting"], ["solo"], ["group"]. Return [] when nothing extra is implied. NEVER duplicate the category as a tag.',
    '',
    'Language detection:',
    '- DEFAULT to English. The app is English-first.',
    '- If the input is clearly written in another language (Indonesian, Spanish, etc.), MIRROR that language for the title and category. Tags stay lowercase, single-word, and follow the input language only when an obvious word fits — otherwise English short labels are fine.',
    '- Common Indonesian task markers (mirror them when present): "nugas", "kerjain", "kerjakan", "tugas", "siapin", "beli", "buat", "bikin", "olahraga", "kuliah", "kelas", "rapat".',
    '- "nugas X" expands to "Kerjakan tugas X". "siapin X" expands to "Siapkan X". Keep the title natural in the source language, not a verbatim transcription of slang.',
    '',
    'Examples:',
    'Input: "nugas AI besok jam 7 malam urgent"',
    `Output: {"title":"Kerjakan tugas AI","category":"kuliah","deadline":"<tomorrow at 19:00 ISO in ${body.timezone}>","tags":["urgent"]}`,
    '',
    'Input: "olahraga besok pagi"',
    `Output: {"title":"Olahraga","category":"olahraga","deadline":"<tomorrow at 07:00 ISO in ${body.timezone}>","tags":[]}`,
    '',
    'Input: "buy groceries saturday"',
    'Output: {"title":"Buy groceries","category":"belanja","deadline":"<next saturday at 12:00 ISO>","tags":[]}',
    '',
    'Input: "rapat tim jumat siang"',
    `Output: {"title":"Rapat tim","category":"kerja","deadline":"<this friday at 12:00 ISO in ${body.timezone}>","tags":["group"]}`,
  ].join('\n');

  const upstream = await fetch(MISTRAL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: body.input },
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: 'json_object' },
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error(`[ai] parse-task upstream failed: ${upstream.status} ${detail.slice(0, 300)}`);
    throw new HttpError(502, 'upstream_error', 'AI parser is unavailable');
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    throw new HttpError(502, 'upstream_empty', 'AI parser returned nothing');
  }

  let parsed: { title?: unknown; category?: unknown; deadline?: unknown; tags?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`[ai] parse-task non-JSON reply: ${raw.slice(0, 300)}`);
    throw new HttpError(502, 'upstream_invalid', 'AI parser returned invalid JSON');
  }

  // Convert ISO string deadline → unix seconds for the client.
  let deadlineUnix: number | null = null;
  if (typeof parsed.deadline === 'string' && parsed.deadline) {
    const parsedDate = new Date(parsed.deadline);
    if (!isNaN(parsedDate.getTime())) {
      deadlineUnix = Math.floor(parsedDate.getTime() / 1000);
    }
  }

  // Normalize tags: trim, lowercase, dedupe, single-word, capped at 3.
  const tagsRaw = Array.isArray(parsed.tags) ? parsed.tags : [];
  const tagSet = new Set<string>();
  const tagsOut: string[] = [];
  for (const t of tagsRaw) {
    if (typeof t !== 'string') continue;
    const tag = t.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24);
    if (!tag || tagSet.has(tag)) continue;
    tagSet.add(tag);
    tagsOut.push(tag);
    if (tagsOut.length >= 3) break;
  }

  return jsonResponse(200, {
    title: typeof parsed.title === 'string' ? parsed.title.trim() : '',
    category: typeof parsed.category === 'string' ? parsed.category.trim() : 'personal',
    deadline: deadlineUnix,
    tags: tagsOut,
  });
}

// ─── Slice big task into sub-tasks ──────────────────────────────────────────

const SliceTaskBody = z.object({
  title: z.string().min(1).max(300),
  /** Optional extra context the user provided about why the task feels big. */
  context: z.string().max(1000).optional(),
});

async function handleSliceTask(req: Request, apiKey: string): Promise<Response> {
  const body = SliceTaskBody.parse(await req.json());

  const systemPrompt = [
    'You break a big or scary task into 3-5 small, immediately-actionable sub-tasks.',
    '',
    'Rules:',
    '- Reply with ONLY a JSON object, no prose, no code fences.',
    '- Schema: { "subtasks": string[] }',
    '- Each subtask: short, concrete, starts with a verb. No numbering, no bullets, no markdown.',
    '- Each subtask must be DIRECTLY related to the input task. Never invent unrelated steps.',
    '- Order them by what should be done first.',
    '',
    'Language:',
    '- DEFAULT to English. The app is English-first.',
    '- If the input is clearly in another language, MIRROR that language exactly for every subtask.',
    '- Common Indonesian markers (mirror them when present): "nugas", "kerjain", "kuliah", "tugas", "besok", "nanti", "siapin", "beli", "buat", "bikin".',
    '- If the input is short or abbreviated (e.g. "nugas AI"), expand it to its likely full meaning ("Kerjakan tugas mata kuliah AI") in the source language and slice that.',
    '',
    'Example input: "nugas AI"',
    'Example output: {"subtasks":["Buka materi kuliah AI yang terakhir","Catat poin-poin tugas yang harus dikerjakan","Kerjakan bagian termudah dulu untuk masuk mode fokus","Selesaikan bagian intinya","Review dan submit"]}',
    '',
    'Example input: "siapin presentasi capstone"',
    'Example output: {"subtasks":["Susun outline 5-7 slide","Buat slide intro & problem statement","Buat slide demo / hasil","Buat slide closing & next steps","Latihan ngomong sekali sebelum tidur"]}',
    '',
    'Example input: "study for midterm"',
    'Example output: {"subtasks":["List the topics that will be on the exam","Skim past notes to see what feels weakest","Drill the weakest topic for 30 mins","Do one practice problem per topic","Review mistakes before bed"]}',
  ].join('\n');

  const userPrompt = body.context
    ? `Task: ${body.title}\nContext: ${body.context}`
    : `Task: ${body.title}`;

  const upstream = await fetch(MISTRAL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      // Bump to mistral-large for slicer — it's the feature that needs the
      // most reasoning (understand the task, expand abbreviations, stay
      // on-topic). Small was cheaping out.
      model: 'mistral-large-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error(`[ai] slice-task upstream failed: ${upstream.status} ${detail.slice(0, 300)}`);
    throw new HttpError(502, 'upstream_error', 'AI slicer is unavailable');
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    throw new HttpError(502, 'upstream_empty', 'AI slicer returned nothing');
  }

  let parsed: { subtasks?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(502, 'upstream_invalid', 'AI slicer returned invalid JSON');
  }

  const subtasks = Array.isArray(parsed.subtasks)
    ? parsed.subtasks
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 5)
    : [];

  if (subtasks.length === 0) {
    throw new HttpError(502, 'upstream_empty', 'AI slicer produced no sub-tasks');
  }

  return jsonResponse(200, { subtasks });
}

// ─── Spontaneous Break Engine ───────────────────────────────────────────────

const BreakRecommendBody = z.object({
  /** IANA timezone (e.g. "Asia/Jakarta"). Used to localize energy advice. */
  timezone: z.string().min(1).max(64).default('UTC'),
  /** 0–23 local hour client computed. */
  hour: z.number().int().min(0).max(23),
  /** Optional free-form mood note ("aku bosan", "lelah", etc.). */
  mood: z.string().max(200).optional(),
});

/**
 * Recommend three short, low-effort break activities calibrated to the
 * user's current time-of-day and (optional) mood. Powers the "Aku Bosan"
 * button on the Tasks page.
 *
 * Energy logic (encoded in the prompt, the model decides exact picks):
 *   - early / morning: high-energy options not appropriate; suggest gentle
 *     wake-up, short walks, light reading.
 *   - midday: short physical reset (stretch, walk, snack) — user likely
 *     coming off morning focus block.
 *   - afternoon: low-energy slump — suggest 5-10min activities that don't
 *     require focus (call a friend, doodle, listen to music).
 *   - evening: wind-down, social, or admin (tidy desk, journal).
 *   - night: very low energy, screen-light alternatives, sleep prep.
 */
async function handleBreakRecommend(req: Request, apiKey: string): Promise<Response> {
  const body = BreakRecommendBody.parse(await req.json());
  const bucket = bucketHour(body.hour);

  const energyHint = ENERGY_HINTS[bucket];
  const moodLine = body.mood ? `User mood note: "${body.mood}".` : '';

  const systemPrompt = [
    'You suggest three short, immediately-doable break activities for a user who needs a recharge.',
    '',
    'Rules:',
    '- Reply with ONLY a JSON object, no prose, no code fences.',
    '- Schema: { "recommendations": Array<{ "title": string, "duration": string, "why": string }> }',
    '- Exactly 3 recommendations.',
    '- "title": short verb phrase (max 6 words). Concrete, doable in this room/desk/house.',
    '- "duration": short string like "5 min", "10-15 min".',
    '- "why": one short sentence explaining why this fits the current energy level. Match user language (default English; switch if the input is in another language).',
    '- Vary the type: 1 physical, 1 cognitive/relax, 1 social/expressive — when possible.',
    '- Avoid generic gym/exercise suggestions for low-energy buckets. Avoid screen-heavy activities at night.',
    '- Match the input language. Default to English; switch if the input is in another language.',
    '',
    `Time-of-day bucket: ${bucket} (local hour: ${body.hour}, timezone: ${body.timezone}).`,
    `Energy guidance: ${energyHint}`,
    moodLine,
  ].filter(Boolean).join('\n');

  const upstream = await fetch(MISTRAL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: body.mood ? `Mood: ${body.mood}` : 'I need 3 break ideas right now.' },
      ],
      temperature: 0.7,
      max_tokens: 350,
      response_format: { type: 'json_object' },
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error(`[ai] break-recommend upstream failed: ${upstream.status} ${detail.slice(0, 300)}`);
    throw new HttpError(502, 'upstream_error', 'Break engine is unavailable');
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    throw new HttpError(502, 'upstream_empty', 'Break engine returned nothing');
  }

  let parsed: { recommendations?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(502, 'upstream_invalid', 'Break engine returned invalid JSON');
  }

  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
        .filter((r): r is { title: unknown; duration: unknown; why: unknown } =>
          typeof r === 'object' && r !== null,
        )
        .map((r) => ({
          title: typeof r.title === 'string' ? r.title.trim() : '',
          duration: typeof r.duration === 'string' ? r.duration.trim() : '',
          why: typeof r.why === 'string' ? r.why.trim() : '',
        }))
        .filter((r) => r.title.length > 0)
        .slice(0, 3)
    : [];

  if (recommendations.length === 0) {
    throw new HttpError(502, 'upstream_empty', 'Break engine produced no recommendations');
  }

  return jsonResponse(200, { bucket, recommendations });
}

/**
 * Time-of-day buckets — kept in sync with the client-side `bucketHour`
 * in `src/hooks/useTimeOfDay.ts`.
 */
type BreakBucket = 'early' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';

function bucketHour(hour: number): BreakBucket {
  if (hour >= 4 && hour < 6) return 'early';
  if (hour >= 6 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

const ENERGY_HINTS: Record<BreakBucket, string> = {
  early: 'Very early morning. Gentle, quiet, body-warming activities. No coffee suggestions.',
  morning: 'High-energy block. Short physical resets are good. Skip naps.',
  midday: 'Mid-energy. Short walks, stretches, healthy snack, sunlight exposure.',
  afternoon: 'Low energy / post-lunch slump. Avoid demanding focus tasks. Suggest light social or sensory activities.',
  evening: 'Wind-down. Tidy environment, journal, light social, low-stimulation hobbies.',
  night: 'Very low energy. No screens if possible. Sleep prep, breathwork, stretching, reading on paper.',
};
