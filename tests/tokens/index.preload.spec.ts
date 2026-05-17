import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Validates: Requirements 14.2
 * index.html preloads the Inter woff2 font.
 */
describe('Index font preload', () => {
  const indexHtml = readFileSync(
    resolve(__dirname, '../../index.html'),
    'utf-8',
  )

  it('index.html contains a preload link for Inter woff2', () => {
    // Should have a <link rel="preload" ... href="...Inter...woff2" ...>
    expect(indexHtml).toMatch(
      /<link[^>]+rel=["']preload["'][^>]+href=["'][^"']*Inter[^"']*\.woff2["']/i,
    )
  })

  it('preload link specifies as="font" and type="font/woff2"', () => {
    expect(indexHtml).toMatch(/<link[^>]+as=["']font["']/i)
    expect(indexHtml).toMatch(/<link[^>]+type=["']font\/woff2["']/i)
  })

  it('preload link includes crossorigin attribute', () => {
    // Font preloads require crossorigin for CORS
    expect(indexHtml).toMatch(/<link[^>]+rel=["']preload["'][^>]+crossorigin/i)
  })
})
