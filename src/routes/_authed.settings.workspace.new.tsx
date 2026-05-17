import * as React from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Lock,
  ShieldCheck,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/apiFetch'
import { cn } from '@/lib/utils'
import { useAddConnection } from '@/hooks/useWorkspaceConnections'

/**
 * `/settings/workspace/new` — connect a Google account.
 *
 * Wizard. One step on screen at a time, big visual, ≤ 2 lines of copy
 * per step. Designed for users who have never opened Apps Script.
 *
 * Flow:
 *   1. Open Apps Script (new tab)
 *   2. Paste the bridge code
 *   3. Save the secret
 *   4. Deploy as Web app
 *   5. Paste URL + finish
 *
 * The secret is generated up front and shown across steps 3 and 5 so
 * the user never has to remember or re-type it. Step 5's form
 * auto-fills the secret too — they only have to paste the URL and
 * type a label.
 */
export const Route = createFileRoute('/_authed/settings/workspace/new')({
  component: AddWorkspaceConnectionPage,
})

const TOTAL_STEPS = 5

function AddWorkspaceConnectionPage() {
  const navigate = useNavigate()
  const add = useAddConnection()

  // Generate the shared secret once on mount. The user pastes the same
  // value into Google (step 3) and Herrington's form (step 5).
  const [secret] = React.useState(generateSecret)

  const [step, setStep] = React.useState(1)
  const [label, setLabel] = React.useState('Personal')
  const [webhookUrl, setWebhookUrl] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)

  function next() {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS))
  }
  function back() {
    setStep((s) => Math.max(s - 1, 1))
  }

  async function handleConnect() {
    setError(null)
    try {
      await add.mutateAsync({
        label: label.trim(),
        webhookUrl: webhookUrl.trim(),
        secret,
      })
      navigate({ to: '/settings/profile' as never })
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Connection failed.',
      )
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-32 p-24 md:p-32">
      <Link
        to={'/settings/profile' as never}
        className="flex items-center gap-4 self-start text-caption text-on-surface-muted hover:text-on-surface"
      >
        <ArrowLeft className="h-12 w-12" aria-hidden="true" />
        Back to settings
      </Link>

      <header className="flex flex-col gap-8">
        <p className="text-caption uppercase tracking-wider text-on-surface-muted">
          Workspace · new connection
        </p>
        <h1 className="font-display text-headline font-medium tracking-tight text-on-surface md:text-display md:leading-[1.05]">
          Connect a Google account
        </h1>
        <p className="text-body text-on-surface-muted">
          Five small steps. Mostly clicking.
        </p>
      </header>

      <Stepper current={step} total={TOTAL_STEPS} />

      <main className="anim-fade-in" key={step}>
        {step === 1 && <Step1 onNext={next} />}
        {step === 2 && <Step2 onNext={next} onBack={back} />}
        {step === 3 && <Step3 secret={secret} onNext={next} onBack={back} />}
        {step === 4 && <Step4 onNext={next} onBack={back} />}
        {step === 5 && (
          <Step5
            label={label}
            setLabel={setLabel}
            webhookUrl={webhookUrl}
            setWebhookUrl={setWebhookUrl}
            secret={secret}
            error={error}
            submitting={add.isPending}
            onSubmit={handleConnect}
            onBack={back}
          />
        )}
      </main>

      <PrivacyFooter />
    </div>
  )
}

// ─── Stepper ───────────────────────────────────────────────────────────────

