// scripts/verify-migration-explain.mjs
//
// Spec: performance-optimization (Task 4.2)
// Requirements: 8.4, 8.5, 12.5
//
// Purpose:
//   Apply the generated Drizzle migration against a transient local libSQL
//   file (NOT Turso) and capture the EXPLAIN QUERY PLAN for the canonical
//   list-by-user queries on `tasks` and `habits`. The output is printed to
//   stdout so it can be pasted into the PR description as evidence that the
//   new indexes are picked by the optimizer.
//
// Usage:
//   node scripts/verify-migration-explain.mjs
//
// Notes:
//   - Uses an on-disk file under .build-tmp/ so the libSQL local client is
//     happy with file:// URLs. The file is deleted at the end of the run so
//     reruns are deterministic and the migration's `IF NOT EXISTS` clauses
//     are exercised against a clean schema each time.
//   - Also re-applies the migration a second time to prove idempotency
//     (Requirement 8.5). A non-idempotent migration would error on the
//     second run.

import { createClient } from '@libsql/client';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const tmpDir = join(repoRoot, '.build-tmp');
const dbPath = join(tmpDir, 'verify-migration.db');
const migrationPath = join(repoRoot, 'drizzle', '0000_add_user_id_indexes.sql');

if (existsSync(dbPath)) rmSync(dbPath);
mkdirSync(tmpDir, { recursive: true });

const sql = readFileSync(migrationPath, 'utf8');
// Drizzle uses `--> statement-breakpoint` between statements.
const statements = sql
  .split(/-->\s*statement-breakpoint/gi)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !/^--/.test(s.split('\n').filter((l) => !l.startsWith('--')).join('\n').trim()) || s.split('\n').some((l) => !l.trim().startsWith('--') && l.trim().length > 0))
  .map((s) =>
    // Strip leading `--` comment-only lines so libSQL only sees real DDL.
    s
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .trim(),
  )
  .filter((s) => s.length > 0);

const client = createClient({ url: `file:${dbPath}` });

async function applyMigration(label) {
  console.log(`\n--- Applying migration (${label}) ---`);
  for (const stmt of statements) {
    await client.execute(stmt);
  }
  console.log(`Applied ${statements.length} statements without error.`);
}

async function explain(query, args = []) {
  const res = await client.execute({ sql: `EXPLAIN QUERY PLAN ${query}`, args });
  return res.rows.map((r) => Object.fromEntries(Object.entries(r)));
}

try {
  await applyMigration('first run on clean DB');
  await applyMigration('second run — idempotency check');

  console.log('\n=== EXPLAIN QUERY PLAN: SELECT * FROM tasks WHERE user_id = ? ===');
  const tasksPlan = await explain('SELECT * FROM tasks WHERE user_id = ?', ['user-1']);
  for (const row of tasksPlan) console.log(JSON.stringify(row));

  console.log('\n=== EXPLAIN QUERY PLAN: SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC ===');
  const tasksOrderedPlan = await explain('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC', ['user-1']);
  for (const row of tasksOrderedPlan) console.log(JSON.stringify(row));

  console.log('\n=== EXPLAIN QUERY PLAN: SELECT * FROM habits WHERE user_id = ? ===');
  const habitsPlan = await explain('SELECT * FROM habits WHERE user_id = ?', ['user-1']);
  for (const row of habitsPlan) console.log(JSON.stringify(row));

  // Sanity assertion: every plan must reference an index, not a SCAN.
  const allRows = [...tasksPlan, ...tasksOrderedPlan, ...habitsPlan];
  const detailField = allRows
    .map((r) => r.detail || r.description || '')
    .join(' | ');
  console.log('\nDetail field summary:', detailField);
  const usesIndex =
    /idx_tasks_user_created|idx_tasks_user|idx_habits_user/.test(detailField) &&
    !/SCAN tasks(\s|$)/i.test(detailField) &&
    !/SCAN habits(\s|$)/i.test(detailField);
  if (!usesIndex) {
    console.error(
      '\nFAIL: query plan does not reference one of the new indexes (Requirement 8.4).',
    );
    process.exitCode = 1;
  } else {
    console.log('\nOK: query plans reference the new indexes (Requirement 8.4 satisfied).');
  }
} finally {
  client.close();
  // Best-effort cleanup. On Windows, libSQL may briefly retain a handle on the
  // sqlite file after `client.close()`; ignore EPERM here so the script's exit
  // code reflects the verification outcome, not a benign cleanup race.
  try {
    if (existsSync(dbPath)) rmSync(dbPath);
  } catch (err) {
    if (err && err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
  }
}
