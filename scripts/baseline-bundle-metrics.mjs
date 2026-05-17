// One-shot helper to compute baseline bundle metrics for the
// performance-optimization spec (task W1.3). Reads dist/ artifacts produced
// by `npm run build` and prints raw + gzip byte sizes per file plus the
// rollup totals required by the BaselineMetrics.bundle struct.
//
// Usage:
//   node scripts/baseline-bundle-metrics.mjs
//
// Output is JSON on stdout so it can be piped or eyeballed.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = 'dist'
const ASSETS_DIR = join(DIST, 'assets')
const FONTS_DIR = join(DIST, 'fonts')

/**
 * gzip with default compression level so numbers are reproducible.
 * Vite/rollup uses level 6 for its gzip estimate; Node's default is also 6.
 */
function gzipSize(buf) {
  return gzipSync(buf).length
}

function listFiles(dir) {
  try {
    return readdirSync(dir).map((name) => join(dir, name))
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    throw err
  }
}

function classify(file) {
  const ext = extname(file).toLowerCase()
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js'
  if (ext === '.css') return 'css'
  return 'other'
}

const assetFiles = listFiles(ASSETS_DIR)
const fontFiles = listFiles(FONTS_DIR)

const perChunk = {}
let totalJsBytes = 0
let totalJsGzipBytes = 0
let totalCssBytes = 0
let totalCssGzipBytes = 0
// Entry chunk = the only/main `index-*.js` (or any single js bundle on
// pre-Wave-2). Pre-Wave-2 there is exactly one .js file in dist/assets, so
// "entry" = that file.
let entryChunkBytes = 0
let entryChunkGzipBytes = 0
let entryChunkName = null

for (const filePath of assetFiles) {
  const stat = statSync(filePath)
  if (!stat.isFile()) continue
  const buf = readFileSync(filePath)
  const rawBytes = buf.byteLength
  const gz = gzipSize(buf)
  const filename = filePath.split(/[\\/]/).slice(-2).join('/') // assets/<name>
  perChunk[filename] = { rawBytes, gzipBytes: gz }
  const kind = classify(filePath)
  if (kind === 'js') {
    totalJsBytes += rawBytes
    totalJsGzipBytes += gz
    // Entry heuristic: pre-Wave-2 there is a single index-*.js
    if (/index-[A-Za-z0-9_-]+\.(js|mjs|cjs)$/.test(filePath)) {
      entryChunkBytes = rawBytes
      entryChunkGzipBytes = gz
      entryChunkName = filename
    }
  } else if (kind === 'css') {
    totalCssBytes += rawBytes
    totalCssGzipBytes += gz
  }
}

let totalFontBytes = 0
const perFont = {}
for (const filePath of fontFiles) {
  const stat = statSync(filePath)
  if (!stat.isFile()) continue
  const buf = readFileSync(filePath)
  const rawBytes = buf.byteLength
  const filename = filePath.split(/[\\/]/).slice(-2).join('/')
  perFont[filename] = { rawBytes }
  totalFontBytes += rawBytes
}

const out = {
  capturedAt: new Date().toISOString(),
  device: 'mid-tier-4G',
  bundle: {
    entryChunkName,
    entryChunkBytes,
    entryChunkGzipBytes,
    totalJsBytes,
    totalJsGzipBytes,
    totalCssBytes,
    totalCssGzipBytes,
    totalFontBytes,
    perChunk,
    perFont,
  },
}

process.stdout.write(JSON.stringify(out, null, 2) + '\n')
