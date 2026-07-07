#!/usr/bin/env node
import { config } from 'dotenv'
import { createClient } from '@libsql/client'

config()

const [oldId, newId] = process.argv.slice(2)

if (!oldId || !newId) {
  console.error('Usage: node scripts/migrate-user-ids.mjs <old-uuid> <new-uuid>')
  process.exit(1)
}

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url) {
  console.error('TURSO_DATABASE_URL not set in environment')
  process.exit(2)
}

const client = createClient({ url, authToken })

// List of all tables that reference user_id based on schema.ts
const tables = [
  'profiles',
  'pomodoros',
  'tasks',
  'daily_tracking',
  'habits',
  'habit_logs',
  'chat_sessions',
  'chat_messages',
  'notebooks',
  'pages',
  'market_assets',
  'workspace_connections'
]

async function migrate() {
  console.log(`Migrating user IDs from ${oldId} to ${newId}...`)
  
  try {
    for (const table of tables) {
      console.log(`Updating ${table}...`)
      const res = await client.execute({
        sql: `UPDATE ${table} SET user_id = ? WHERE user_id = ?`,
        args: [newId, oldId]
      })
      console.log(`  ✓ Updated ${res.rowsAffected} rows in ${table}`)
    }

    console.log('Migration complete.')
  } catch (err) {
    console.error('Migration failed:', err)
  } finally {
    client.close()
  }
}

migrate()
