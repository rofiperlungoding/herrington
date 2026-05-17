/**
 * Symmetric encryption for Workspace shared secrets.
 *
 * Threat model:
 *   - The threat we're defending against is a database leak (Turso
 *     dump bocor or read-only token bocor di repo). Plain-text
 *     secrets in that case = attacker can call every connected GAS
 *     bridge. Encrypted = attacker also needs WORKSPACE_SECRET_KEY,
 *     which lives in our edge runtime env, not the database.
 *   - This is NOT defending against a server-side compromise
 *     (whoever has env access has the key). For that, we'd need
 *     hardware-backed keys / KMS, which is out of scope for a
 *     personal app.
 *
 * Algorithm: AES-GCM 256. Web Crypto API is available in the Deno
 * edge runtime + Node 18+ via `globalThis.crypto.subtle`. No external
 * deps.
 *
 * Storage format: `v1:<base64-iv>:<base64-ciphertext>`. The `v1:`
 * prefix is reserved for future rotation (e.g. switch to a new key
 * format and decrypt-then-re-encrypt rows on read).
 */

const KEY_ENV = 'WORKSPACE_SECRET_KEY'
const VERSION = 'v1'

/** Read the key once per cold start. */
let cachedKey: Promise<CryptoKey> | null = null

function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  cachedKey = (async () => {
    const raw =
      typeof Deno !== 'undefined' && Deno.env
        ? Deno.env.get(KEY_ENV)
        : process.env[KEY_ENV]
    if (!raw) {
      throw new Error(
        `${KEY_ENV} is not set. Generate one with \`node scripts/generate-workspace-key.mjs\` and add it to .env.`,
      )
    }
    const bytes = base64ToBytes(raw)
    if (bytes.length !== 32) {
      throw new Error(
        `${KEY_ENV} must be a base64-encoded 32-byte key (got ${bytes.length} bytes after decode).`,
      )
    }
    return crypto.subtle.importKey(
      'raw',
      bytes as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    )
  })()
  return cachedKey
}

/**
 * Encrypt a UTF-8 string into the storage format.
 *
 * IV is 12 bytes random per call (AES-GCM standard). Authentication
 * tag is appended to the ciphertext by SubtleCrypto automatically.
 */
export async function encryptSecret(plain: string): Promise<string> {
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  )
  return `${VERSION}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`
}

/**
 * Reverse of `encryptSecret`. Throws if the input doesn't carry the
 * expected version prefix or fails authentication — both indicate
 * tampering or a key mismatch.
 */
export async function decryptSecret(stored: string): Promise<string> {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error('Stored secret is in an unexpected format.')
  }
  const [, ivB64, cipherB64] = parts
  const key = await getKey()
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivB64) as BufferSource },
    key,
    base64ToBytes(cipherB64) as BufferSource,
  )
  return new TextDecoder().decode(plain)
}

// ─── base64 helpers ────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes
}
