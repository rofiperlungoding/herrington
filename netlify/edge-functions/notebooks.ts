import { z } from 'zod';
import { nanoid } from 'nanoid';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { composeHandler, HttpError } from './_lib/handler.ts';
import { requireAuth, type AuthContext } from './_lib/auth.ts';
import { createDrizzleClient } from './_lib/db.ts';
import { jsonResponse } from './_lib/json.ts';
import { embedTexts, embedSingle } from './_lib/embedding.ts';
import { chunkText } from './_lib/chunking.ts';
import { tavilySearch } from './_lib/tavily.ts';
import {
  documents,
  notebooks,
  notebookMessages,
  notebookSources,
} from '../../src/shared/db/schema.ts';

/**
 * NotebookLM-style edge function.
 *
 * Routes (all under `/api/notebooks/...`, all require auth):
 *
 *   GET    /api/notebooks                                    list user's notebooks
 *   POST   /api/notebooks                                    create empty notebook
 *   GET    /api/notebooks/:id                                detail (notebook + sources)
 *   PATCH  /api/notebooks/:id                                rename / set description
 *   DELETE /api/notebooks/:id                                delete notebook + everything
 *
 *   POST   /api/notebooks/:id/sources                        upload extracted text
 *   DELETE /api/notebooks/:id/sources/:sourceId              delete a single source
 *
 *   GET    /api/notebooks/:id/messages                       persisted Q&A history
 *   POST   /api/notebooks/:id/ask                            ask a question (RAG + auto-research)
 *
 * Sources are unified — uploaded files and web pages scraped during
 * AI research both live in `notebook_sources`, distinguished by `kind`.
 * Both contribute chunks to vector retrieval, so future questions
 * can cite either kind without code branching.
 *
 * Research flow on /ask:
 *   1. Persist the user message.
 *   2. Embed the question and run vector top-K against existing chunks.
 *   3. If retrieval is weak (no chunks at all, or top score below
 *      `WEAK_RETRIEVAL_THRESHOLD`), fire Tavily search using the
 *      question as the query. Take the top results, scrape extracted
 *      content, store each as a `kind='web'` source, chunk + embed.
 *      Then re-run vector top-K so the new web chunks can ground the
 *      answer.
 *   4. Compose system prompt with retrieved chunks as CONTEXT and
 *      ask Mistral to answer.
 *   5. Persist assistant message + citations.
 *
 * The 'web' sources persist, so the same query won't trigger a fresh
 * search next time — the user can also see exactly what URLs the AI
 * pulled in via the Sources panel.
 */

const TOP_K = 6;
const MAX_TEXT_BYTES = 600_000; // mirrors client cap
const WEAK_RETRIEVAL_THRESHOLD = 0.55;
const RESEARCH_MAX_RESULTS = 4;

// ─── Routing ───────────────────────────────────────────────────────────────

type Route =
  | { type: 'list_notebooks' }
  | { type: 'create_notebook' }
  | { type: 'get_notebook'; id: string }
  | { type: 'update_notebook'; id: string }
  | { type: 'delete_notebook'; id: string }
  | { type: 'create_source'; notebookId: string }
  | { type: 'delete_source'; notebookId: string; sourceId: string }
  | { type: 'list_messages'; notebookId: string }
  | { type: 'ask'; notebookId: string };

