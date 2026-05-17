import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Monogram } from '@/components/brand/Monogram'
import { Wordmark } from '@/components/brand/Wordmark'
import { supabase } from '@/lib/supabaseClient'

/**
 * `/sign-in` route — custom email + password form backed by Supabase Auth.
 *
 * Replaces the previous Clerk hosted `<SignIn />` widget with a primitive
 * form built from Design_System parts (`Button`, `Input`, `Label`) so the
 * sign-in screen stays visually consistent with the rest of the redesigned
 * app. Two modes share the same form chrome:
 *
 *   - "sign-in": calls `signInWithPassword({ email, password })`
 *   - "sign-up": calls `signUp({ email, password })`. With email
 *      confirmation enabled (Supabase default) the user receives a
 *      verification email; we surface that as an in-form notice rather
 *      than a redirect.
 *
 * Once a session exists the `_authed` route's `onAuthStateChange` handler
 * already manages the redirect, so this page only needs to push to
 * `/tasks` defensively if a session is detected here.
 */
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

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      if (data.session) navigate({ to: '/tasks' as never, replace: true })
    })
    return () => {
      cancelled = true
    }
  }, [navigate])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
        navigate({ to: '/tasks' as never, replace: true })
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        // If email confirmation is off, we get a session immediately and
        // the auth state listener routes us. If confirmation is on, the
        // session is null and we surface a check-your-inbox notice.
        if (data.session) {
          navigate({ to: '/tasks' as never, replace: true })
        } else {
          setNotice(
            'Account created. Check your email to confirm your address before signing in.',
          )
          setMode('sign-in')
        }
      }
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
