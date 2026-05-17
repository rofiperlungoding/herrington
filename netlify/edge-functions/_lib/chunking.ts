/**
 * Naive paragraph-aware chunker.
 *
 * Strategy:
 *   1. Split on blank lines (paragraph boundaries).
 *   2. Greedily pack paragraphs into chunks up to TARGET_CHUNK_CHARS.
 *   3. Overlap each chunk by OVERLAP_CHARS so cross-paragraph
 *      references survive retrieval (a fact split across the chunk
 *      boundary is still recoverable).
 *
 * Char counts (not tokens) — the embedding model handles up to 8K
 * tokens so 1500-char chunks (~400 tokens) leave generous headroom.
 *
 * The chunker isn't language-aware; for non-Latin scripts it still
 * works because the byte/char count is what matters for the embedding
 * model, not word count.
 */

const TARGET_CHUNK_CHARS = 1500
const OVERLAP_CHARS = 200
const HARD_MAX_CHARS = 2400

export function chunkText(text: string): string[] {
  const cleaned = text.replace(/\r\n?/g, '\n').trim()
  if (cleaned.length === 0) return []

  // Split into paragraphs first.
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  // If a paragraph itself is bigger than the hard max, chop it on
  // sentence boundaries (simple regex — good enough for most prose).
  const blocks: string[] = []
  for (const p of paragraphs) {
    if (p.length <= HARD_MAX_CHARS) {
      blocks.push(p)
      continue
    }
    blocks.push(...chopByLength(p, HARD_MAX_CHARS))
  }

  const chunks: string[] = []
  let current = ''

  for (const block of blocks) {
    // Adding this block stays within target → add and continue.
    if (current.length === 0) {
      current = block
      continue
    }
    if (current.length + block.length + 2 <= TARGET_CHUNK_CHARS) {
      current = `${current}\n\n${block}`
      continue
    }
    // Flush.
    chunks.push(current)
    // Start the next chunk with the tail of the previous as overlap.
    const overlap = current.slice(-OVERLAP_CHARS)
    current = `${overlap}\n\n${block}`
  }
  if (current.length > 0) chunks.push(current)

  return chunks
}

function chopByLength(text: string, max: number): string[] {
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const end = Math.min(i + max, text.length)
    // Try to break at a sentence boundary near `end`.
    let cut = end
    if (end < text.length) {
      const window = text.slice(end - 200, end)
      const m = window.match(/[.!?]\s[^.!?]*$/)
      if (m && m.index !== undefined) {
        cut = end - 200 + m.index + 1
      }
    }
    out.push(text.slice(i, cut).trim())
    i = cut
  }
  return out.filter((s) => s.length > 0)
}
