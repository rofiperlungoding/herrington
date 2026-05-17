import fs from 'node:fs'
const c = fs.readFileSync('dist/assets/index-DhTaT-Zd.js', 'utf8')
const probes = [
  'phoenix',
  'realtime',
  'GOTRUE',
  'autoRefreshToken',
  'refreshSession',
  'postgrest',
  'PostgrestBuilder',
  'signInWithPassword',
  'onAuthStateChange',
  'jwtVerify',
  'jose',
  'lucide',
  'createLucideIcon',
  'icons',
  'tabbable',
  'use-sync-external-store',
  'class-variance-authority',
  'twMerge',
  'tailwind-merge',
  'zustand',
  'zod',
  'TanStack',
  'tanstack',
  '/router',
  '/react-query',
  'router-plugin',
  'sonner',
  'cmdk',
]
for (const p of probes) {
  const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  const n = (c.match(re) || []).length
  console.log(p + ':', n)
}
console.log('TOTAL_LEN', c.length)