function matchRoute(method: string, pathname: string): Route | null {
  const segs = pathname.split('/').filter(Boolean);
  if (segs[0] !== 'api' || segs[1] !== 'notebooks') return null;

  // /api/notebooks
  if (segs.length === 2) {
    if (method === 'GET') return { type: 'list_notebooks' };
    if (method === 'POST') return { type: 'create_notebook' };
    return null;
  }

  // /api/notebooks/:id
  if (segs.length === 3) {
    const id = segs[2];
    if (method === 'GET') return { type: 'get_notebook', id };
    if (method === 'PATCH') return { type: 'update_notebook', id };
    if (method === 'DELETE') return { type: 'delete_notebook', id };
    return null;
  }

  // /api/notebooks/:id/{sources,ask,messages}
  if (segs.length === 4) {
    const id = segs[2];
    if (segs[3] === 'sources' && method === 'POST') {
      return { type: 'create_source', notebookId: id };
    }
    if (segs[3] === 'ask' && method === 'POST') {
      return { type: 'ask', notebookId: id };
    }
    if (segs[3] === 'messages' && method === 'GET') {
      return { type: 'list_messages', notebookId: id };
    }
    return null;
  }

  // /api/notebooks/:id/sources/:sourceId
  if (segs.length === 5 && segs[3] === 'sources') {
    if (method === 'DELETE') {
      return { type: 'delete_source', notebookId: segs[2], sourceId: segs[4] };
    }
    return null;
  }

  return null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function notebookDto(row: {
  id: string;
  title: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
    updatedAt: Math.floor(row.updatedAt.getTime() / 1000),
  };
}

function sourceDto(row: {
  id: string;
  kind: string;
  url: string | null;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  textLength: number | null;
  chunkCount: number;
  createdAt: Date;
}) {
  return {
    id: row.id,
    kind: row.kind as 'file' | 'web',
    url: row.url,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    textLength: row.textLength,
    chunkCount: row.chunkCount,
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
  };
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  citations: string | null;
  createdAt: Date;
}

interface MessageCitation {
  sourceId: string;
  sourceFilename: string;
  sourceKind: 'file' | 'web';
  sourceUrl: string | null;
  chunkIndex: number;
  snippet: string;
}

function messageDto(row: MessageRow) {
  let citations: MessageCitation[] = [];
  if (row.citations) {
    try {
      const parsed = JSON.parse(row.citations);
      if (Array.isArray(parsed)) {
        citations = parsed.filter(
          (c): c is MessageCitation =>
            typeof c === 'object' &&
            c !== null &&
            typeof c.sourceId === 'string' &&
            typeof c.sourceFilename === 'string',
        );
      }
    } catch {
      // tolerate corrupted JSON — message text is the source of truth
    }
  }
  return {
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    citations,
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
  };
}

async function resolveOwnedNotebook(
  db: ReturnType<typeof createDrizzleClient>,
  auth: AuthContext,
  id: string,
) {
  const row = await db
    .select()
    .from(notebooks)
    .where(and(eq(notebooks.id, id), eq(notebooks.userId, auth.userId)))
    .get();
  if (!row) throw new HttpError(404, 'not_found', 'Notebook not found');
  return row;
}

function getMistralKey(): string {
  const k = Deno.env.get('MISTRAL_API_KEY');
  if (!k) throw new HttpError(500, 'config_missing', 'AI is not configured');
  return k;
}

/**
 * Encode a JS number[] embedding as the SQL `vector(...)` literal Turso
 * expects when inserting into an F32_BLOB column via raw SQL. We do
 * this rather than going through Drizzle's customType because the
 * `documents` insert path needs to set both the typed embedding AND
 * the columns we joined into the table — using sql`...` keeps the
 * insert atomic.
 */
function vectorLiteral(vec: number[]): string {
  return `vector('[${vec.join(',')}]')`;
}

// ─── Handler ───────────────────────────────────────────────────────────────

export default composeHandler(async (req: Request): Promise<Response> => {
  const auth = await requireAuth(req);
  const url = new URL(req.url);
  const route = matchRoute(req.method, url.pathname);
  if (!route) throw new HttpError(404, 'route_not_found', 'Route not found');

  switch (route.type) {
    case 'list_notebooks':
      return handleListNotebooks(auth);
    case 'create_notebook':
      return handleCreateNotebook(req, auth);
    case 'get_notebook':
      return handleGetNotebook(auth, route.id);
    case 'update_notebook':
      return handleUpdateNotebook(req, auth, route.id);
    case 'delete_notebook':
      return handleDeleteNotebook(auth, route.id);
    case 'create_source':
      return handleCreateSource(req, auth, route.notebookId);
    case 'delete_source':
      return handleDeleteSource(auth, route.notebookId, route.sourceId);
    case 'list_messages':
      return handleListMessages(auth, route.notebookId);
    case 'ask':
      return handleAsk(req, auth, route.notebookId);
  }
});

// ─── Notebooks CRUD ────────────────────────────────────────────────────────

async function handleListNotebooks(auth: AuthContext): Promise<Response> {
  const db = createDrizzleClient();
  const rows = await db
    .select()
    .from(notebooks)
    .where(eq(notebooks.userId, auth.userId))
    .orderBy(desc(notebooks.updatedAt))
    .all();
  return jsonResponse(200, { notebooks: rows.map(notebookDto) });
}

const CreateNotebookBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
});

