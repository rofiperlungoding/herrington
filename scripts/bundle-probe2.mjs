import fs from 'node:fs'
const c = fs.readFileSync('dist/assets/index-DhTaT-Zd.js', 'utf8')
const probes = [
  'signInWithPassword',
  'signUp',
  'onAuthStateChange',
  'getSession',
  'autoRefreshToken',
  'GoTrue',
  'supabase',
  'jwt',
  'Realtime',
  'postgrest',
  'jose',
  'jwtVerify',
  'createRemoteJWKSet',
  'TokenManager',
  'wsModule',
  '/storage',
  '/realtime',
  '/auth',
  'WebSocket',
  '@supabase',
  'Phoenix',
  'tabbable',
  'createFileRoute',
  'createRouter',
  'RouterProvider',
  'QueryClient',
]
for (const p of probes) {
  const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const n = (c.match(re) || []).length
  console.log(p + ':', n)
}
