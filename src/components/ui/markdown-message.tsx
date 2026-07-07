import * as React from 'react'

/**
 * Shared markdown renderer used by chat replies and notebook answers.
 *
 * Bundle hygiene: the heavy bits (`react-markdown`, `remark-math`,
 * `rehype-katex`) are pulled in via a single lazy import so the
 * initial JS payload stays small. KaTeX CSS is imported globally in
 * `src/main.tsx` so the math fonts/spacing work the moment a
 * formula renders.
 *
 * Math conventions:
 *   - Inline math:   `$ V_{out} = S \times T $`
 *   - Block math:    `$$ V_{out} = S \times T $$`
 *
 * Citation handling:
 *   When `citations` is provided, any `[N]` token in the rendered
 *   prose is replaced with a `<CitationPill>` that shows a hover
 *   tooltip with the source filename + snippet. Hovering a pill also
 *   bubbles the matching `sourceId` up via `onCitationHover`, so the
 *   parent layout can highlight the corresponding row in a sources
 *   panel. This keeps citations as proper interactive citations
 *   rather than raw text noise inside the answer.
 */

export interface MarkdownCitation {
  sourceId: string
  sourceFilename: string
  sourceKind?: 'file' | 'web'
  sourceUrl?: string | null
  chunkIndex?: number
  snippet?: string
}

interface CitationContextValue {
  byIndex: Map<number, MarkdownCitation>
  onHover?: (sourceId: string | null) => void
}

const CitationContext = React.createContext<CitationContextValue | null>(null)

interface LazyDeps {
  Markdown: typeof import('react-markdown').default
  remarkGfm: typeof import('remark-gfm').default
  remarkMath: typeof import('remark-math').default
  rehypeKatex: typeof import('rehype-katex').default
}

const lazyLoad = (): Promise<LazyDeps> =>
  Promise.all([
    import('react-markdown'),
    import('remark-gfm'),
    import('remark-math'),
    import('rehype-katex'),
  ]).then(([m, gfm, math, katex]) => ({
    Markdown: m.default,
    remarkGfm: gfm.default,
    remarkMath: math.default,
    rehypeKatex: katex.default,
  }))

let cached: Promise<LazyDeps> | null = null
function getDeps(): Promise<LazyDeps> {
  if (!cached) cached = lazyLoad()
  return cached
}

/**
 * Walk children of a markdown text leaf and replace any `[N]` token
 * (where N matches a known citation index) with an interactive pill.
 * Other strings pass through untouched. Non-string children (already
 * other React nodes — e.g. nested formatting) pass through too.
 */
function renderWithCitationPills(
  children: React.ReactNode,
  byIndex: Map<number, MarkdownCitation>,
): React.ReactNode {
  if (byIndex.size === 0) return children

  const result: React.ReactNode[] = []
  React.Children.forEach(children, (child, idx) => {
    if (typeof child !== 'string') {
      result.push(child)
      return
    }
    // Find all `[N]` segments. We allow optional space between adjacent
    // citations like "[1][2]" or "[1] [2]" by treating each match
    // independently.
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    const regex = /\[(\d+)\]/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(child)) !== null) {
      const num = Number.parseInt(match[1], 10)
      if (!byIndex.has(num)) continue
      if (match.index > lastIndex) {
        parts.push(child.slice(lastIndex, match.index))
      }
      parts.push(
        <CitationPill
          key={`cite-${idx}-${match.index}`}
          index={num}
          citation={byIndex.get(num)!}
        />,
      )
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < child.length) {
      parts.push(child.slice(lastIndex))
    }
    if (parts.length === 0) {
      result.push(child)
    } else {
      result.push(...parts)
    }
  })
  return result
}

/**
 * Inline citation pill. Renders like `[1]` with a chip outline and
 * shows a tooltip on hover with the source name + snippet. Hovering
 * also highlights the matching row in the parent's sources panel
 * (via the CitationContext.onHover callback). The pill itself is
 * non-interactive on click — to actually open a source the user goes
 * to the highlighted row in the panel. This keeps the answer body
 * read-only and pushes "open source" to one consistent place.
 */
