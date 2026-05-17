import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Icon accessible wrapper.
 *
 * Wraps a single child SVG (typically a `lucide-react` icon component
 * instance, but any element whose output is an `<svg>` works) and adds two
 * guarantees the Design_System depends on:
 *
 * 1. Accessibility gating (Requirement 11.5). An icon is either purely
 *    decorative or it carries semantic meaning that must be exposed to
 *    assistive technologies. The wrapper requires the caller to make that
 *    choice explicit, through one of three patterns:
 *
 *    - `decorative` → the wrapper injects `aria-hidden="true"` and
 *      `focusable={false}` onto the rendered child SVG so the icon is
 *      skipped by screen readers and not reachable by Tab.
 *    - `label` → the wrapper renders a `sr-only` span alongside the icon
 *      containing the label text and injects `aria-hidden="true"` on the
 *      SVG. Used inside icon-only interactive contexts (for example a
 *      close button with no visible text) so the button's accessible name
 *      is computed from its visually-hidden text content.
 *    - A `sr-only` text child supplied by the caller. The wrapper detects
 *      this pattern and treats it as an equivalent of `label`.
 *
 *    In development (`import.meta.env.DEV`) an icon rendered with none of
 *    these affordances emits a `console.warn` identifying the misuse. The
 *    warning is stripped from production bundles by Vite's static
 *    substitution of `import.meta.env.DEV`.
 *
 * 2. Layout stability (Requirement 14.4). The `size` prop (default `20`)
 *    is cloned onto the child SVG as `width` and `height` attributes.
 *    Setting these attributes explicitly reserves the icon's box during
 *    load even when CSS is not yet parsed or when the SVG is not rendered
 *    inline, which prevents Cumulative Layout Shift.
 *
 * The wrapper expresses all visual values through token-backed Tailwind
 * utilities — no hex colors, no `rgb(...)`, no pixel literals other than
 * `0`/`1`px, no millisecond literals, no `cubic-bezier(...)`. The `size`
 * prop is a bare number (not a CSS string) so it passes straight through
 * to the SVG's `width`/`height` attributes without violating the
 * literal-lint rule enforced by `scripts/check-tokens.mjs`.
 *
 * Requirements: 11.5, 14.4
 */

/**
 * Public prop contract for the `Icon` wrapper.
 */
export interface IconProps {
  /**
   * The icon to render. Typically a single `lucide-react` icon component
   * instance (e.g. `<Check />`), a raw `<svg>` element, or — when the
   * caller wants to supply their own accessible name — the icon plus a
   * `<span className="sr-only">` text child.
   */
  children: React.ReactNode
  /**
   * Set to `true` when the icon is purely decorative (its meaning is
   * already conveyed by adjacent text). The wrapper injects
   * `aria-hidden="true"` and `focusable={false}` onto the rendered SVG.
   *
   * Mutually exclusive with `label`. Defaults to `false`.
   */
  decorative?: boolean
  /**
   * Accessible label for icon-only interactive contexts. When supplied,
   * the wrapper renders a visually-hidden span containing the text so the
   * enclosing interactive element (button, link) computes this string as
   * its accessible name. The SVG itself is marked `aria-hidden="true"`
   * because the visually-hidden text is the accessibility surface.
   *
   * Required when `decorative` is `false` and the caller does not supply
   * their own `sr-only` text child. Violations emit a dev-only
   * `console.warn`.
   */
  label?: string
  /**
   * Pixel size for the icon, applied as both `width` and `height`
   * attributes on the rendered SVG. Defaults to `20` which aligns with the
   * Design_Tokens `label` step line-box height so an inline icon visually
   * aligns with surrounding text.
   */
  size?: number
  /** Optional class names forwarded to the wrapping span. */
  className?: string
}

/**
 * Return `true` when `node` is a React element carrying the `sr-only`
 * utility class (or an equivalent `.sr-only` compound), which indicates
 * the caller has provided their own visually-hidden accessible name.
 */
function hasVisuallyHiddenTextChild(children: React.ReactNode): boolean {
  let found = false
  React.Children.forEach(children, (child) => {
    if (found) return
    if (!React.isValidElement(child)) return
    const childProps = child.props as { className?: unknown }
    const className = childProps.className
    if (typeof className === 'string' && /\bsr-only\b/.test(className)) {
      found = true
    }
  })
  return found
}

/**
 * Clone the icon element(s) within `children`, injecting `width`,
 * `height`, and `aria-hidden`/`focusable` as appropriate. Non-element or
 * non-SVG-like children (plain strings, sr-only spans) pass through
 * untouched.
 */
function enhanceIconChildren(
  children: React.ReactNode,
  size: number,
  hideFromA11y: boolean,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child

    // sr-only text children are not SVGs and must pass through untouched
    // so their accessible name reaches assistive tech.
    const childProps = child.props as {
      className?: unknown
      width?: number | string
      height?: number | string
      'aria-hidden'?: boolean | 'true' | 'false'
      focusable?: boolean | 'true' | 'false'
    }
    if (
      typeof childProps.className === 'string' &&
      /\bsr-only\b/.test(childProps.className)
    ) {
      return child
    }

    // For SVGs and lucide-react icon components, inject the layout and
    // a11y attributes. Respect explicit caller-supplied values.
    const nextProps: Record<string, unknown> = {
      width: childProps.width ?? size,
      height: childProps.height ?? size,
    }
    if (hideFromA11y) {
      nextProps['aria-hidden'] = true
      nextProps.focusable = false
    }

    return React.cloneElement(
      child as React.ReactElement<Record<string, unknown>>,
      nextProps,
    )
  })
}

/**
 * Dev-only contract warning. Stripped from production bundles by Vite's
 * static substitution of `import.meta.env.DEV`.
 */
function warnOnContractViolation(
  decorative: boolean,
  label: string | undefined,
  hasSrOnlyChild: boolean,
): void {
  if (!import.meta.env.DEV) return

  if (decorative && label !== undefined) {
    // eslint-disable-next-line no-console
    console.warn(
      '[Icon] `decorative` and `label` are mutually exclusive. ' +
        'Decorative icons are hidden from assistive tech, so a label has ' +
        'no effect. Remove one of the two props.',
    )
    return
  }

  if (!decorative && label === undefined && !hasSrOnlyChild) {
    // eslint-disable-next-line no-console
    console.warn(
      '[Icon] Icon is neither decorative nor labeled. Pass ' +
        '`decorative` for purely decorative icons, or `label="..."` (or a ' +
        '`<span className="sr-only">` child) for icon-only interactive ' +
        'contexts to comply with Requirement 11.5.',
    )
  }
}

/**
 * Accessible icon wrapper. See file-level JSDoc for the full contract.
 */
export function Icon({
  children,
  decorative = false,
  label,
  size = 20,
  className,
}: IconProps): React.ReactElement {
  const hasSrOnlyChild = hasVisuallyHiddenTextChild(children)

  warnOnContractViolation(decorative, label, hasSrOnlyChild)

  // The SVG is hidden from assistive tech whenever an alternative text
  // surface exists (either the `label` prop or a caller-supplied sr-only
  // child) or when the icon is explicitly marked decorative.
  const hideSvgFromA11y = decorative || label !== undefined || hasSrOnlyChild

  const enhancedChildren = enhanceIconChildren(children, size, hideSvgFromA11y)

  // `inline-flex` keeps the icon inline with surrounding text, and
  // `items-center` centers the optional visually-hidden span alongside the
  // icon (the span has zero rendered box so this is purely defensive).
  return (
    <span className={cn('inline-flex items-center', className)}>
      {enhancedChildren}
      {label !== undefined ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}
