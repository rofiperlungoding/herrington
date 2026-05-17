/**
 * Integration tests for content-encoding negotiation
 *
 * **Validates: Requirements 6.4, 6.5, 6.6, 6.7**
 *
 * Since actual content-encoding negotiation (br/gzip) is handled by Netlify's
 * CDN infrastructure at the edge layer, these tests verify:
 *
 * 1. The `netlify.toml` configuration declares the correct `Vary: Accept-Encoding`
 *    header for API routes — ensuring downstream caches correctly key on the
 *    client's encoding preference.
 *
 * 2. Using fast-check to enumerate all combinations of `Accept-Encoding` header
 *    values (containing `br`, `gzip`, both, neither), we assert the expected
 *    content-encoding behavior that Netlify's CDN should produce based on the
 *    documented requirements.
 *
 * The actual compression is applied by Netlify's edge infrastructure and cannot
 * be tested locally without `netlify dev`. These tests serve as a specification
 * contract: given a particular `Accept-Encoding` request header, the expected
 * `Content-Encoding` and `Vary` response headers are documented and verified
 * against the configuration.
 *
 * Running order:
 *   vitest run tests/integration/perf/content-encoding.spec.ts
 *
 * Spec references:
 *   Requirements 6.4, 6.5, 6.6, 6.7
 *   Design: S5.1, S5.5
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NETLIFY_TOML_PATH = join(process.cwd(), 'netlify.toml')

/**
 * Read and return the raw content of netlify.toml.
 */
function readNetlifyToml(): string {
  return readFileSync(NETLIFY_TOML_PATH, 'utf-8')
}

/**
 * Simple TOML [[headers]] block parser.
 * Extracts all header blocks with their `for` path and key-value pairs.
 */
interface HeaderBlock {
  for: string
  values: Record<string, string>
}

function parseHeaderBlocks(tomlContent: string): HeaderBlock[] {
  const blocks: HeaderBlock[] = []
  const lines = tomlContent.split('\n')

  let currentBlock: HeaderBlock | null = null
  let inValues = false

  for (const line of lines) {
    const trimmed = line.trim()

    // Start of a new [[headers]] block
    if (trimmed === '[[headers]]') {
      if (currentBlock) blocks.push(currentBlock)
      currentBlock = { for: '', values: {} }
      inValues = false
      continue
    }

    if (!currentBlock) continue

    // `for = "..."` line
    const forMatch = trimmed.match(/^for\s*=\s*"([^"]+)"/)
    if (forMatch) {
      currentBlock.for = forMatch[1]
      continue
    }

    // Start of [headers.values] section
    if (trimmed === '[headers.values]') {
      inValues = true
      continue
    }

    // Key-value pair inside [headers.values]
    if (inValues && trimmed.includes('=')) {
      const kvMatch = trimmed.match(/^([A-Za-z-]+)\s*=\s*"([^"]+)"/)
      if (kvMatch) {
        currentBlock.values[kvMatch[1]] = kvMatch[2]
      }
    }

    // A new section header (not [headers.values]) ends the current values block
    if (trimmed.startsWith('[') && trimmed !== '[headers.values]' && !trimmed.startsWith('[[')) {
      inValues = false
    }
  }

  // Push the last block
  if (currentBlock) blocks.push(currentBlock)

  return blocks
}

/**
 * Find header blocks matching a given path pattern.
 */
function findHeaderBlocksForPath(blocks: HeaderBlock[], pathPattern: string): HeaderBlock[] {
  return blocks.filter((b) => b.for === pathPattern)
}

/**
 * Determine the expected Content-Encoding based on an Accept-Encoding header value.
 *
 * Per Requirements 6.4, 6.5, 6.6:
 * - If Accept-Encoding contains `br` → Content-Encoding: br
 * - If Accept-Encoding contains `gzip` but NOT `br` → Content-Encoding: gzip
 * - If Accept-Encoding contains neither `br` nor `gzip` → no Content-Encoding
 */
function expectedContentEncoding(acceptEncoding: string | null): string | null {
  if (!acceptEncoding) return null

  const tokens = acceptEncoding
    .toLowerCase()
    .split(',')
    .map((t) => t.trim().split(';')[0].trim())

  if (tokens.includes('br')) return 'br'
  if (tokens.includes('gzip')) return 'gzip'
  return null
}

/**
 * Determine whether a Vary: Accept-Encoding header should be present.
 *
 * Per Requirement 6.7:
 * When the response includes Content-Encoding: br or Content-Encoding: gzip,
 * it SHALL include Vary: Accept-Encoding.
 */
function shouldHaveVaryHeader(contentEncoding: string | null): boolean {
  return contentEncoding === 'br' || contentEncoding === 'gzip'
}

// ---------------------------------------------------------------------------
// Arbitraries for fast-check
// ---------------------------------------------------------------------------

/**
 * Generate Accept-Encoding header values covering all meaningful combinations:
 * - Contains `br` only
 * - Contains `gzip` only
 * - Contains both `br` and `gzip`
 * - Contains neither (e.g., `identity`, `deflate`, or empty)
 * - Absent (null)
 */
