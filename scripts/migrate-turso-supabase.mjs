/**
 * One-shot Turso schema migration: drop the old `users` table and recreate
 * `tasks`, `habits`, and any other user-scoped tables without the FK to
 * `users`. Existing dev rows are wiped because their `user_id` values come
 * from the old Clerk/Turso provisioning flow and have no meaning under
 * Supabase Auth.
 *
 * Run with: `node scripts/migrate-turso-supabase.mjs`
 */
import 'dotenv/config'
import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env')
  process.exit(1)
}

const db = createClient({ url, authToken })

const statements = [
  'DROP TABLE IF EXISTS documents',
  'DROP TABLE IF EXISTS idea_vault',
  'DROP TABLE IF EXISTS ai_chat_history',
  'DROP TABLE IF EXISTS habits',
  'DROP TABLE IF EXISTS tasks',
  'DROP TABLE IF EXISTS users',
  `CREATE TABLE tasks (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     title TEXT NOT NULL,
     category TEXT NOT NULL,
     is_completed INTEGER NOT NULL DEFAULT 0,
     deadline INTEGER,
     created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
   )`,
  'CREATE INDEX idx_tasks_user_id ON tasks (user_id)',
  `CREATE TABLE habits (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     title TEXT NOT NULL,
     current_streak INTEGER NOT NULL DEFAULT 0,
     longest_streak INTEGER NOT NULL DEFAULT 0,
     last_completed_date INTEGER
   )`,
  'CREATE INDEX idx_habits_user_id ON habits (user_id)',
  `CREATE TABLE ai_chat_history (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
   )`,
  'CREATE INDEX idx_ai_chat_user_id ON ai_chat_history (user_id)',
  `CREATE TABLE idea_vault (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     title TEXT NOT NULL,
     keywords TEXT NOT NULL,
     generated_concept TEXT NOT NULL,
     created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
   )`,
  'CREATE INDEX idx_idea_vault_user_id ON idea_vault (user_id)',
  `CREATE TABLE documents (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     title TEXT NOT NULL,
     content_chunk TEXT NOT NULL,
     embedding F32_BLOB,
     created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
   )`,
  'CREATE INDEX idx_documents_user_id ON documents (user_id)',
]

for (const sql of statements) {
  process.stdout.write(`> ${sql.split('\n')[0].slice(0, 80)}...\n`)
  await db.execute(sql)
}

console.log('Turso migration complete')
process.exit(0)
