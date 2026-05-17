# Herrington — Brand System of Record

> *In good order.*

This document defines the brand identity that all of Herrington's surfaces — product, marketing, communications — must read against. It exists so any future copy or visual decision can be checked against a written rule rather than re-litigated.

---

## 1. Position

Herrington is a personal life-management workspace, framed as a quiet, capable presence rather than a productivity tool. The user does not feel "managed" by the app — they feel *kept*, the way a good household, library, or office is kept.

The audience is the **quiet achiever** — designers, programmers, operators, and writers in their late twenties to early forties whose days are already chaotic enough at work. They want a tool that doesn't ask for energy; it gives some back.

We are not in the productivity-app conversation. We are closer to *Things 3 + a butler*.

---

## 2. Brand essence

> *Herrington keeps the small things quietly handled.*

Use this kalimat as a tuning fork before any major decision. If a feature, copy line, or visual choice doesn't pass this test, it is wrong for the brand.

---

## 3. Tagline

| | Use |
|---|---|
| **In good order.** | Primary — hero, OG image, login |
| **Always at hand.** | Secondary — footer, About, smaller surfaces |

Both are written as full sentences with the period. The period is part of the tagline.

---

## 4. Type system

| Role | Family | Weights | Where |
|---|---|---|---|
| Display | **Fraunces** (variable, optical-size axis 9–144) | 400, 500, 600 | Wordmark, hero headlines, brand-only headings |
| UI body | **Inter** (variable, self-hosted) | 400, 500, 600 | Everything else |
| Mono | **JetBrains Mono** | 400 | Time displays, code, kbd |

Fraunces uses lowercase + slight letter-spacing for the wordmark. Inside the product UI, headings remain in Inter — Fraunces is for *brand* surfaces (login, marketing, OG image, footer brand block, the AppShell wordmark).

---

## 5. Palette — "Conservatory"

| Token | Hex | Role |
|---|---|---|
| `brand-ink` | `#1A1F1B` | Primary brand text on light, deep ground for dark surfaces |
| `brand-conservatory` | `#2A3A2E` | Brand-surface ground (favicon, app icon, login monogram block) |
| `brand-ivory` | `#F5F0E6` | Light brand-surface ground (printed materials, OG image) |
| `brand-linen` | `#E8E2D4` | Secondary surface, dividers on ivory |
| `brand-brass` | `#B8924A` | Bridge accent — appears in product UI on brand-lined moments |
| `brand-oxblood` | `#6E2A2A` | Reserved alarm/alert tone for brand surfaces only |

The product UI continues to read from the existing role tokens (`surface`, `on-surface`, `primary`, etc) for stability. Brand colors are scoped — they show up on:

- Login & sign-up pages
- AppShell sidebar wordmark
- Favicon, apple-touch-icon, app-store icon
- OG image and any future marketing surfaces
- Optional bridge: brass for editorial flourishes (chapter headings, brand-lined CTAs)

Tailwind exposes them as `bg-brand-conservatory`, `text-brand-brass`, `border-brand-linen`, and so on.

---

## 6. Logo & mark

### Wordmark

`herrington` set in Fraunces, lowercase, medium weight, slightly tracked tight. Use the `<Wordmark />` component (`src/components/brand/Wordmark.tsx`) — never typeset by hand in routes.

### Monogram (H1 — "Plate")

A geometric H with squared slab serifs. Use `<Monogram />` (`src/components/brand/Monogram.tsx`). Stroke weight even, cross-bar at 52% optical center. Designed to hold from 16px (favicon) up to 1024px (app store icon) without losing detail.

Canonical app-icon configuration:
- Conservatory ground (`brand-conservatory`)
- Brass H (`brand-brass`)
- 12% rounded square corner

### Don't

- Don't add a frame, halo, or container around the wordmark
- Don't pair the monogram with arrows, sparkles, or dynamic flourishes
- Don't put the wordmark on photography
- Don't allow the wordmark to ride at less than 16px height

---

## 7. Voice & lexicon

### Words Herrington uses

- **morning · afternoon · evening** — preferred over "AM/PM" in copy
- **your day · your week · your hours**
- **looked after · in good order · at hand · kept · tended to**
- **a quiet day · a busy day** — simple adjectives, never superlatives

### Words Herrington does not use

- productivity, hustle, grind, level up, 10x, supercharge
- Hey!, Yay!, Awesome!, Let's do this!
- crush, smash, dominate, win
- Emoji in empty states or system messages

### Tone for key moments

| Moment | Herrington says | Not |
|---|---|---|
| Empty state | *"Quiet morning. Add your first task when you're ready."* | *"No tasks yet! Add one to get started 🚀"* |
| Loading | *"A moment."* / *"One second."* | *"Loading..."* |
| Error | *"Something didn't go through. Mind trying again?"* | *"Oops! Something went wrong"* |
| Success | *"Done."* / *"Added."* | *"Great job!"* |
| AI greeting | *"Morning, Rofi. Three things on your plate today."* | *"Hi Rofi! Here's what's coming up today!"* |

### Length

Default to short. One to three sentences. The voice is dry and warm, not chatty.

---

## 8. Implementation references

| Concern | Lives at |
|---|---|
| Color tokens | `src/styles/tokens.css` (`--color-brand-*`) + `src/styles/tokens.ts` (parity mirror) |
| Display font | `src/styles/tokens.css` (`@import` Fraunces, `--font-display`) |
| Wordmark | `src/components/brand/Wordmark.tsx` |
| Monogram | `src/components/brand/Monogram.tsx` |
| Favicon | `public/favicon.svg` |
| Apple touch icon | `public/apple-touch-icon.svg` |
| Page metadata | `index.html` (title, theme-color, OG tags) |
| Voice (AI) | `netlify/edge-functions/_lib/skills/persona.ts` |
| Voice (UI copy) | This document — apply by hand on each surface |