async function handleCreateNotebook(
  req: Request,
  auth: AuthContext,
): Promise<Response> {
  const body = req.body ? CreateNotebookBody.parse(await req.json()) : {};
  const db = createDrizzleClient();
  const now = new Date();
  const nb = {
    id: nanoid(),
    userId: auth.userId,
    title: body.title?.trim() || 'Untitled notebook',
    description: body.description?.trim() || null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(notebooks).values(nb).run();
  return jsonResponse(201, notebookDto(nb));
}

async function handleGetNotebook(
  auth: AuthContext,
  id: string,
): Promise<Response> {
  const db = createDrizzleClient();
  const nb = await resolveOwnedNotebook(db, auth, id);
  const sources = await db
    .select()
    .from(notebookSources)
    .where(
      and(
        eq(notebookSources.notebookId, id),
        eq(notebookSources.userId, auth.userId),
      ),
    )
    .orderBy(asc(notebookSources.createdAt))
    .all();
  return jsonResponse(200, {
    notebook: notebookDto(nb),
    sources: sources.map(sourceDto),
  });
}

const UpdateNotebookBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

async function handleUpdateNotebook(
  req: Request,
  auth: AuthContext,
  id: string,
): Promise<Response> {
  const body = UpdateNotebookBody.parse(await req.json());
  const db = createDrizzleClient();
  await resolveOwnedNotebook(db, auth, id);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;

  const updated = await db
    .update(notebooks)
    .set(updates)
    .where(and(eq(notebooks.id, id), eq(notebooks.userId, auth.userId)))
    .returning()
    .get();
  if (!updated) throw new HttpError(404, 'not_found', 'Notebook not found');
  return jsonResponse(200, notebookDto(updated));
}

async function handleDeleteNotebook(
  auth: AuthContext,
  id: string,
): Promise<Response> {
  const db = createDrizzleClient();
  await resolveOwnedNotebook(db, auth, id);

  // Cascade: delete chunks, then sources, then messages, then the
  // notebook itself.
  await db
    .delete(documents)
    .where(
      and(
        eq(documents.notebookId, id),
        eq(documents.userId, auth.userId),
      ),
    )
    .run();
  await db
    .delete(notebookSources)
    .where(
      and(
        eq(notebookSources.notebookId, id),
        eq(notebookSources.userId, auth.userId),
      ),
    )
    .run();
  await db
    .delete(notebookMessages)
    .where(
      and(
        eq(notebookMessages.notebookId, id),
        eq(notebookMessages.userId, auth.userId),
      ),
    )
    .run();
  await db
    .delete(notebooks)
    .where(and(eq(notebooks.id, id), eq(notebooks.userId, auth.userId)))
    .run();
  return new Response(null, { status: 204 });
}

// ─── Sources ────────────────────────────────────────────────────────────────

const CreateSourceBody = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().max(255).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  text: z.string().min(1),
});

