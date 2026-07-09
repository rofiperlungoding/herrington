import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Monogram } from '@/components/brand/Monogram'
import { Wordmark } from '@/components/brand/Wordmark'
import { useAuthStore, useSession } from '@/lib/authStore'

export const Route = createFileRoute('/sign-in')({
  component: SignInPage,
})

type Mode = 'sign-in' | 'sign-up'

function SignInPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { session, ready } = useSession()

  useEffect(() => {
    if (ready && session) {
      navigate({ to: '/tasks' as never, replace: true })
    }
  }, [ready, session, navigate])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      const endpoint = mode === 'sign-in' ? '/api/sign-in' : '/api/sign-up'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        throw new Error((await res.json()).message || 'Authentication failed')
      }

      const data = await res.json()
      useAuthStore.getState().setSession(data.session)
      navigate({ to: '/tasks' as never, replace: true })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Authentication failed. Try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-24 bg-surface">
      <div className="w-full max-w-sm flex flex-col gap-32">
        <div className="flex flex-col items-center gap-12 anim-fade-in">
          <span className="inline-flex h-48 w-48 items-center justify-center rounded-md bg-brand-conservatory text-brand-brass">
            <Monogram size={28} />
          </span>
          <Wordmark size="lg" className="text-on-surface" />
          <p className="text-caption uppercase tracking-wider text-on-surface-muted">
            In good order.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="w-full flex flex-col gap-16 rounded-lg border border-border bg-surface p-24 shadow-e1"
        >
          <div className="flex flex-col gap-4">
            <h1 className="font-display text-headline font-medium tracking-tight text-on-surface">
              {mode === 'sign-in' ? 'Sign in' : 'Create an account'}
            </h1>
          <p className="text-body text-on-surface-muted">
            {mode === 'sign-in'
              ? 'Welcome back. Pick up where you left off.'
              : 'Create an account to get things in good order.'}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={
              mode === 'sign-in' ? 'current-password' : 'new-password'
            }
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error ? (
          <p className="text-caption text-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="text-caption text-on-surface-muted">{notice}</p>
        ) : null}

        <Button type="submit" variant="brand" loading={submitting}>
          {mode === 'sign-in' ? 'Sign in' : 'Sign up'}
        </Button>

        <button
          type="button"
          className="text-caption text-primary hover:underline"
          onClick={() => {
            setMode((m) => (m === 'sign-in' ? 'sign-up' : 'sign-in'))
            setError(null)
            setNotice(null)
          }}
        >
          {mode === 'sign-in'
            ? "Don't have an account? Sign up"
            : 'Already have an account? Sign in'}
        </button>
        </form>
      </div>
    </div>
  )
}
