import * as React from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, LogOut } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Avatar } from '@/components/profile/Avatar'
import { WorkspaceConnectionsSection } from '@/components/profile/WorkspaceConnectionsSection'
import {
  ACCENT_OPTIONS,
} from '@/components/profile/ThemeProvider'
import {
  profileQueryOptions,
  useProfile,
  useUpdateProfile,
  type AccentKey,
} from '@/hooks/useProfile'
import { useSmartNotifications } from '@/hooks/useSmartNotifications'
import { queryClient } from '@/lib/queryClient'
import { supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'

/**
 * Profile + preferences page.
 *
 * Sections:
 *   1. Identity — display name, preferred name, headline, location.
 *   2. Avatar  — pick an emoji glyph + accent color.
 *   3. Appearance — theme override (auto/light/dark) + accent preset.
 *   4. Dashboard — toggles for which tiles appear.
 *
 * Each section saves on blur via a debounced patch so users never see
 * a "Save" button — the page feels instant. A small "Saved" indicator
 * appears next to the relevant field when a write resolves.
 */
export const Route = createFileRoute('/_authed/settings/profile')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(profileQueryOptions).catch(() => undefined),
  component: ProfileSettingsPage,
})

function ProfileSettingsPage() {
  const profile = useProfile()
  const update = useUpdateProfile()
  const navigate = useNavigate()
  const notif = useSmartNotifications()

  async function handleSignOut() {
    await supabase.auth.signOut()
    queryClient.clear()
    navigate({ to: '/sign-in' as never })
  }

  // Local optimistic state so typing feels instant. Server is the
  // source of truth — we sync down whenever the query refetches.
  const [draft, setDraft] = React.useState({
    displayName: '',
    preferredName: '',
    headline: '',
    locationLabel: '',
    avatarEmoji: '',
  })
  React.useEffect(() => {
    if (!profile.data) return
    setDraft({
      displayName: profile.data.displayName ?? '',
      preferredName: profile.data.preferredName ?? '',
      headline: profile.data.headline ?? '',
      locationLabel: profile.data.locationLabel ?? '',
      avatarEmoji: profile.data.avatarEmoji ?? '',
    })
  }, [profile.data])

  function commit(field: keyof typeof draft, value: string) {
    const trimmed = value.trim()
    const current = profile.data?.[field as keyof typeof profile.data]
    const normalized = trimmed.length === 0 ? null : trimmed
    if (current === normalized) return
    update.mutate({ [field]: normalized } as Parameters<typeof update.mutate>[0])
  }

  if (profile.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-24 p-24 md:p-32">
        <p className="text-body text-on-surface-muted">A moment…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-32 p-24 md:p-32">
      <PageHeader
        eyebrow="Settings"
        title="Profile"
        description="How the app addresses you and what it shows on your dashboard."
      />

      {/* Identity preview */}
      <section className="flex items-center gap-16 rounded-lg border border-border bg-surface p-20">
        <Avatar
          name={draft.displayName || draft.preferredName}
          emoji={draft.avatarEmoji || profile.data?.avatarEmoji}
          color={profile.data?.avatarColor ?? null}
          size={64}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <p className="truncate text-title font-semibold text-on-surface">
            {draft.preferredName || draft.displayName || 'Your name'}
          </p>
          {draft.headline && (
            <p className="truncate text-body text-on-surface-muted">
              {draft.headline}
            </p>
          )}
          {draft.locationLabel && (
            <p className="truncate text-caption text-on-surface-muted">
              {draft.locationLabel}
            </p>
          )}
        </div>
      </section>

      {/* Identity form */}
      <Section title="Identity" description="Used for greetings and account display.">
        <Field label="Display name" hint="Shown in the sidebar and on your avatar fallback.">
          <Input
            value={draft.displayName}
            onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
            onBlur={() => commit('displayName', draft.displayName)}
            placeholder="Jane Doe"
            maxLength={80}
          />
        </Field>
        <Field
          label="Preferred name"
          hint="What the assistant calls you. Falls back to display name if empty."
        >
          <Input
            value={draft.preferredName}
            onChange={(e) => setDraft({ ...draft, preferredName: e.target.value })}
            onBlur={() => commit('preferredName', draft.preferredName)}
            placeholder="Jane"
            maxLength={40}
          />
        </Field>
        <Field label="Headline" hint="One-line description (optional).">
          <Input
            value={draft.headline}
            onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
            onBlur={() => commit('headline', draft.headline)}
            placeholder="Engineer · Late-night learner"
            maxLength={160}
          />
        </Field>
        <Field label="Location" hint="Free-form. Shown on the dashboard.">
          <Input
            value={draft.locationLabel}
            onChange={(e) => setDraft({ ...draft, locationLabel: e.target.value })}
            onBlur={() => commit('locationLabel', draft.locationLabel)}
            placeholder="Jakarta, ID"
            maxLength={80}
          />
        </Field>
      </Section>

      {/* Avatar */}
      <Section
        title="Avatar"
        description="Pick an emoji and an accent color for your avatar."
      >
        <Field label="Emoji" hint="A single character. Leave empty for an initial.">
          <Input
            value={draft.avatarEmoji}
            onChange={(e) => setDraft({ ...draft, avatarEmoji: e.target.value })}
            onBlur={() => commit('avatarEmoji', draft.avatarEmoji)}
            placeholder="🦊"
            maxLength={4}
            className="w-[80px] text-center text-title"
          />
        </Field>
        <Field label="Avatar color" hint="Sets the disc tint behind the emoji or initial.">
          <ColorPicker
            value={profile.data?.avatarColor ?? null}
            onChange={(color) => update.mutate({ avatarColor: color })}
          />
        </Field>
      </Section>

      {/* Appearance */}
      <Section title="Appearance" description="Pick an accent color.">
        <Field label="Accent">
          <AccentPicker
            value={profile.data?.accent ?? 'default'}
            onChange={(v) => update.mutate({ accent: v })}
          />
        </Field>
      </Section>

      {/* Dashboard prefs */}
      <Section title="Dashboard" description="Hide tiles you don't use.">
        <Toggle
          label="Markets tile"
          hint="Shows USD/IDR and a basket of indices and crypto."
          checked={profile.data?.showMarkets ?? true}
          onChange={(v) => update.mutate({ showMarkets: v })}
        />
        <Toggle
          label="Weather tile"
          hint="Requires browser geolocation permission."
          checked={profile.data?.showWeather ?? true}
          onChange={(v) => update.mutate({ showWeather: v })}
        />
      </Section>

      {/* Notifications */}
      <Section
        title="Notifications"
        description="Local browser pushes — only fires while the app is open."
      >
        <Toggle
          label="Smart nudges"
          hint={
            notif.permission === 'unsupported'
              ? 'Your browser does not support notifications.'
              : notif.permission === 'denied'
                ? 'Notifications are blocked. Enable them in your browser site settings.'
                : 'Pings you when a deadline is < 2h away or a streak is about to break (after 22:00).'
          }
          checked={notif.enabled && notif.permission === 'granted'}
          onChange={async (v) => {
            if (notif.permission === 'unsupported' || notif.permission === 'denied') {
              return
            }
            if (v && notif.permission !== 'granted') {
              const result = await notif.requestPermission()
              if (result === 'granted') {
                notif.setEnabled(true)
              }
            } else {
              notif.setEnabled(v)
            }
          }}
        />
      </Section>

      {/* Workspace integrations */}
      <WorkspaceConnectionsSection />

      {/* Account — quiet sign-out link at the page foot. */}
      <div className="flex justify-end pt-12">
        <button
          type="button"
          onClick={handleSignOut}
          className={cn(
            'inline-flex items-center gap-8 text-caption text-on-surface-muted',
            'transition-colors duration-fast ease-standard',
            'hover:text-on-surface',
          )}
        >
          <LogOut className="h-12 w-12" aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  )
}