async function handleCreateSource(
  req: Request,
  auth: AuthContext,
  notebookId: string,
): Promise<Response> {
  const body = CreateSourceBody.parse(await req.json());
  if (body.text.length > MAX_TEXT_BYTES) {
    throw new HttpError(
      413,
      'text_too_large',
      `Extracted text exceeds the ${MAX_TEXT_BYTES}-character limit. ` +
        'Try a smaller file or split it into parts.',
    );
  }

  const db = createDrizzleClient();
  await resolveOwnedNotebook(db, auth, notebookId);

  const chunks = chunkText(body.text);
  if (chunks.length === 0) {
    throw new HttpError(
      400,
      'empty_text',
      'No usable text was found in the file.',
    );
  }

  const apiKey = getMistralKey();
  const embeddings = await embedTexts(apiKey, chunks);
  if (embeddings.length !== chunks.length) {
    throw new HttpError(
      502,
      'embed_mismatch',
      'Embedding count did not match chunk count.',
    );
  }

  const sourceId = nanoid();
  const now = new Date();
  const source = {
    id: sourceId,
    notebookId,
    userId: auth.userId,
    kind: 'file' as const,
    url: null as string | null,
    filename: body.filename,
    mimeType: body.mimeType ?? null,
    sizeBytes: body.sizeBytes ?? null,
    textLength: body.text.length,
    chunkCount: chunks.length,
    createdAt: now,
  };
  await db.insert(notebookSources).values(source).run();

  // Insert chunks with raw SQL so we can set the F32_BLOB column with
  // Turso's `vector('[...]')` literal — the customType emits a Buffer
  // which Turso also accepts, but raw SQL keeps the insert path
  // explicit and avoids the round-trip through Drizzle's binding
  // layer for large embedding payloads.
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const vec = embeddings[i];
    await db
      .insert(documents)
      .values({
        id: nanoid(),
        userId: auth.userId,
        notebookId,
        sourceId,
        chunkIndex: i,
        title: body.filename,
        contentChunk: chunk,
        embedding: vec,
        createdAt: now,
      })
      .run();
  }

  // Bump notebook's updatedAt so it sorts to the top of the list.
  // If the notebook still has the default name AND this is the first
  // source upload, fire-and-forget an AI-generated title based on the
  // file's content. The fallback name shows immediately so the user
  // never sees a stale "Untitled" once the title resolves.
  const ownerNotebook = await resolveOwnedNotebook(db, auth, notebookId);
  await db
    .update(notebooks)
    .set({ updatedAt: new Date() })
    .where(eq(notebooks.id, notebookId))
    .run();

  if (
    ownerNotebook.title === 'Untitled notebook' ||
    ownerNotebook.title.trim().length === 0
  ) {
    // Use the first ~2KB of extracted text — enough to capture the
    // gist without burning context tokens.
    const sample = body.text.slice(0, 2000);
    generateNotebookTitle(apiKey, body.filename, sample)
      .then(async (aiTitle) => {
        if (!aiTitle) return;
        await db
          .update(notebooks)
          .set({ title: aiTitle, updatedAt: new Date() })
          .where(eq(notebooks.id, notebookId))
          .run();
      })
      .catch((err: unknown) => {
        console.error('[notebooks] background title generation failed:', err);
      });
  }

  return jsonResponse(201, sourceDto(source));
}

async function handleDeleteSource(
  auth: AuthContext,
  notebookId: string,
  sourceId: string,
): Promise<Response> {
  const db = createDrizzleClient();
  await resolveOwnedNotebook(db, auth, notebookId);

  const source = await db
    .select()
    .from(notebookSources)
    .where(
      and(
        eq(notebookSources.id, sourceId),
        eq(notebookSources.notebookId, notebookId),
        eq(notebookSources.userId, auth.userId),
      ),
    )
    .get();
  if (!source) throw new HttpError(404, 'not_found', 'Source not found');

  await db
    .delete(documents)
    .where(
      and(
        eq(documents.sourceId, sourceId),
        eq(documents.userId, auth.userId),
      ),
    )
    .run();
  await db
    .delete(notebookSources)
    .where(
      and(
        eq(notebookSources.id, sourceId),
        eq(notebookSources.userId, auth.userId),
      ),
    )
    .run();

  return new Response(null, { status: 204 });
}

// ─── Messages list ────────────────────────────────────────────────────────

async function handleListMessages(
  auth: AuthContext,
  notebookId: string,
): Promise<Response> {
  const db = createDrizzleClient();
  await resolveOwnedNotebook(db, auth, notebookId);

  const rows = await db
    .select()
    .from(notebookMessages)
    .where(
      and(
        eq(notebookMessages.notebookId, notebookId),
        eq(notebookMessages.userId, auth.userId),
      ),
    )
    .orderBy(asc(notebookMessages.createdAt))
    .all();

  return jsonResponse(200, { messages: rows.map(messageDto) });
}

