#!/usr/bin/env node
/**
 * One-shot helper to generate a 32-byte AES-256 key for the Workspace
 * encryption layer. Output is base64; paste into .env as
 * WORKSPACE_SECRET_KEY.
 *
 * Usage:
 *   node scripts/generate-workspace-key.mjs
 *
 * After rotating the key, every existing `workspace_connections.secret_encrypted`
 * row becomes undecryptable — users will need to reconnect.
 */

import { randomBytes } from 'node:crypto'

const key = randomBytes(32).toString('base64')
console.log('')
console.log('Generated 32-byte AES-256 key (base64):')
console.log('')
console.log(`  WORKSPACE_SECRET_KEY=${key}`)
console.log('')
console.log('Add the line above to your .env (and to your production secrets).')
console.log("Don't commit it. Rotating it invalidates every existing connection.")
console.log('')