// ─── Section building blocks ───────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-16">
      <div className="flex flex-col gap-4">
        <h2 className="text-title font-semibold text-on-surface">{title}</h2>
        {description && (
          <p className="text-caption text-on-surface-muted">{description}</p>
        )}
      </div>
      <div className="flex flex-col gap-12 rounded-lg border border-border bg-surface p-20">
        {children}
      </div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      <Label className="mb-8">{label}</Label>
      {children}
      {hint && (
        <p className="mt-8 text-caption text-on-surface-muted">{hint}</p>
      )}
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-16">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <span className="text-body font-medium text-on-surface">{label}</span>
        {hint && (
          <span className="text-caption text-on-surface-muted">{hint}</span>
        )}
      </div>
      {/*
        Toggle pill. Dimensions/visuals are inlined to bypass the project's
        Tailwind config that strips the default spacing scale and was
        clipping the arbitrary pixel utilities — knob ended up bleeding
        outside the track. Plain inline CSS removes any class collisions.
      */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative',
          flexShrink: 0,
          marginTop: '3px',
          width: '44px',
          height: '24px',
          borderRadius: '9999px',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          backgroundColor: checked ? 'var(--color-primary)' : '#e5e7eb',
          transition: 'background-color 200ms ease-out',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '2px',
            left: checked ? '22px' : '2px',
            width: '20px',
            height: '20px',
            borderRadius: '9999px',
            backgroundColor: '#ffffff',
            boxShadow:
              '0 1px 2px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.10)',
            transition: 'left 200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        />
      </button>
    </div>
  )
}

function AccentPicker({
  value,
  onChange,
}: {
  value: AccentKey
  onChange: (v: AccentKey) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-12">
      {ACCENT_OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-label={o.label}
          aria-pressed={value === o.key}
          className={cn(
            'inline-flex h-32 w-32 shrink-0 items-center justify-center rounded-full',
            'transition-shadow duration-fast ease-standard',
            value === o.key &&
              'shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-primary)]',
          )}
          style={{ background: o.swatch }}
        >
          {value === o.key && (
            <Check className="h-16 w-16 text-on-primary" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  )
}

const COLOR_PRESETS = [
  '#1a73e8',
  '#137333',
  '#b06000',
  '#c5221f',
  '#7e57c2',
  '#0097a7',
  '#e91e63',
  '#1f1f1f',
]

function ColorPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (color: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-12">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label="Reset to auto color"
        aria-pressed={!value}
        className={cn(
          'inline-flex h-32 shrink-0 items-center justify-center rounded-full border border-border bg-surface-variant px-12',
          'transition-shadow duration-fast ease-standard',
          !value &&
            'shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-primary)]',
        )}
      >
        <span className="text-caption text-on-surface-muted">Auto</span>
      </button>
      {COLOR_PRESETS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Set avatar color to ${c}`}
          aria-pressed={value === c}
          className={cn(
            'inline-flex h-32 w-32 shrink-0 items-center justify-center rounded-full',
            'transition-shadow duration-fast ease-standard',
            value === c &&
              'shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-primary)]',
          )}
          style={{ background: c }}
        >
          {value === c && (
            <Check className="h-16 w-16 text-on-primary" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  )
}