// ─── Ask (RAG + auto-research) ─────────────────────────────────────────────

const AskBody = z.object({
  question: z.string().trim().min(1).max(2000),
});

const MISTRAL_CHAT_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_CHAT_MODEL = 'mistral-large-latest';

interface RetrievedChunk {
  id: string;
  sourceId: string;
  title: string;
  chunkIndex: number;
  contentChunk: string;
  sourceFilename: string;
  sourceKind: 'file' | 'web';
  sourceUrl: string | null;
  score: number;
}

async function handleAsk(
  req: Request,
  auth: AuthContext,
  notebookId: string,
): Promise<Response> {
  const body = AskBody.parse(await req.json());
  const apiKey = getMistralKey();

  const db = createDrizzleClient();
  await resolveOwnedNotebook(db, auth, notebookId);

  // 0. Persist the user message immediately so it survives even if
  //    the AI call fails partway through.
  const userMessage = {
    id: nanoid(),
    notebookId,
    userId: auth.userId,
    role: 'user' as const,
    content: body.question,
    citations: null as string | null,
    createdAt: new Date(),
  };
  await db.insert(notebookMessages).values(userMessage).run();

  // 1. Embed the question once. Reuse for the initial retrieval and
  //    (if research fires) the post-research re-retrieval.
  const queryVec = await embedSingle(apiKey, body.question);

  // 2. First pass retrieval against existing chunks (file + web).
  let chunks = await retrieveTopK(db, auth.userId, notebookId, queryVec, TOP_K);
  let didResearch = false;

  // 3. Research trigger: no chunks, OR top score below threshold.
  //    The threshold is a cosine-similarity heuristic — anything
  //    above ~0.55 is "the notebook probably knows this", below
  //    means we should look up fresh sources.
  const topScore = chunks[0]?.score ?? 0;
  if (chunks.length === 0 || topScore < WEAK_RETRIEVAL_THRESHOLD) {
    didResearch = await researchAndIngest(
      db,
      auth.userId,
      notebookId,
      body.question,
      apiKey,
    );
    if (didResearch) {
      // Re-run retrieval now that the new web chunks exist.
      chunks = await retrieveTopK(db, auth.userId, notebookId, queryVec, TOP_K);
    }
  }

  // 4. Compose the answer.
  let answer: string;
  let citationsForMessage: MessageCitation[] = [];

  if (chunks.length === 0) {
    answer =
      "I couldn't find relevant sources. Try uploading a file first, or rephrase your question to be more specific.";
  } else {
    const contextBlock = chunks
      .map((r, i) => {
        const tag = r.sourceKind === 'web' && r.sourceUrl
          ? `${r.sourceFilename} — ${r.sourceUrl}`
          : `${r.sourceFilename}, chunk #${r.chunkIndex}`;
        return `[${i + 1}] (${tag}):\n${r.contentChunk}`;
      })
      .join('\n\n---\n\n');

    const systemPrompt = buildAskSystemPrompt(contextBlock, didResearch);

    const upstream = await fetch(MISTRAL_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MISTRAL_CHAT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: body.question },
        ],
        temperature: 0.2,
        max_tokens: 800,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error(
        `[notebooks] mistral failed: ${upstream.status} ${detail.slice(0, 200)}`,
      );
      answer = 'The AI is unavailable right now. Please try again in a moment.';
    } else {
      const data = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const reply = typeof data.choices?.[0]?.message?.content === 'string'
        ? data.choices[0].message.content!.trim()
        : '';
      answer = reply || "I couldn't compose an answer from the available context.";
    }

    citationsForMessage = chunks.map((r) => ({
      sourceId: r.sourceId,
      sourceFilename: r.sourceFilename,
      sourceKind: r.sourceKind,
      sourceUrl: r.sourceUrl,
      chunkIndex: r.chunkIndex,
      snippet: r.contentChunk.slice(0, 280),
    }));
  }

  // 5. Persist assistant message.
  const assistantMessage = {
    id: nanoid(),
    notebookId,
    userId: auth.userId,
    role: 'assistant' as const,
    content: answer,
    citations:
      citationsForMessage.length > 0
        ? JSON.stringify(citationsForMessage)
        : null,
    createdAt: new Date(),
  };
  await db.insert(notebookMessages).values(assistantMessage).run();

  // Bump notebook updatedAt so it sorts to the top.
  await db
    .update(notebooks)
    .set({ updatedAt: new Date() })
    .where(eq(notebooks.id, notebookId))
    .run();

  return jsonResponse(200, {
    user: messageDto(userMessage),
    assistant: messageDto(assistantMessage),
    didResearch,
  });
}

