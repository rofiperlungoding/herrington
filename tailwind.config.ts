import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'
import { tokens } from './src/styles/tokens'

/**
 * Tailwind CSS configuration.
 *
 * Per Requirement 12.1, the Client uses a SINGLE responsive breakpoint at
 * 768px to switch between the mobile Bottom_Nav and the desktop Sidebar.
 * We override Tailwind's default `screens` so that `md` is the only
 * breakpoint available and no others (sm, lg, xl, 2xl) leak into the design.
 *
 * The `theme.extend` block wires the Design_System tokens from
 * `src/styles/tokens.ts` into Tailwind utilities. Existing shadcn/ui CSS-
 * variable aliases (background, foreground, primary, destructive, etc.) are
 * preserved during migration so already-generated shadcn components keep
 * working until they are individually refactored to role tokens.
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './public/index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    screens: {
      md: '768px',
    },
    extend: {
      colors: {
        // ── Design_System role tokens (from tokens.ts) ──────────────
        ...tokens.color,

        // ── shadcn/ui compatibility aliases (kept during migration) ─
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },

      spacing: tokens.spacing,

      // Content width cap for the desktop shell. 1040px keeps line length in
      // the readable band (~80 characters at the body step) on a 1280px
      // viewport while leaving room for the sidebar rail. Exposed as a named
      // Tailwind token so components can reference `md:max-w-readable`
      // without emitting an arbitrary pixel literal that the build-time
      // literal scanner (scripts/check-tokens.mjs) would reject.
      // Requirements: 4.7, 12.2, 12.3.
      maxWidth: {
        readable: '1040px',
      },

      borderRadius: tokens.radius,

      boxShadow: {
        e0: tokens.elevation[0],
        e1: tokens.elevation[1],
        e2: tokens.elevation[2],
        e3: tokens.elevation[3],
        e4: tokens.elevation[4],
      },

      transitionDuration: {
        fast: 'var(--duration-fast)',
        standard: 'var(--duration-standard)',
        emphasized: 'var(--duration-emphasized)',
      },

      transitionTimingFunction: {
        standard: 'var(--easing-standard)',
        emphasized: 'var(--easing-emphasized)',
      },

      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
      },

      fontSize: {
        caption: [tokens.typography.caption.size, { lineHeight: tokens.typography.caption.lineHeight }],
        label: [tokens.typography.label.size, { lineHeight: tokens.typography.label.lineHeight }],
        body: [tokens.typography.body.size, { lineHeight: tokens.typography.body.lineHeight }],
        title: [tokens.typography.title.size, { lineHeight: tokens.typography.title.lineHeight }],
        headline: [tokens.typography.headline.size, { lineHeight: tokens.typography.headline.lineHeight }],
        display: [tokens.typography.display.size, { lineHeight: tokens.typography.display.lineHeight }],
      },

      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        // Dialog motion (Requirement 6.3). Overlay uses fade-in/out; the
        // content surface composes fade with a subtle 0.95 → 1.0 zoom for
        // an emphasized entrance. Durations and easing resolve to the
        // Motion_Scale tokens via CSS variables so `prefers-reduced-motion`
        // and future theme changes flow through automatically.
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        'zoom-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'zoom-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.95)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in var(--duration-standard) var(--easing-emphasized)',
        'fade-out': 'fade-out var(--duration-standard) var(--easing-emphasized)',
        'zoom-in': 'zoom-in var(--duration-standard) var(--easing-emphasized)',
        'zoom-out': 'zoom-out var(--duration-standard) var(--easing-emphasized)',
      },
    },
  },
  plugins: [animate],
}

export default config
