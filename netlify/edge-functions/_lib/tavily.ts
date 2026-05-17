/**
 * Tavily web search client with round-robin key rotation.
 *
 * Tavily's free tier caps at 1000 searches per key per month. The user
 * registered multiple accounts and dropped all the keys into
 * `TAVILY_API_KEYS` (comma-separated) so we can stretch the budget
 * by rotating round-robin AND falling forward when a key returns
 * 429 / 401 / 402.
 *
 * Strategy:
 *   1. Parse the env var into an array of keys at import time.
 *   2. Keep a module-level cursor that advances on every call.
 *   3. Try the cursored key. On rate-limit / quota / auth errors, mark
 *      that key as "exhausted for this process" and try the next one.
 *      Exhausted keys are skipped until the function instance restarts
 *      (next deploy / cold boot).
 *   4. Surface a clean error if every key has been exhausted.
 *
 * The cursor is per-instance (Netlify edge runtime), so the rotation
 * isn't perfectly fair across instances — but it doesn't have to be,
 * we just need to spread load and survive individual key failures.
 */

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

interface KeyState {
  key: string;
  exhausted: boolean;
  /** Last error reason for diagnostics. */
  lastError?: string;
}

// Lazy-initialized once per process. Edge functions cold-start on
// each deploy, so this resets naturally.
let keyPool: KeyState[] | null = null;
let cursor = 0;

function loadKeys(): KeyState[] {
  if (keyPool) return keyPool;

  const raw = Deno.env.get('TAVILY_API_KEYS') ?? Deno.env.get('TAVILY_API_KEY') ?? '';
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  keyPool = keys.map((k) => ({ key: k, exhausted: false }));
  return keyPool;
}

export interface TavilySearchOptions {
  query: string;
  /** "basic" is fast and cheap, "advanced" is deeper. Default: basic. */
  searchDepth?: 'basic' | 'advanced';
  /** How many results to return. Tavily caps at 20. Default: 5. */
  maxResults?: number;
  /** Limit to specific domains. */
  includeDomains?: string[];
  /** Time range filter (e.g., "day", "week", "month", "year"). */
  timeRange?: 'day' | 'week' | 'month' | 'year';
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  /** Some results include the publication date. */
  publishedDate?: string;
}

export interface TavilyResponse {
  query: string;
  /** A short LLM-friendly synthesized answer Tavily generates. */
  answer?: string;
  results: TavilyResult[];
}

/** Thrown when every configured key has been exhausted. */
export class TavilyOutOfKeysError extends Error {
  constructor(public readonly attempts: Array<{ key: string; reason: string }>) {
    super(
      `All Tavily keys exhausted (${attempts.length} tried). ` +
        `Last reasons: ${attempts.map((a) => a.reason).join('; ')}`,
    );
    this.name = 'TavilyOutOfKeysError';
  }
}

export class TavilyConfigError extends Error {
  constructor() {
    super('No Tavily API keys configured (TAVILY_API_KEYS env var)');
    this.name = 'TavilyConfigError';
  }
}

/**
 * Run a Tavily search. Rotates round-robin through the configured
 * keys, automatically retrying on rate-limit / quota / auth errors.
 */
export async function tavilySearch(
  options: TavilySearchOptions,
): Promise<TavilyResponse> {
  const pool = loadKeys();
  if (pool.length === 0) {
    throw new TavilyConfigError();
  }

  const attempted: Array<{ key: string; reason: string }> = [];
  // Try at most one full pass through the pool.
  for (let attempt = 0; attempt < pool.length; attempt++) {
    const idx = cursor % pool.length;
    cursor = (cursor + 1) % pool.length;
    const slot = pool[idx];

    if (slot.exhausted) {
      attempted.push({ key: maskKey(slot.key), reason: slot.lastError ?? 'exhausted' });
      continue;
    }

    try {
      const result = await fetchTavily(slot.key, options);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isExhaustionError(err)) {
        slot.exhausted = true;
        slot.lastError = msg;
        attempted.push({ key: maskKey(slot.key), reason: msg });
        continue;
      }
      // Non-quota error — surface immediately rather than rotating
      // through every key and producing the same failure.
      throw err;
    }
  }

  throw new TavilyOutOfKeysError(attempted);
}

async function fetchTavily(
  key: string,
  options: TavilySearchOptions,
): Promise<TavilyResponse> {
  const body = {
    api_key: key,
    query: options.query,
    search_depth: options.searchDepth ?? 'basic',
    max_results: Math.min(options.maxResults ?? 5, 10),
    include_answer: true,
    include_domains: options.includeDomains,
    time_range: options.timeRange,
  };

  const res = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const trimmed = detail.slice(0, 300);
    throw new TavilyHttpError(res.status, trimmed);
  }

  const data = (await res.json()) as {
    query?: string;
    answer?: string;
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      score?: number;
      published_date?: string;
    }>;
  };

  return {
    query: data.query ?? options.query,
    answer: data.answer,
    results: (data.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      content: r.content ?? '',
      score: typeof r.score === 'number' ? r.score : 0,
      publishedDate: r.published_date,
    })),
  };
}

class TavilyHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`Tavily HTTP ${status}: ${detail}`);
    this.name = 'TavilyHttpError';
  }
}

function isExhaustionError(err: unknown): boolean {
  if (err instanceof TavilyHttpError) {
    // 401: invalid key. 402: payment required (free tier exhausted).
    // 429: rate limit. 432/433/etc: Tavily plan-specific quota errors.
    return [401, 402, 429].includes(err.status) || err.status >= 430;
  }
  return false;
}

function maskKey(key: string): string {
  if (key.length <= 8) return '***';
  return key.slice(0, 12) + '…' + key.slice(-4);
}