/**
 * Run vector top-K against this notebook's chunks. Tries Turso's
 * native `vector_top_k` first, falls back to brute-force cosine if
 * the vector index doesn't exist yet.
 */
async function retrieveTopK(
  db: ReturnType<typeof createDrizzleClient>,
  userId: string,
  notebookId: string,
  queryVec: number[],
  k: number,
): Promise<RetrievedChunk[]> {
  // Try native vector_top_k first.
  const sqlText = `
    SELECT d.id AS id,
           d.source_id AS source_id,
           d.title AS title,
           d.chunk_index AS chunk_index,
           d.content_chunk AS content_chunk,
           ns.filename AS source_filename,
           ns.kind AS source_kind,
           ns.url AS source_url,
           v.distance AS distance
      FROM vector_top_k('idx_documents_embedding', ${vectorLiteral(queryVec)}, ${k * 4}) AS v
      JOIN documents d ON d.rowid = v.id
      JOIN notebook_sources ns ON ns.id = d.source_id
     WHERE d.notebook_id = '${notebookId}'
       AND d.user_id = '${userId}'
     ORDER BY v.distance ASC
     LIMIT ${k}
  `;
  try {
    const result = await db.run(sql.raw(sqlText));
    return (result.rows as unknown as Array<{
      id: string;
      source_id: string;
      title: string;
      chunk_index: number;
      content_chunk: string;
      source_filename: string;
      source_kind: string;
      source_url: string | null;
      distance: number;
    }>).map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      title: r.title,
      chunkIndex: r.chunk_index,
      contentChunk: r.content_chunk,
      sourceFilename: r.source_filename,
      sourceKind: (r.source_kind as 'file' | 'web') ?? 'file',
      sourceUrl: r.source_url,
      // Convert L2 distance to a rough similarity (1 / (1 + d)).
      score: 1 / (1 + r.distance),
    }));
  } catch (err) {
    console.error('[notebooks] vector_top_k failed, falling back to brute-force:', err);
    return bruteForceTopK(db, userId, notebookId, queryVec, k);
  }
}

/**
 * Auto-research: when retrieval is weak, fire Tavily, scrape the top
 * results, store each as a `kind='web'` source (chunked + embedded),
 * so the next retrieval pass can ground on them. Returns true if at
 * least one web source was successfully ingested.
 */
