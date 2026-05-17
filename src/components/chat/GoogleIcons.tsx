/**
 * Google product icons.
 *
 * Inline SVG so we can size them via the `size` prop without paying
 * the bundle cost of an extra icon library, and render them at any
 * resolution with crisp edges. Colors are the official Google product
 * brand colors.
 *
 * Sources adapted from Google's public brand guidance. We use the
 * simplified flat shapes to keep payload tiny — high-fidelity logos
 * would carry too much SVG detail for an inline pattern.
 */

interface IconProps {
  size?: number
  className?: string
}

export function GmailIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="#4285f4"
        d="M6 12c0-2.2 1.8-4 4-4h2v32h-2c-2.2 0-4-1.8-4-4V12z"
      />
      <path
        fill="#34a853"
        d="M42 12v24c0 2.2-1.8 4-4 4h-2V8h2c2.2 0 4 1.8 4 4z"
      />
      <path
        fill="#fbbc04"
        d="M36 8v32h-2L24 24 14 40h-2V8h2v24l10-12 10 12V8h2z"
      />
      <path
        fill="#ea4335"
        d="M14 8h20l-10 12L14 8z"
      />
      <path
        fill="#c5221f"
        d="M24 20l-10-12h2v24L24 20z"
      />
    </svg>
  )
}

export function CalendarIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
    >
      <path fill="#fff" d="M10 10h28v28H10z" />
      <path fill="#1a73e8" d="M14 22h6v6h-6z" />
      <path
        fill="#ea4335"
        d="M38 38H10c-1.1 0-2-.9-2-2v-4h32v4c0 1.1-.9 2-2 2z"
      />
      <path fill="#4285f4" d="M40 8H8v6h32V8z" />
      <path fill="#34a853" d="M40 32H8v-8h32v8z" />
      <path fill="#fbbc04" d="M8 14h32v10H8z" />
      <path
        fill="#188038"
        d="M14 4h-2c-1.1 0-2 .9-2 2v6h6V6c0-1.1-.9-2-2-2z"
      />
      <path
        fill="#188038"
        d="M36 4h-2c-1.1 0-2 .9-2 2v6h6V6c0-1.1-.9-2-2-2z"
      />
      <text
        x="24"
        y="29"
        textAnchor="middle"
        fontFamily="'Google Sans', Arial, sans-serif"
        fontSize="12"
        fontWeight="500"
        fill="#1a73e8"
      >
        {/* day number left blank — the calendar icon reads as a generic
            calendar without a hard-coded date */}
      </text>
    </svg>
  )
}

export function DocsIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="#4285f4"
        d="M37 44H11c-1.7 0-3-1.3-3-3V7c0-1.7 1.3-3 3-3h18l11 11v26c0 1.7-1.3 3-3 3z"
      />
      <path fill="#a1c2fa" d="M40 15L29 4v8c0 1.7 1.3 3 3 3h8z" />
      <path
        fill="#fff"
        d="M14 21h20v2H14zm0 5h20v2H14zm0 5h20v2H14zm0 5h12v2H14z"
      />
    </svg>
  )
}

export function SearchIcon({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="#4285f4"
        d="M44 22.6V24c0 11-9 20-20 20S4 35 4 24 13 4 24 4c5.4 0 10.3 2.1 13.9 5.6l-3.5 3.5C31.6 10.3 27.9 9 24 9c-8.3 0-15 6.7-15 15s6.7 15 15 15c7.7 0 14.1-5.8 14.9-13.4H24v-3h20z"
      />
      <path fill="#34a853" d="M24 14v5h12.4c-.4-1.8-1.2-3.5-2.3-5H24z" />
      <path fill="#fbbc04" d="M9 24c0-2.5.6-4.9 1.7-7H4.5C3.5 19.2 3 21.5 3 24s.5 4.8 1.5 7h6.2c-1.1-2.1-1.7-4.5-1.7-7z" />
      <path
        fill="#ea4335"
        d="M24 9c3.9 0 7.6 1.3 10.4 3.6l3.5-3.5C34.3 5.6 29.4 3.5 24 3.5V9z"
      />
    </svg>
  )
}
