/**
 * Mistral text embedding helper.
 *
 * Uses `mistral-embed` which returns 1024-dim float vectors and is on
 * Mistral's free tier. Batches up to 100 inputs per request — the
 * upstream API tolerates more, but smaller batches keep payload size
 * small enough for the edge runtime's request budget.
 */

const MISTRAL_EMBED_ENDPOINT = 'https://api.mistral.ai/v1/embeddings'
const MISTRAL_EMBED_MODEL = 'mistral-embed'
const BATCH_SIZE = 32

export async function embedTexts(
  apiKey: string,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return []

  const out: number[][] = []
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE)
    const res = await fetch(MISTRAL_EMBED_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MISTRAL_EMBED_MODEL,
        input: batch,
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Mistral embed failed: ${res.status} ${detail.slice(0, 200)}`)
    }

    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>
    }

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Mistral embed response missing data array')
    }

    for (const row of data.data) {
      if (!Array.isArray(row.embedding)) {
        throw new Error('Mistral embed response missing embedding')
      }
      out.push(row.embedding)
    }
  }

  return out
}

export async function embedSingle(apiKey: string, text: string): Promise<number[]> {
  const result = await embedTexts(apiKey, [text])
  if (result.length === 0) throw new Error('Embed produced no output')
  return result[0]
}