function Stepper({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-8" aria-label={`Step ${current} of ${total}`}>
      {Array.from({ length: total }).map((_, i) => {
        const n = i + 1
        const state = n < current ? 'done' : n === current ? 'current' : 'todo'
        return (
          <React.Fragment key={n}>
            <span
              className={cn(
                'inline-flex h-24 w-24 shrink-0 items-center justify-center rounded-full text-caption font-medium',
                'transition-colors duration-fast ease-standard',
                state === 'done' && 'bg-primary text-on-primary',
                state === 'current' &&
                  'bg-primary-container text-on-primary-container',
                state === 'todo' && 'bg-surface-variant text-on-surface-muted',
              )}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {state === 'done' ? (
                <Check className="h-12 w-12" aria-hidden="true" />
              ) : (
                n
              )}
            </span>
            {n < total && (
              <span
                aria-hidden="true"
                className={cn(
                  'h-px flex-1 transition-colors duration-fast ease-standard',
                  n < current ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── Step 1 — Open Apps Script ─────────────────────────────────────────────

function Step1({ onNext }: { onNext: () => void }) {
  const [opened, setOpened] = React.useState(false)

  function handleOpen() {
    window.open('https://script.google.com', '_blank', 'noopener,noreferrer')
    setOpened(true)
  }

  return (
    <Panel title="Open Google Apps Script" caption="Step 1 — about 30 seconds.">
      <BrowserMock url="script.google.com">
        <div className="flex h-[180px] flex-col items-start gap-12 p-20">
          <p className="text-caption text-on-surface-muted">My Projects</p>
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-8 rounded-pill bg-[#1a73e8] px-16 py-8 text-label font-medium text-white shadow-e1 ring-2 ring-primary/40 ring-offset-2 ring-offset-surface"
          >
            <span className="text-title leading-none">+</span>
            New project
          </button>
          <p className="text-caption text-on-surface-muted">
            Click the blue button when you're there.
          </p>
        </div>
      </BrowserMock>

      <p className="text-body text-on-surface">
        Sign in with the Google account you want to connect, then click{' '}
        <strong>+ New project</strong>.
      </p>

      <StepNav>
        <Button variant="secondary" onClick={handleOpen}>
          <ExternalLink className="h-12 w-12" aria-hidden="true" />
          Open script.google.com
        </Button>
        <Button variant="primary" onClick={onNext} disabled={!opened}>
          {opened ? 'Done — next' : 'Open the link first'}
          <ArrowRight className="h-12 w-12" aria-hidden="true" />
        </Button>
      </StepNav>
    </Panel>
  )
}

// ─── Step 2 — Paste the code ───────────────────────────────────────────────

function Step2({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [copied, setCopied] = React.useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(CODE_GS_CONTENTS)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // browser blocked clipboard — user can fall back to manual select
    }
  }

  return (
    <Panel
      title="Paste this into Code.gs"
      caption="Step 2 — copy, then paste in Apps Script (replace everything)."
    >
      <CodeMock onCopy={handleCopy} copied={copied} />

      <p className="text-body text-on-surface">
        Back in Apps Script: select all (Ctrl/Cmd + A), delete, then paste.
        Save with the floppy-disk icon.
      </p>

      <StepNav>
        <Button variant="text" onClick={onBack}>
          <ArrowLeft className="h-12 w-12" aria-hidden="true" />
          Back
        </Button>
        <Button variant="primary" onClick={onNext} disabled={!copied}>
          {copied ? 'Pasted — next' : 'Copy first'}
          <ArrowRight className="h-12 w-12" aria-hidden="true" />
        </Button>
      </StepNav>
    </Panel>
  )
}

// ─── Step 3 — Save the secret ──────────────────────────────────────────────

function Step3({
  secret,
  onNext,
  onBack,
}: {
  secret: string
  onNext: () => void
  onBack: () => void
}) {
  const [copied, setCopied] = React.useState(false)

  async function handleCopySecret() {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <Panel
      title="Save a secret in Apps Script"
      caption="Step 3 — like a private password between Herrington and your script."
    >
      <SettingsMock secret={secret} />

      <ol className="ml-20 flex list-decimal flex-col gap-4 text-body text-on-surface">
        <li>
          In Apps Script, click the <strong>gear icon</strong> on the left.
        </li>
        <li>
          Scroll to <strong>Script Properties</strong> →{' '}
          <strong>Add property</strong>.
        </li>
        <li>
          Name: <code>SECRET</code>. Paste the value below.
        </li>
      </ol>

      <div className="flex flex-col gap-4">
        <Label>Your secret (we made one for you)</Label>
        <div className="flex items-center gap-8">
          <code className="flex-1 truncate rounded-md bg-surface-variant px-12 py-8 text-caption font-mono text-on-surface">
            {secret}
          </code>
          <Button variant="secondary" size="sm" onClick={handleCopySecret}>
            {copied ? (
              <>
                <Check className="h-12 w-12" aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-12 w-12" aria-hidden="true" />
                Copy
              </>
            )}
          </Button>
        </div>
        <p className="text-caption text-on-surface-muted">
          We'll fill it in automatically at the last step.
        </p>
      </div>

      <StepNav>
        <Button variant="text" onClick={onBack}>
          <ArrowLeft className="h-12 w-12" aria-hidden="true" />
          Back
        </Button>
        <Button variant="primary" onClick={onNext} disabled={!copied}>
          {copied ? 'Saved — next' : 'Copy first'}
          <ArrowRight className="h-12 w-12" aria-hidden="true" />
        </Button>
      </StepNav>
    </Panel>
  )
}

// ─── Step 4 — Deploy ───────────────────────────────────────────────────────

function Step4({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <Panel
      title="Deploy as a Web app"
      caption="Step 4 — gives your script a private URL only Herrington uses."
    >
      <DeployMock />

      <ol className="ml-20 flex list-decimal flex-col gap-4 text-body text-on-surface">
        <li>
          Click <strong>Deploy → New deployment</strong> (top right).
        </li>
        <li>
          Set type to <strong>Web app</strong> using the gear icon.
        </li>
        <li>Match the three settings shown above. Click Deploy.</li>
      </ol>

      <Callout>
        <strong>If Google warns "Google hasn't verified this app":</strong>{' '}
        Click <strong>Advanced</strong> → <strong>Go to (project) (unsafe)</strong>{' '}
        → <strong>Allow</strong>. It's your own script — totally safe.
      </Callout>

      <p className="text-body text-on-surface">
        After deploying, copy the <strong>Web app URL</strong> Google shows. You'll paste it next.
      </p>

      <StepNav>
        <Button variant="text" onClick={onBack}>
          <ArrowLeft className="h-12 w-12" aria-hidden="true" />
          Back
        </Button>
        <Button variant="primary" onClick={onNext}>
          Deployed — next
          <ArrowRight className="h-12 w-12" aria-hidden="true" />
        </Button>
      </StepNav>
    </Panel>
  )
}

// ─── Step 5 — Finish ───────────────────────────────────────────────────────

function Step5({
  label,
  setLabel,
  webhookUrl,
  setWebhookUrl,
  secret,
  error,
  submitting,
  onSubmit,
  onBack,
}: {
  label: string
  setLabel: (v: string) => void
  webhookUrl: string
  setWebhookUrl: (v: string) => void
  secret: string
  error: string | null
  submitting: boolean
  onSubmit: () => void
  onBack: () => void
}) {
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit()
  }

  const submitDisabled = !label.trim() || !webhookUrl.trim() || submitting

  return (
    <Panel
      title="Almost done"
      caption="Step 5 — paste the URL, give the account a name, click Connect."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-16">
        <div className="flex flex-col gap-4">
          <Label htmlFor="webhook">Web app URL from Google</Label>
          <Input
            id="webhook"
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            required
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-4">
          <Label htmlFor="label">Account name</Label>
          <Input
            id="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Personal · Work · Kuliah"
            maxLength={80}
            required
          />
          <p className="text-caption text-on-surface-muted">
            How the assistant should refer to it. ("Check work email...")
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Label>Secret</Label>
          <code className="truncate rounded-md bg-surface-variant px-12 py-8 text-caption font-mono text-on-surface-muted">
            {secret.slice(0, 8)}••••••••••••••••••••{secret.slice(-4)}
          </code>
          <p className="text-caption text-on-surface-muted">
            Filled in for you. Encrypted before saving.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-md border border-error/40 bg-error/10 p-12 text-caption text-error"
          >
            {error}
          </p>
        )}

        <StepNav>
          <Button type="button" variant="text" onClick={onBack}>
            <ArrowLeft className="h-12 w-12" aria-hidden="true" />
            Back
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={submitDisabled}
          >
            Connect & test
          </Button>
        </StepNav>
      </form>
    </Panel>
  )
}

// ─── Building blocks ───────────────────────────────────────────────────────

function Panel({
  title,
  caption,
  children,
}: {
  title: string
  caption: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-16 rounded-lg border border-border bg-surface p-20 md:p-24">
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-title font-medium tracking-tight text-on-surface md:text-headline">
          {title}
        </h2>
        <p className="text-caption text-on-surface-muted">{caption}</p>
      </div>
      {children}
    </section>
  )
}

function StepNav({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-12 border-t border-border pt-16">
      {children}
    </div>
  )
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-12 rounded-md border border-warning/40 bg-warning/5 p-12">
      <ShieldCheck
        className="h-16 w-16 shrink-0 text-warning"
        aria-hidden="true"
      />
      <p className="text-caption text-on-surface">{children}</p>
    </div>
  )
}

function PrivacyFooter() {
  return (
    <p className="flex items-center gap-8 text-caption text-on-surface-muted">
      <Lock className="h-12 w-12" aria-hidden="true" />
      The script runs in your Google account. Herrington never sees your
      password or OAuth tokens.
    </p>
  )
}

// ─── Visual mocks ──────────────────────────────────────────────────────────

/**
 * Faux browser chrome — gives steps an "in Google" feel without
 * requiring screenshots that go stale every time Google ships a UI
 * tweak. The traffic-light dots and URL bar are pure CSS.
 */
function BrowserMock({
  url,
  children,
}: {
  url: string
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface-variant shadow-e1">
      <div className="flex items-center gap-8 border-b border-border bg-surface-container px-12 py-8">
        <span className="flex gap-4">
          <span className="h-12 w-12 rounded-full bg-[#fc625d]" />
          <span className="h-12 w-12 rounded-full bg-[#fdbc40]" />
          <span className="h-12 w-12 rounded-full bg-[#34c749]" />
        </span>
        <span className="ml-12 flex-1 truncate rounded-md bg-surface px-12 py-4 text-caption text-on-surface-muted">
          {url}
        </span>
      </div>
      <div className="bg-surface">{children}</div>
    </div>
  )
}

/**
 * Step 2 visual — code editor mock with a single Copy button. We
 * don't actually display the code (it's huge); the copy interaction
 * is what matters.
 */
function CodeMock({
  onCopy,
  copied,
}: {
  onCopy: () => void
  copied: boolean
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface-variant">
      <div className="flex items-center justify-between border-b border-border bg-surface-container px-12 py-8">
        <span className="flex items-center gap-8">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-sm bg-primary-container text-caption font-mono text-on-primary-container">
            {'<>'}
          </span>
          <span className="text-caption font-mono text-on-surface-muted">
            Code.gs
          </span>
        </span>
        <Button variant="primary" size="sm" onClick={onCopy}>
          {copied ? (
            <>
              <Check className="h-12 w-12" aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-12 w-12" aria-hidden="true" />
              Copy code
            </>
          )}
        </Button>
      </div>
      <div className="px-16 py-20 font-mono text-caption text-on-surface-muted">
        <span className="text-primary">function</span>{' '}
        <span className="text-on-surface">doPost</span>(e) {'{'}
        <br />
        <span className="ml-16 italic">
          // ~200 lines, handles email · calendar · docs
        </span>
        <br />
        {'}'}
      </div>
    </div>
  )
}

/**
 * Step 3 visual — Apps Script's Project Settings dialog. We mock the
 * "Script Properties" form row showing what they're about to enter.
 */
function SettingsMock({ secret }: { secret: string }) {
  const truncated = secret.slice(0, 18) + '…'
  return (
    <BrowserMock url="script.google.com — Project Settings">
      <div className="flex flex-col gap-12 p-20">
        <p className="text-caption uppercase tracking-wider text-on-surface-muted">
          Script Properties
        </p>
        <div className="grid grid-cols-[1fr_2fr] gap-8 rounded-md border border-border bg-surface-variant p-12">
          <div className="flex flex-col gap-4">
            <span className="text-caption text-on-surface-muted">Property</span>
            <code className="text-caption font-mono text-on-surface">
              SECRET
            </code>
          </div>
          <div className="flex flex-col gap-4">
            <span className="text-caption text-on-surface-muted">Value</span>
            <code className="truncate text-caption font-mono text-on-surface">
              {truncated}
            </code>
          </div>
        </div>
        <button
          type="button"
          disabled
          className="self-start rounded-pill bg-[#1a73e8] px-16 py-4 text-caption font-medium text-white"
        >
          Save script properties
        </button>
      </div>
    </BrowserMock>
  )
}

/**
 * Step 4 visual — the Deploy dialog. Three settings, each shown with
 * a green checkmark so the user knows what to match.
 */
function DeployMock() {
  return (
    <BrowserMock url="Apps Script — New deployment">
      <div className="flex flex-col gap-12 p-20">
        <p className="text-caption uppercase tracking-wider text-on-surface-muted">
          Deployment configuration
        </p>
        <DeployRow label="Type" value="Web app" />
        <DeployRow label="Execute as" value="Me" />
        <DeployRow label="Who has access" value="Anyone" />
        <button
          type="button"
          disabled
          className="self-end rounded-pill bg-[#1a73e8] px-16 py-4 text-caption font-medium text-white"
        >
          Deploy
        </button>
      </div>
    </BrowserMock>
  )
}

function DeployRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-12 rounded-md border border-success/30 bg-success/5 px-12 py-8">
      <span className="text-caption text-on-surface-muted">{label}</span>
      <span className="flex items-center gap-4 text-caption font-medium text-on-surface">
        <Check className="h-12 w-12 text-success" aria-hidden="true" />
        {value}
      </span>
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Generate a 64-character hex string for use as the shared script
 * secret. Uses Web Crypto so the entropy is real, not Math.random.
 */
function generateSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── The Code.gs payload — embedded at build time so the user can copy
//     it without leaving the app. Keep this in sync with
//     `scripts/google-apps-script/Code.gs`. ─────────────────────────────

const CODE_GS_CONTENTS = `/**
 * Herrington — Google Workspace bridge
 *
 * Paste this into a new Apps Script project at script.google.com,
 * set a SECRET in Project Settings → Script properties, deploy as
 * Web app (Anyone access), and paste the URL + secret into Herrington.
 */

var MAX_EMAIL_FETCH = 10
var DEFAULT_EVENT_DURATION_SEC = 60 * 60

function doPost(e) {
  try {
    var providedSecret =
      (e && e.parameter && e.parameter.secret) ||
      _readHeader(e, 'X-Secret') ||
      _readHeader(e, 'x-secret')
    var expectedSecret =
      PropertiesService.getScriptProperties().getProperty('SECRET')

    if (!expectedSecret) {
      return _json({ ok: false, error: 'SECRET script property is not set.' })
    }
    if (providedSecret !== expectedSecret) {
      return _json({ ok: false, error: 'unauthorized' })
    }

    var raw = e && e.postData && e.postData.contents
    if (!raw) return _json({ ok: false, error: 'missing body' })

    var payload
    try { payload = JSON.parse(raw) }
    catch (err) { return _json({ ok: false, error: 'body is not valid JSON' }) }

    switch (payload.kind) {
      case 'list_unread_emails':           return _json(_listUnreadEmails(payload))
      case 'search_emails':                return _json(_searchEmails(payload))
      case 'check_calendar_availability':  return _json(_checkCalendarAvailability(payload))
      case 'create_calendar_event':        return _json(_createCalendarEvent(payload))
      case 'create_doc':                   return _json(_createDoc(payload))
      default:
        return _json({ ok: false, error: 'unknown action: ' + (payload.kind || '(none)') })
    }
  } catch (err) {
    return _json({ ok: false, error: 'unhandled: ' + (err && err.message ? err.message : String(err)) })
  }
}

function _listUnreadEmails(payload) {
  var max = Math.min(payload.max || 5, MAX_EMAIL_FETCH)
  var threads = GmailApp.search('in:inbox is:unread', 0, max)
  return { ok: true, data: { messages: _mapThreads(threads) } }
}

function _searchEmails(payload) {
  if (typeof payload.query !== 'string' || payload.query.trim().length === 0) {
    return { ok: false, error: 'query is required' }
  }
  var max = Math.min(
    typeof payload.max === 'number' && isFinite(payload.max)
      ? Math.max(1, Math.floor(payload.max))
      : 10,
    MAX_EMAIL_FETCH,
  )
  var threads = GmailApp.search(payload.query, 0, max)
  return {
    ok: true,
    data: { query: payload.query, messages: _mapThreads(threads, true) },
  }
}

function _mapThreads(threads, includeUnreadFlag) {
  var out = []
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages()
    if (msgs.length === 0) continue
    var msg = msgs[msgs.length - 1]
    var row = {
      id: msg.getId(),
      from: msg.getFrom(),
      subject: msg.getSubject(),
      receivedAtSec: Math.floor(msg.getDate().getTime() / 1000),
      snippet: (msg.getPlainBody() || '').slice(0, 280),
    }
    if (includeUnreadFlag) row.isUnread = msg.isUnread()
    out.push(row)
  }
  return out
}

function _checkCalendarAvailability(payload) {
  if (typeof payload.startSec !== 'number' || typeof payload.endSec !== 'number') {
    return { ok: false, error: 'startSec and endSec are required' }
  }
  if (payload.endSec <= payload.startSec) {
    return { ok: false, error: 'endSec must be greater than startSec' }
  }
  var calendar = CalendarApp.getDefaultCalendar()
  var events = calendar.getEvents(new Date(payload.startSec * 1000), new Date(payload.endSec * 1000))
  var formatted = events.map(function (ev) {
    return {
      id: ev.getId(),
      title: ev.getTitle(),
      startSec: Math.floor(ev.getStartTime().getTime() / 1000),
      endSec: Math.floor(ev.getEndTime().getTime() / 1000),
    }
  })
  return { ok: true, data: { events: formatted, isFree: formatted.length === 0 } }
}

function _createCalendarEvent(payload) {
  if (!payload.title || typeof payload.title !== 'string') return { ok: false, error: 'title is required' }
  if (typeof payload.startSec !== 'number') return { ok: false, error: 'startSec is required' }
  var endSec = typeof payload.endSec === 'number' ? payload.endSec : payload.startSec + DEFAULT_EVENT_DURATION_SEC
  if (endSec <= payload.startSec) return { ok: false, error: 'endSec must be greater than startSec' }
  var ev = CalendarApp.getDefaultCalendar().createEvent(
    payload.title,
    new Date(payload.startSec * 1000),
    new Date(endSec * 1000),
    payload.description ? { description: payload.description } : undefined,
  )
  return {
    ok: true,
    data: {
      id: ev.getId(),
      title: ev.getTitle(),
      startSec: Math.floor(ev.getStartTime().getTime() / 1000),
      endSec: Math.floor(ev.getEndTime().getTime() / 1000),
      htmlLink: 'https://calendar.google.com/calendar/u/0/r/eventedit/' + ev.getId().split('@')[0],
    },
  }
}

function _createDoc(payload) {
  if (!payload.title || typeof payload.title !== 'string') return { ok: false, error: 'title is required' }
  if (typeof payload.body !== 'string') return { ok: false, error: 'body is required' }
  var doc = DocumentApp.create(payload.title)
  _renderMarkdownToBody(doc.getBody(), payload.body)
  doc.saveAndClose()
  if (payload.folderId) {
    try {
      var file = DriveApp.getFileById(doc.getId())
      var folder = DriveApp.getFolderById(payload.folderId)
      folder.addFile(file)
      DriveApp.getRootFolder().removeFile(file)
    } catch (err) {
      return { ok: true, data: { id: doc.getId(), url: doc.getUrl(), warning: 'Doc created but could not be moved.' } }
    }
  }
  return { ok: true, data: { id: doc.getId(), url: doc.getUrl() } }
}

function _renderMarkdownToBody(body, markdown) {
  body.clear()
  var lines = String(markdown).split(/\\r?\\n/)
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (!line || !line.trim()) { body.appendParagraph(''); continue }
    var trimmed = line.trim()
    var headingMatch = /^(#{1,3})\\s+(.+)$/.exec(trimmed)
    if (headingMatch) {
      var heading = body.appendParagraph(headingMatch[2])
      heading.setHeading(
        headingMatch[1].length === 1 ? DocumentApp.ParagraphHeading.HEADING1 :
        headingMatch[1].length === 2 ? DocumentApp.ParagraphHeading.HEADING2 :
                                       DocumentApp.ParagraphHeading.HEADING3,
      )
      _applyInlineFormatting(heading.editAsText(), heading.getText())
      continue
    }
    var numberedMatch = /^\\d+\\.\\s+(.+)$/.exec(trimmed)
    if (numberedMatch) {
      var numItem = body.appendListItem(numberedMatch[1])
      numItem.setGlyphType(DocumentApp.GlyphType.NUMBER)
      _applyInlineFormatting(numItem.editAsText(), numItem.getText())
      continue
    }
    var bulletMatch = /^[-*]\\s+(.+)$/.exec(trimmed)
    if (bulletMatch) {
      var bulletItem = body.appendListItem(bulletMatch[1])
      bulletItem.setGlyphType(DocumentApp.GlyphType.BULLET)
      _applyInlineFormatting(bulletItem.editAsText(), bulletItem.getText())
      continue
    }
    var para = body.appendParagraph(trimmed)
    _applyInlineFormatting(para.editAsText(), para.getText())
  }
}

function _applyInlineFormatting(textElement, raw) {
  var patterns = [
    { regex: /\\*\\*([^*]+)\\*\\*/g, apply: 'bold' },
    { regex: /__([^_]+)__/g, apply: 'bold' },
    { regex: /(?:^|[^*])\\*([^*\\s][^*]*[^*\\s]|[^*\\s])\\*/g, apply: 'italic' },
    { regex: /(?:^|[^_])_([^_\\s][^_]*[^_\\s]|[^_\\s])_/g, apply: 'italic' },
    { regex: /\`([^\`]+)\`/g, apply: 'mono' },
  ]
  for (var p = 0; p < patterns.length; p++) {
    var pattern = patterns[p]
    var current = textElement.getText()
    var match
    while ((match = pattern.regex.exec(current)) !== null) {
      var fullMatch = match[0]
      var inner = match[1]
      var leadingChar =
        pattern.apply === 'italic' && fullMatch.charAt(0) !== '*' && fullMatch.charAt(0) !== '_'
          ? fullMatch.charAt(0)
          : ''
      var startInMatch = leadingChar ? 1 : 0
      var matchStart = match.index + startInMatch
      var matchEnd = matchStart + fullMatch.length - leadingChar.length
      textElement.deleteText(matchStart, matchEnd - 1)
      textElement.insertText(matchStart, inner)
      var rangeStart = matchStart
      var rangeEnd = matchStart + inner.length - 1
      if (rangeEnd >= rangeStart) {
        if (pattern.apply === 'bold') textElement.setBold(rangeStart, rangeEnd, true)
        else if (pattern.apply === 'italic') textElement.setItalic(rangeStart, rangeEnd, true)
        else if (pattern.apply === 'mono') textElement.setFontFamily(rangeStart, rangeEnd, 'Roboto Mono')
      }
      current = textElement.getText()
      pattern.regex.lastIndex = rangeEnd + 1
      if (matchStart === matchEnd) break
    }
  }
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function _readHeader(e, name) {
  if (!e || !e.headers || typeof e.headers !== 'object') return null
  return e.headers[name] || e.headers[name.toLowerCase()] || null
}
`
