#!/usr/bin/env node
// scripts/verify-db-indexes.mjs
//
// Spec: performance-optimization (Task 13.6)
// Requirements: 8.4, 12.5
//
// Purpose:
//   Connects to the configured libSQL/Turso database and runs EXPLAIN QUERY
//   PLAN for the canonical list-by-user queries on `tasks` and `habits`.
//   Asserts that the query planner references the indexes declared in
//   Requirement 8 (idx_tasks_user, idx_tasks_user_created, idx_habits_user)
//   rather than performing full table scans.
//
// Environment variables:
//   TURSO_DATABASE_URL  — libSQL/Turso connection URL (required)
//   TURSO_AUTH_TOKEN    — Auth token for Turso (required for remote DBs)
//
// Usage:
//   node scripts/verify-db-indexes.mjs
//
// Exit codes:
//   0 — All queries use the expected indexes
//   1 — One or more queries do NOT use the expected indexes (full scan detected)
//   0 — (with skip message) if the database is not reachable (CI-safe)
//
// Notes:
//   - In CI where the DB may not be reachable, the script prints a SKIP
//     message and exits 0 so it doesn't block unrelated pipelines.
//   - This script MUST be run locally before merge to confirm index usage.

import { createClient } from '@libsql/client';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_URL = process.env.TURSO_DATABASE_URL;
const AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!DB_URL) {
  console.log('⏭️  SKIP: TURSO_DATABASE_URL is not set.');
  console.log('   This script requires a reachable libSQL/Turso database.');
  console.log('   Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for remote DBs) to run locally.');
  process.exitCode = 0;
  // Force exit immediately for the skip case (no async handles open).
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Expected indexes from Requirement 8
// ---------------------------------------------------------------------------

const EXPECTED_INDEXES = {
  tasks: ['idx_tasks_user', 'idx_tasks_user_created'],
  habits: ['idx_habits_user'],
};

// Queries to verify
const QUERIES = [
  {
    label: 'SELECT * FROM tasks WHERE user_id = ?',
    sql: 'SELECT * FROM tasks WHERE user_id = ?',
    args: ['test-user-verify'],
    table: 'tasks',
    expectedIndexes: ['idx_tasks_user', 'idx_tasks_user_created'],
  },
  {
    label: 'SELECT * FROM habits WHERE user_id = ?',
    sql: 'SELECT * FROM habits WHERE user_id = ?',
    args: ['test-user-verify'],
    table: 'habits',
    expectedIndexes: ['idx_habits_user'],
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let client;

  try {
    client = createClient({
      url: DB_URL,
      authToken: AUTH_TOKEN || undefined,
    });

    // Quick connectivity check
    await client.execute('SELECT 1');
  } catch (err) {
    console.log('⏭️  SKIP: Could not connect to the database.');
    console.log(`   URL: ${DB_URL}`);
    console.log(`   Error: ${err.message || err}`);
    console.log('');
    console.log('   In CI this is expected if the DB is not reachable.');
    console.log('   Run this script locally before merge to verify index usage.');
    if (client) client.close();
    process.exitCode = 0;
    return;
  }

  console.log(`✓ Connected to: ${DB_URL}\n`);

  let allPassed = true;
  const failures = [];

  for (const query of QUERIES) {
    console.log(`--- EXPLAIN QUERY PLAN: ${query.label} ---`);

    try {
      const result = await client.execute({
        sql: `EXPLAIN QUERY PLAN ${query.sql}`,
        args: query.args,
      });

      const rows = result.rows.map((r) => Object.fromEntries(Object.entries(r)));
      for (const row of rows) {
        console.log(`  ${JSON.stringify(row)}`);
      }

      // Extract the detail/description field from the query plan rows
      const details = rows
        .map((r) => r.detail || r.description || '')
        .join(' | ');

      console.log(`  Detail: ${details}`);

      // Check that at least one expected index is referenced
      const usesExpectedIndex = query.expectedIndexes.some((idx) =>
        details.includes(idx)
      );

      // Check for full table scan (bad)
      const hasFullScan = new RegExp(`SCAN ${query.table}(\\s|$)`, 'i').test(details);

      if (usesExpectedIndex && !hasFullScan) {
        console.log(`  ✓ PASS: Uses index (one of: ${query.expectedIndexes.join(', ')})\n`);
      } else {
        const reason = hasFullScan
          ? `Full table scan detected on '${query.table}'`
          : `No expected index referenced (expected one of: ${query.expectedIndexes.join(', ')})`;
        console.log(`  ✗ FAIL: ${reason}\n`);
        failures.push({ query: query.label, reason, details });
        allPassed = false;
      }
    } catch (err) {
      // If the table doesn't exist yet (no migration applied), skip gracefully
      if (err.message && /no such table/i.test(err.message)) {
        console.log(`  ⏭️  SKIP: Table '${query.table}' does not exist (migration not applied?)\n`);
        console.log('   Run migrations first, then re-run this script.');
        failures.push({ query: query.label, reason: `Table '${query.table}' does not exist`, details: err.message });
        allPassed = false;
      } else {
        throw err;
      }
    }
  }

  client.close();

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log('=== Summary ===');
  if (allPassed) {
    console.log('✓ All queries use the expected database indexes.');
    console.log('  Requirement 8.4 satisfied: query plans reference idx_tasks_user,');
    console.log('  idx_tasks_user_created, and/or idx_habits_user.');
    process.exitCode = 0;
  } else {
    console.error('✗ FAILED: One or more queries do not use the expected indexes.');
    console.error('');
    for (const f of failures) {
      console.error(`  Query: ${f.query}`);
      console.error(`  Reason: ${f.reason}`);
      console.error(`  Plan details: ${f.details}`);
      console.error('');
    }
    console.error('  Ensure migrations have been applied and indexes exist.');
    console.error('  Expected indexes: idx_tasks_user, idx_tasks_user_created, idx_habits_user');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
}).finally(() => {
  // Force immediate exit to avoid native module cleanup crashes on Windows.
  // The libSQL client's libuv handle can trigger an assertion failure during
  // garbage collection after client.close(). A short delay ensures pending
  // I/O completes before we terminate.
  setTimeout(() => process.exit(process.exitCode || 0), 50);
});
