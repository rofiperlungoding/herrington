/**
 * Integration test: Static-asset cache headers in netlify.toml
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.7
 *
 * Parses the `netlify.toml` file at the project root and asserts that each
 * `[[headers]]` block matches the caching requirements:
 *   - `/assets/*` → Cache-Control: public, max-age=31536000, immutable
 *   - `/fonts/*`  → Cache-Control: public, max-age=31536000, immutable
 *   - `/` and `/index.html` → Cache-Control includes `must-revalidate`, does NOT include `immutable`
 *   - `/api/*` → Vary: Accept-Encoding
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Parse netlify.toml [[headers]] blocks
// ---------------------------------------------------------------------------

interface HeaderBlock {
  for: string
  values: Record<string, string>
}

/**
 * Minimal parser that extracts [[headers]] blocks from netlify.toml.
 * Each block starts with `[[headers]]` and contains a `for = "..."` line
 * plus `[headers.values]` with key = "value" pairs.
 */
function parseHeaderBlocks(tomlContent: string): HeaderBlock[] {
  const blocks: HeaderBlock[] = []
  const lines = tomlContent.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()

    if (line === '[[headers]]') {
      const block: HeaderBlock = { for: '', values: {} }
      i++

      // Parse lines until next section or end of file
      while (i < lines.length) {
        const current = lines[i].trim()

        // Stop at next top-level section
        if (current.startsWith('[[') && current !== '[headers.values]') break

        // Parse `for = "..."` line
        const forMatch = current.match(/^for\s*=\s*"([^"]+)"/)
        if (forMatch) {
          block.for = forMatch[1]
          i++
          continue
        }

        // Enter [headers.values] sub-table
        if (current === '[headers.values]') {
          i++
          // Parse key-value pairs until next section or blank
          while (i < lines.length) {
            const valueLine = lines[i].trim()
            if (
              valueLine.startsWith('[') ||
              valueLine.startsWith('[[') ||
              valueLine === ''
            ) {
              break
            }
            const kvMatch = valueLine.match(/^([A-Za-z-]+)\s*=\s*"([^"]+)"/)
            if (kvMatch) {
              block.values[kvMatch[1]] = kvMatch[2]
            }
            i++
          }
          continue
        }

        // Skip comments and blank lines within the block
        if (current === '' || current.startsWith('#')) {
          i++
          continue
        }

        i++
      }

      blocks.push(block)
    } else {
      i++
    }
  }

  return blocks
}

// ---------------------------------------------------------------------------
// Load and parse netlify.toml
// ---------------------------------------------------------------------------

const NETLIFY_TOML_PATH = join(process.cwd(), 'netlify.toml')
const tomlContent = readFileSync(NETLIFY_TOML_PATH, 'utf-8')
const headerBlocks = parseHeaderBlocks(tomlContent)

/**
 * Helper: find a header block by its `for` path pattern.
 */
function findBlock(forPath: string): HeaderBlock | undefined {
  return headerBlocks.find((b) => b.for === forPath)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Static-asset cache headers (netlify.toml)', () => {
  describe('Requirement 6.1: /assets/* carries immutable long-cache', () => {
    it('has a [[headers]] block for /assets/*', () => {
      const block = findBlock('/assets/*')
      expect(block, 'Missing [[headers]] block for /assets/*').toBeDefined()
    })

    it('/assets/* Cache-Control is "public, max-age=31536000, immutable"', () => {
      const block = findBlock('/assets/*')!
      expect(block.values['Cache-Control']).toBe(
        'public, max-age=31536000, immutable',
      )
    })
  })

  describe('Requirement 6.2: /fonts/* carries immutable long-cache', () => {
    it('has a [[headers]] block for /fonts/*', () => {
      const block = findBlock('/fonts/*')
      expect(block, 'Missing [[headers]] block for /fonts/*').toBeDefined()
    })

    it('/fonts/* Cache-Control is "public, max-age=31536000, immutable"', () => {
      const block = findBlock('/fonts/*')!
      expect(block.values['Cache-Control']).toBe(
        'public, max-age=31536000, immutable',
      )
    })
  })

  describe('Requirement 6.3: root path carries must-revalidate without immutable', () => {
    it('has a [[headers]] block for /', () => {
      const block = findBlock('/')
      expect(block, 'Missing [[headers]] block for /').toBeDefined()
    })

    it('/ Cache-Control includes must-revalidate', () => {
      const block = findBlock('/')!
      expect(block.values['Cache-Control']).toContain('must-revalidate')
    })

    it('/ Cache-Control does NOT include immutable', () => {
      const block = findBlock('/')!
      expect(block.values['Cache-Control']).not.toContain('immutable')
    })

    it('/index.html Cache-Control includes must-revalidate', () => {
      const block = findBlock('/index.html')
      expect(
        block,
        'Missing [[headers]] block for /index.html',
      ).toBeDefined()
      expect(block!.values['Cache-Control']).toContain('must-revalidate')
    })

    it('/index.html Cache-Control does NOT include immutable', () => {
      const block = findBlock('/index.html')!
      expect(block.values['Cache-Control']).not.toContain('immutable')
    })
  })

  describe('Requirement 6.7: API block carries Vary: Accept-Encoding', () => {
    it('has a [[headers]] block for /api/*', () => {
      const block = findBlock('/api/*')
      expect(block, 'Missing [[headers]] block for /api/*').toBeDefined()
    })

    it('/api/* includes Vary: Accept-Encoding', () => {
      const block = findBlock('/api/*')!
      expect(block.values['Vary']).toBe('Accept-Encoding')
    })
  })
})
