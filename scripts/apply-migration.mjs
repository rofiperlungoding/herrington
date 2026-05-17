#!/usr/bin/env node
// Quick one-shot migration runner. Reads a SQL file path as argv and
// executes its statements against TURSO_DATABASE_URL.
//
// Usage: node scripts/apply-migration.mjs drizzle/0002_chat_sessions.sql

import { readFileSync } from 'node:fs'
import { config } from 'dotenv'
import { createClient } from '@libsql/client'

config()

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/apply-migration.mjs <path-to-sql>')
  process.exit(2)
}

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url) {
  console.error('TURSO_DATABASE_URL not set in environment')
  process.exit(2)
}

const sql = readFileSync(file, 'utf-8')
const statements = sql
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  // Strip line comments
  .map((s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n'))
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

const client = createClient({ url, authToken })

console.log(`Applying ${statements.length} statement(s) from ${file}...`)
let i = 0
for (const stmt of statements) {
  i++
  const head = stmt.slice(0, 80).replace(/\s+/g, ' ')
  try {
    await client.execute(stmt)
    console.log(`  [${i}/${statements.length}] ✓ ${head}`)
  } catch (err) {
    const msg = err.message || String(err)
    // Tolerate "duplicate column name" so re-running is safe.
    if (/duplicate column name/i.test(msg)) {
      console.log(`  [${i}/${statements.length}] ↷ skipped (already applied): ${head}`)
      continue
    }
    console.error(`  [${i}/${statements.length}] ✗ failed: ${head}`)
    console.error(`     ${msg}`)
    process.exit(1)
  }
}

client.close()
console.log('Done.')
process.exit(0)