async function researchAndIngest(
  db: ReturnType<typeof createDrizzleClient>,
  userId: string,
  notebookId: string,
  query: string,
  apiKey: string,
): Promise<boolean> {
  let tavily;
  try {
    tavily = await tavilySearch({
      query: query.slice(0, 400),
      searchDepth: 'basic',
      maxResults: RESEARCH_MAX_RESULTS,
    });
  } catch (err) {
    console.error('[notebooks] tavily research failed:', err);
    return false;
  }

  if (!tavily.results || tavily.results.length === 0) return false;

  // De-dupe against existing web sources by URL.
  const existing = await db
    .select({ url: notebookSources.url })
    .from(notebookSources)
    .where(
      and(
        eq(notebookSources.notebookId, notebookId),
        eq(notebookSources.userId, userId),
        eq(notebookSources.kind, 'web'),
      ),
    )
    .all();
  const seenUrls = new Set(
    existing.map((e) => e.url).filter((u): u is string => !!u),
  );

  let ingestedCount = 0;
  const now = new Date();

  for (const result of tavily.results) {
    if (!result.url || !result.content) continue;
    if (seenUrls.has(result.url)) continue;

    const text = result.content.trim();
    if (text.length < 100) continue; // skip junk snippets

    const chunks = chunkText(text);
    if (chunks.length === 0) continue;

    // Embed the chunks. If embed fails, skip this source.
    let embeddings: number[][];
    try {
      embeddings = await embedTexts(apiKey, chunks);
    } catch (err) {
      console.error('[notebooks] embed failed for web source:', err);
      continue;
    }
    if (embeddings.length !== chunks.length) continue;

    const sourceId = nanoid();
    const filename = result.title || hostnameOf(result.url);
    const source = {
      id: sourceId,
      notebookId,
      userId,
      kind: 'web' as const,
      url: result.url,
      filename,
      mimeType: 'text/html' as string | null,
      sizeBytes: text.length as number | null,
      textLength: text.length as number | null,
      chunkCount: chunks.length,
      createdAt: now,
    };
    await db.insert(notebookSources).values(source).run();

    for (let i = 0; i < chunks.length; i++) {
      await db
        .insert(documents)
        .values({
          id: nanoid(),
          userId,
          notebookId,
          sourceId,
          chunkIndex: i,
          title: filename,
          contentChunk: chunks[i],
          embedding: embeddings[i],
          createdAt: now,
        })
        .run();
    }

    seenUrls.add(result.url);
    ingestedCount++;
  }

  return ingestedCount > 0;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Compose the system prompt for the answer call. The tone shifts a
 * little when the answer is grounded in fresh web research vs
 * uploaded files (the model is told to acknowledge that web sources
 * may be summaries, not authoritative documents).
 */
function buildAskSystemPrompt(contextBlock: string, didResearch: boolean): string {
  const lines: string[] = [
    'You are answering a question grounded in the user\'s personal notebook.',
    'Only use the CONTEXT below. If the context does not contain the answer, say so honestly — do not invent facts.',
    'Cite the chunk number(s) in square brackets like [1], [2] when referencing specific information.',
    'Match the user language (default English; switch if the user wrote in another language).',
    'Keep replies concise — no preamble, no fluff.',
  ];

  if (didResearch) {
    lines.push(
      '',
      'Some of the context was just pulled from the web because the user\'s uploaded files did not cover this question. Web sources are labeled with a URL — treat them as informative but not authoritative; if uploaded files contradict, prefer the uploaded files.',
    );
  }

  lines.push(
    '',
    '## Math formatting (KaTeX / LaTeX)',
    'When the answer involves equations, formulas, or step-by-step arithmetic, ALWAYS use these delimiters — otherwise the math renders as garbled source code.',
    '- Inline math: wrap in single dollar signs. Example: $V_{out} = S \\times T$',
    '- Block math (own line, centered): wrap in double dollar signs on their own line. Example: $$A_v = \\dfrac{V_{out}}{V_{in}}$$',
    '- Subscripts: V_{out}. Superscripts: x^{2}. Fractions: \\frac{a}{b} or \\dfrac{a}{b} (display).',
    '- Common: \\times, \\cdot, \\approx, \\Omega, \\pm, \\le, \\ge, \\neq.',
    '- Units (mV, V, A, Ω, °C) go inside \\text{...} so they do not italicize. Use \\, for a thin space before the unit. Example: $5\\,\\text{V}$.',
    '- Decimal point inside math: 0.385 (not 0,385) so KaTeX parses it correctly.',
    '- Never put markdown bold/italic INSIDE math.',
    '- If the answer is not math at all, do not use dollar delimiters.',
    '',
    '## Step-by-step calculation layout (HARD RULE)',
    'When solving a problem with formulas, use this exact shape so the page reads top-to-bottom like a textbook:',
    '',
    '1. Each calculation gets its own section with a bold heading.',
    '2. Inside the section, use four labeled prose lines, in this order, each followed by block math:',
    '   - **Diketahui:** values given (inline math is fine for compactness)',
    '   - **Rumus:** the symbolic formula, in block math $$...$$',
    '   - **Substitusi:** the formula with numbers plugged in, in block math $$...$$',
    '   - **Hasil:** the final value with units, in block math $$...$$',
    '3. Block math goes on its OWN line — never inline next to the heading or the label.',
    '4. Between independent calculations, leave a blank line and start a new bold heading.',
    '5. NEVER chain a formula onto a heading — break the formula onto its own block line.',
    '',
    '## CONTEXT',
    '',
    contextBlock,
  );

  return lines.join('\n');
}

/**
 * Fallback when `vector_top_k` is unavailable (e.g. the vector index
 * hasn't been created yet). Pulls all of this notebook's chunks and
 * sorts client-side by cosine distance. Fine for < 1k chunks; we
 * still order things correctly even if Turso never gets the index.
 */
async function bruteForceTopK(
  db: ReturnType<typeof createDrizzleClient>,
  userId: string,
  notebookId: string,
  queryVec: number[],
  k: number,
): Promise<RetrievedChunk[]> {
  const all = await db
    .select({
      id: documents.id,
      sourceId: documents.sourceId,
      title: documents.title,
      chunkIndex: documents.chunkIndex,
      contentChunk: documents.contentChunk,
      embedding: documents.embedding,
    })
    .from(documents)
    .where(
      and(
        eq(documents.notebookId, notebookId),
        eq(documents.userId, userId),
      ),
    )
    .all();

  const scored = all
    .filter((r) => r.embedding && r.embedding.length === queryVec.length)
    .map((r) => ({
      ...r,
      score: cosineSimilarity(queryVec, r.embedding as number[]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  // Fetch source metadata in one go so each chunk knows its filename / kind / url.
  const ids = [...new Set(scored.map((r) => r.sourceId).filter((s): s is string => !!s))];
  const sourceMeta = new Map<
    string,
    { filename: string; kind: 'file' | 'web'; url: string | null }
  >();
  if (ids.length > 0) {
    const sources = await db
      .select({
        id: notebookSources.id,
        filename: notebookSources.filename,
        kind: notebookSources.kind,
        url: notebookSources.url,
      })
      .from(notebookSources)
      .where(eq(notebookSources.userId, userId))
      .all();
    for (const s of sources) {
      sourceMeta.set(s.id, {
        filename: s.filename,
        kind: (s.kind as 'file' | 'web') ?? 'file',
        url: s.url,
      });
    }
  }

  return scored.map((r) => {
    const meta = r.sourceId ? sourceMeta.get(r.sourceId) : undefined;
    return {
      id: r.id,
      sourceId: r.sourceId ?? '',
      title: r.title,
      chunkIndex: r.chunkIndex,
      contentChunk: r.contentChunk,
      sourceFilename: meta?.filename ?? r.title,
      sourceKind: meta?.kind ?? 'file',
      sourceUrl: meta?.url ?? null,
      score: r.score,
    };
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}


/**
 * Ask Mistral for a short notebook title based on the first uploaded
 * file's content. Uses the small/fast model so the post-upload
 * round-trip stays cheap — it runs fire-and-forget so a 429 / network
 * blip can't block the actual upload flow.
 */
async function generateNotebookTitle(
  apiKey: string,
  filename: string,
  textSample: string,
): Promise<string | null> {
  const messages = [
    {
      role: 'system' as const,
      content:
        'You name knowledge-base notebooks. Given a filename and a text sample, ' +
        'reply with ONLY a short, human-readable notebook title (max 6 words, no quotes, ' +
        'no trailing punctuation). The title should describe what the contents are about. ' +
        'Match the language the document is written in (default English when unclear). Examples: ' +
        '"Calculus II midterm notes", "Q3 financial report", "Stripe API integration", "Pengkondisian sinyal sensor".',
    },
    {
      role: 'user' as const,
      content: `Filename: ${filename}\n\nSample:\n${textSample.slice(0, 2000)}`,
    },
  ];

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages,
      temperature: 0.2,
      max_tokens: 24,
    }),
  });

  if (!res.ok) {
    console.error(`[notebooks] title generation failed: ${res.status}`);
    return null;
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/[.!?…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;
  if (cleaned.length > 60) return cleaned.slice(0, 57).trimEnd() + '…';
  return cleaned;
}
