// Reproducible snapshot of the test-count baseline used as the
// non-regression gate for the performance-optimization spec (task W1.6,
// Requirement 13.4). Runs `vitest list`, parses the per-test entries,
// groups them by their top-level directory under `tests/`, and writes
// the result to `baseline-test-count.json` at the repo root.
//
// Output shape:
//   {
//     "tests/<dir>": <n>,
//     ...,
//     "total": <n>
//   }
//
// `tests/unit` and `tests/integration` are always emitted (with a count
// of 0 if no tests are present yet) because Requirement 13.4 names them
// explicitly as the gate. Any other `tests/<dir>` that contains at least
// one test is also emitted with its own count.
//
// Usage:
//   node scripts/baseline-test-count.mjs
//   node scripts/baseline-test-count.mjs --check   # exit 1 on regression
//
// The script never modifies test sources. It is safe to run repeatedly;
// rerunning regenerates the JSON deterministically from the current suite.

import { spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT_PATH = resolve(REPO_ROOT, 'baseline-test-count.json')

// Top-level dirs under `tests/` that the spec calls out by name. They are
// always emitted so the JSON shape stays stable even when one becomes
// empty.
const REQUIRED_DIRS = ['tests/unit', 'tests/integration']

function runVitestList() {
  // Invoke vitest's package entrypoint directly via Node. This avoids the
  // shell-quoting issues that plague the npm/.bin shims when the repo
  // path contains spaces on Windows.
  const vitestEntry = resolve(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs')
  const result = spawnSync(
    process.execPath,
    [vitestEntry, 'list'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1' },
      shell: false,
      maxBuffer: 32 * 1024 * 1024,
    },
  )

  if (result.error) {
    throw new Error(`Failed to spawn vitest: ${result.error.message}`)
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '')
    throw new Error(`vitest list exited with code ${result.status}`)
  }
  return result.stdout
}

/**
 * Parse `vitest list` output. Each test case is printed on its own line
 * starting with the relative spec path (e.g. `tests/components/x.spec.tsx`)
 * followed by ` > <describe> > <it>`. We only care about the path prefix.
 */
function parseTestCounts(stdout) {
  const counts = new Map()
  const lines = stdout.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (!line.startsWith('tests/')) continue
    // Take the first whitespace-separated token, then split off `<dir>` after `tests/`.
    const path = line.split(/\s+/, 1)[0]
    const segments = path.split('/')
    if (segments.length < 3) continue // need at least tests/<dir>/<file>
    const key = `${segments[0]}/${segments[1]}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function buildSnapshot(counts) {
  const snapshot = {}
  for (const required of REQUIRED_DIRS) {
    snapshot[required] = counts.get(required) ?? 0
  }
  // Append every other discovered directory in sorted order so the JSON
  // is stable across runs.
  const extras = [...counts.keys()]
    .filter((k) => !REQUIRED_DIRS.includes(k))
    .sort()
  for (const key of extras) {
    snapshot[key] = counts.get(key) ?? 0
  }
  let total = 0
  for (const key of Object.keys(snapshot)) total += snapshot[key]
  snapshot.total = total
  return snapshot
}

function writeSnapshot(snapshot) {
  const json = JSON.stringify(snapshot, null, 2) + '\n'
  writeFileSync(OUTPUT_PATH, json, 'utf8')
}

function readPrevious() {
  if (!existsSync(OUTPUT_PATH)) return null
  try {
    return JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'))
  } catch {
    return null
  }
}

function checkAgainstBaseline(current, baseline) {
  /** @type {string[]} */
  const regressions = []
  for (const key of Object.keys(baseline)) {
    if (key === 'total') continue
    const before = baseline[key] ?? 0
    const now = current[key] ?? 0
    if (now < before) {
      regressions.push(`${key}: ${before} -> ${now}`)
    }
  }
  if ((current.total ?? 0) < (baseline.total ?? 0)) {
    regressions.push(`total: ${baseline.total} -> ${current.total}`)
  }
  return regressions
}

function main() {
  const args = process.argv.slice(2)
  const checkMode = args.includes('--check')

  const stdout = runVitestList()
  const counts = parseTestCounts(stdout)
  const snapshot = buildSnapshot(counts)

  if (checkMode) {
    const previous = readPrevious()
    if (!previous) {
      process.stderr.write(
        `No existing ${OUTPUT_PATH} to check against. Run without --check first.\n`,
      )
      process.exit(2)
    }
    const regressions = checkAgainstBaseline(snapshot, previous)
    if (regressions.length > 0) {
      process.stderr.write('Test count regression detected:\n')
      for (const r of regressions) process.stderr.write(`  ${r}\n`)
      process.exit(1)
    }
    process.stdout.write('Test count parity OK against baseline.\n')
    return
  }

  writeSnapshot(snapshot)
  process.stdout.write(`${OUTPUT_PATH}\n`)
  process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n')
}

main()