function CitationPill({
  index,
  citation,
}: {
  index: number
  citation: MarkdownCitation
}) {
  const ctx = React.useContext(CitationContext)

  function handleEnter() {
    ctx?.onHover?.(citation.sourceId)
  }
  function handleLeave() {
    ctx?.onHover?.(null)
  }

  return (
    <span className="relative inline-block align-baseline">
      <span
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
        tabIndex={0}
        aria-label={`Source ${index}: ${citation.sourceFilename}`}
        className="group/cite ml-2 inline-flex h-16 min-w-16 cursor-default items-center justify-center rounded-sm bg-surface px-4 align-baseline text-caption font-medium text-on-surface-muted ring-1 ring-border transition-colors duration-fast ease-standard hover:bg-primary-container hover:text-on-primary-container hover:ring-primary"
      >
        <span className="leading-none">{index}</span>

        {/* Tooltip — pure CSS, appears on hover/focus of the pill */}
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-[calc(100%_+_4px)] left-1/2 z-20 w-[280px] -translate-x-1/2 translate-y-2 rounded-md bg-surface-container p-12 text-left opacity-0 shadow-e2 transition-[opacity,transform] duration-fast ease-standard group-hover/cite:translate-y-0 group-hover/cite:opacity-100 group-focus/cite:translate-y-0 group-focus/cite:opacity-100"
        >
          <span className="mb-4 flex items-baseline justify-between gap-8">
            <span className="truncate text-caption font-semibold text-on-surface">
              {citation.sourceFilename}
            </span>
            <span className="shrink-0 text-caption text-on-surface-muted">
              {citation.sourceKind === 'web'
                ? hostnameOf(citation.sourceUrl ?? '')
                : `chunk #${citation.chunkIndex ?? 0}`}
            </span>
          </span>
          {citation.snippet && (
            <span className="line-clamp-4 text-caption text-on-surface-muted">
              {citation.snippet}
            </span>
          )}
        </span>
      </span>
    </span>
  )
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const MarkdownInner = React.lazy(async () => {
  const { Markdown, remarkGfm, remarkMath, rehypeKatex } = await getDeps()
  function Wrapped({ children }: { children: string }) {
    const ctx = React.useContext(CitationContext)
    const byIndex = ctx?.byIndex ?? new Map()
    const enrich = (kids: React.ReactNode) =>
      renderWithCitationPills(kids, byIndex)

    return (
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) => (
            <p className="mb-8 last:mb-0 text-body text-on-surface">
              {enrich(children)}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="mb-8 ml-20 list-disc text-body text-on-surface last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-8 ml-20 list-decimal text-body text-on-surface last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="mb-4">{enrich(children)}</li>,
          h1: ({ children }) => (
            <h3 className="mb-4 mt-12 text-title font-semibold text-on-surface first:mt-0">
              {enrich(children)}
            </h3>
          ),
          h2: ({ children }) => (
            <h4 className="mb-4 mt-12 text-label font-semibold text-on-surface first:mt-0">
              {enrich(children)}
            </h4>
          ),
          h3: ({ children }) => (
            <h4 className="mb-4 mt-12 text-label font-semibold text-on-surface first:mt-0">
              {enrich(children)}
            </h4>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{enrich(children)}</strong>
          ),
          em: ({ children }) => <em className="italic">{enrich(children)}</em>,
          code: (props) => {
            const { className, children } = props as {
              className?: string
              children?: React.ReactNode
            }
            const isBlock = typeof className === 'string' && /language-/.test(className)
            if (isBlock) {
              return <code className={className}>{children}</code>
            }
            return (
              <code className="rounded bg-surface px-4 text-caption font-mono">
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="mb-8 overflow-x-auto rounded bg-surface p-8 text-caption font-mono last:mb-0">
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="mb-8 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-caption text-on-surface">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-8 py-4 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-8 py-4">{enrich(children)}</td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-8 border-l-2 border-border pl-12 text-on-surface-muted last:mb-0">
              {children}
            </blockquote>
          ),
        }}
      >
        {children}
      </Markdown>
    )
  }
  return { default: Wrapped }
})

/**
 * Render markdown with GitHub-flavoured syntax + math support.
 *
 * `citations` (optional, 1-indexed) maps the `[N]` tokens that appear
 * in the prose to their source rows. When provided, those tokens
 * become hover-able pills; otherwise they render as plain text.
 *
 * `onCitationHover` fires with the matching `sourceId` (or null on
 * leave) so a parent layout can highlight the corresponding row in a
 * sources panel.
 */
export function MarkdownMessage({
  content,
  citations,
  onCitationHover,
}: {
  content: string
  citations?: MarkdownCitation[]
  onCitationHover?: (sourceId: string | null) => void
}) {
  const byIndex = React.useMemo(() => {
    const map = new Map<number, MarkdownCitation>()
    if (citations) {
      citations.forEach((c, i) => {
        map.set(i + 1, c)
      })
    }
    return map
  }, [citations])

  const ctxValue = React.useMemo<CitationContextValue>(
    () => ({ byIndex, onHover: onCitationHover }),
    [byIndex, onCitationHover],
  )

  return (
    <CitationContext.Provider value={ctxValue}>
      <div className="prose-chat">
        <React.Suspense
          fallback={
            <p className="whitespace-pre-wrap text-body text-on-surface">
              {content}
            </p>
          }
        >
          <MarkdownInner>{content}</MarkdownInner>
        </React.Suspense>
      </div>
    </CitationContext.Provider>
  )
}