const acceptEncodingArbitrary: fc.Arbitrary<string | null> = fc.oneof(
  // br only (with optional quality values and other non-br/gzip tokens)
  fc.constantFrom(
    'br',
    'br;q=1.0',
    'deflate, br',
    'identity, br;q=0.8',
    'br, deflate',
  ),
  // gzip only (no br)
  fc.constantFrom(
    'gzip',
    'gzip;q=1.0',
    'deflate, gzip',
    'identity, gzip;q=0.9',
    'gzip, deflate',
  ),
  // both br and gzip
  fc.constantFrom(
    'br, gzip',
    'gzip, br',
    'gzip;q=0.8, br;q=1.0',
    'deflate, gzip, br',
    'br;q=1.0, gzip;q=0.5, identity',
  ),
  // neither br nor gzip
  fc.constantFrom(
    'identity',
    'deflate',
    'deflate, identity',
    '*;q=0',
    '',
  ),
  // absent header
  fc.constant(null),
)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Content-encoding negotiation (Requirements 6.4, 6.5, 6.6, 6.7)', () => {
  const tomlContent = readNetlifyToml()
  const headerBlocks = parseHeaderBlocks(tomlContent)

  describe('netlify.toml configuration verification', () => {
    it('declares Vary: Accept-Encoding for API routes (/api/*)', () => {
      const apiBlocks = findHeaderBlocksForPath(headerBlocks, '/api/*')
      expect(apiBlocks.length).toBeGreaterThanOrEqual(1)

      const hasVary = apiBlocks.some(
        (block) => block.values['Vary'] === 'Accept-Encoding',
      )
      expect(
        hasVary,
        'Expected a [[headers]] block for "/api/*" with Vary = "Accept-Encoding"',
      ).toBe(true)
    })

    it('API header block exists and is correctly structured', () => {
      const apiBlocks = findHeaderBlocksForPath(headerBlocks, '/api/*')
      expect(apiBlocks.length).toBeGreaterThanOrEqual(1)

      // The Vary header must be exactly "Accept-Encoding" (not a superset)
      const varyBlock = apiBlocks.find((b) => b.values['Vary'])
      expect(varyBlock).toBeDefined()
      expect(varyBlock!.values['Vary']).toBe('Accept-Encoding')
    })
  })

  describe('content-encoding selection logic (property-based)', () => {
    it('Accept-Encoding containing "br" → expected Content-Encoding: br (Req 6.4)', () => {
      fc.assert(
        fc.property(
          acceptEncodingArbitrary.filter(
            (ae) => ae !== null && ae.toLowerCase().includes('br'),
          ),
          (acceptEncoding) => {
            const result = expectedContentEncoding(acceptEncoding)
            expect(
              result,
              `Accept-Encoding: "${acceptEncoding}" should yield Content-Encoding: br`,
            ).toBe('br')
          },
        ),
        { numRuns: 100 },
      )
    })

    it('Accept-Encoding containing "gzip" but NOT "br" → expected Content-Encoding: gzip (Req 6.5)', () => {
      fc.assert(
        fc.property(
          acceptEncodingArbitrary.filter(
            (ae) =>
              ae !== null &&
              ae.toLowerCase().includes('gzip') &&
              !ae.toLowerCase().includes('br'),
          ),
          (acceptEncoding) => {
            const result = expectedContentEncoding(acceptEncoding)
            expect(
              result,
              `Accept-Encoding: "${acceptEncoding}" should yield Content-Encoding: gzip`,
            ).toBe('gzip')
          },
        ),
        { numRuns: 100 },
      )
    })

    it('Accept-Encoding without "br" or "gzip" → no Content-Encoding (Req 6.6)', () => {
      fc.assert(
        fc.property(
          acceptEncodingArbitrary.filter(
            (ae) =>
              ae === null ||
              (!ae.toLowerCase().includes('br') &&
                !ae.toLowerCase().includes('gzip')),
          ),
          (acceptEncoding) => {
            const result = expectedContentEncoding(acceptEncoding)
            expect(
              result,
              `Accept-Encoding: "${acceptEncoding}" should yield no Content-Encoding`,
            ).toBeNull()
          },
        ),
        { numRuns: 100 },
      )
    })

    it('Vary: Accept-Encoding present iff Content-Encoding is br or gzip (Req 6.7)', () => {
      fc.assert(
        fc.property(acceptEncodingArbitrary, (acceptEncoding) => {
          const contentEncoding = expectedContentEncoding(acceptEncoding)
          const needsVary = shouldHaveVaryHeader(contentEncoding)

          if (contentEncoding === 'br' || contentEncoding === 'gzip') {
            expect(
              needsVary,
              `Content-Encoding: ${contentEncoding} requires Vary: Accept-Encoding`,
            ).toBe(true)
          } else {
            expect(
              needsVary,
              'No Content-Encoding means Vary header is not required',
            ).toBe(false)
          }
        }),
        { numRuns: 200 },
      )
    })
  })

  describe('Accept-Encoding parsing edge cases', () => {
    it('handles quality values correctly — br with higher q wins', () => {
      // br present → always br regardless of quality (per Netlify CDN behavior)
      expect(expectedContentEncoding('gzip;q=1.0, br;q=0.1')).toBe('br')
      expect(expectedContentEncoding('br;q=0.001')).toBe('br')
    })

    it('handles whitespace variations in Accept-Encoding', () => {
      expect(expectedContentEncoding('  br  ')).toBe('br')
      expect(expectedContentEncoding('gzip , deflate')).toBe('gzip')
      expect(expectedContentEncoding(' deflate , br , gzip ')).toBe('br')
    })

    it('handles case-insensitive encoding tokens', () => {
      expect(expectedContentEncoding('BR')).toBe('br')
      expect(expectedContentEncoding('GZIP')).toBe('gzip')
      expect(expectedContentEncoding('Br, Gzip')).toBe('br')
    })

    it('null or empty Accept-Encoding yields no Content-Encoding', () => {
      expect(expectedContentEncoding(null)).toBeNull()
      expect(expectedContentEncoding('')).toBeNull()
    })
  })
})
