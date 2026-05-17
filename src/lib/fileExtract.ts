/**
 * Client-side file → plain-text extractor.
 *
 * The notebooks feature accepts user uploads in PDF / DOCX / XLSX /
 * CSV / TXT / MD formats. Edge functions can't easily run PDF or
 * DOCX parsers (no Node modules available in Deno edge), so we
 * extract on the browser side and only ship the resulting plain text
 * to the server. The text is *much* smaller than the original binary
 * (typical 1MB PDF → ~30KB text), saves bandwidth + DB space, and
 * makes embedding cheap.
 *
 * Lazy-loaded heavy parsers (`pdfjs-dist`, `mammoth`, `xlsx`) so the
 * main bundle stays tiny — only fetched when the user actually drops
 * a file of that type.
 */

const MAX_TEXT_CHARS = 600_000 // ~150KB of text — caps a runaway upload

export interface ExtractedFile {
  filename: string
  mimeType: string
  sizeBytes: number
  /** Plain UTF-8 text. Whitespace-collapsed, capped at MAX_TEXT_CHARS. */
  text: string
}

export class UnsupportedFileError extends Error {
  constructor(filename: string, ext: string) {
    super(`Unsupported file type "${ext}" (${filename}). Try PDF, DOCX, XLSX, CSV, TXT, or MD.`)
    this.name = 'UnsupportedFileError'
  }
}

export class EmptyFileError extends Error {
  constructor(filename: string) {
    super(`Couldn't extract any text from ${filename}.`)
    this.name = 'EmptyFileError'
  }
}

export async function extractFile(file: File): Promise<ExtractedFile> {
  const lower = file.name.toLowerCase()
  const ext = lower.split('.').pop() ?? ''

  let text = ''
  if (ext === 'pdf' || file.type === 'application/pdf') {
    text = await extractPdf(file)
  } else if (ext === 'docx') {
    text = await extractDocx(file)
  } else if (ext === 'xlsx' || ext === 'xls') {
    text = await extractXlsx(file)
  } else if (ext === 'csv') {
    text = await extractCsv(file)
  } else if (ext === 'txt' || ext === 'md' || ext === 'json' || file.type.startsWith('text/')) {
    text = await file.text()
  } else {
    throw new UnsupportedFileError(file.name, ext)
  }

  text = normalize(text)
  if (text.length === 0) throw new EmptyFileError(file.name)

  return {
    filename: file.name,
    mimeType: file.type || guessMime(ext),
    sizeBytes: file.size,
    text,
  }
}

// ─── per-format extractors ─────────────────────────────────────────────────

async function extractPdf(file: File): Promise<string> {
  // pdfjs-dist v5 ships an ESM build. We use the modern build and let
  // Vite handle the worker via `?url` import — pdfjs needs a real
  // worker URL to parse PDFs reliably (the legacy "no worker" path
  // throws "No GlobalWorkerOptions.workerSrc specified" in v5).
  const [pdfjs, workerUrl] = await Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ])

  ;(pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    (workerUrl as { default: string }).default

  const buffer = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise

  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item: unknown) => {
        if (item && typeof item === 'object' && 'str' in item) {
          return String((item as { str: unknown }).str ?? '')
        }
        return ''
      })
      .join(' ')
    pages.push(pageText)
    page.cleanup()

    // Bail early if we've already extracted enough.
    if (pages.join('\n\n').length > MAX_TEXT_CHARS) break
  }
  return pages.join('\n\n')
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser')
  const buffer = await file.arrayBuffer()
  const result = await (mammoth as { extractRawText: (opts: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> })
    .extractRawText({ arrayBuffer: buffer })
  return result.value
}

async function extractXlsx(file: File): Promise<string> {
  const xlsx = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const wb = xlsx.read(buffer, { type: 'array' })
  const blocks: string[] = []
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    if (!sheet) continue
    const csv = xlsx.utils.sheet_to_csv(sheet)
    blocks.push(`# Sheet: ${name}\n${csv}`)
  }
  return blocks.join('\n\n')
}

async function extractCsv(file: File): Promise<string> {
  // Papaparse handles weird quoting / encoding edge cases better than a
  // naive split. We rebuild the rows as a tab-separated transcript so
  // chunks remain semantically grouped.
  const Papa = (await import('papaparse')).default
  const text = await file.text()
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
  })
  return (result.data as string[][])
    .map((row) => row.join('\t'))
    .join('\n')
}

// ─── normalization ─────────────────────────────────────────────────────────

function normalize(raw: string): string {
  return (
    raw
      // Collapse runs of whitespace within a line.
      .replace(/[\t ]+/g, ' ')
      // Cap consecutive blank lines to two.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_TEXT_CHARS)
  )
}

function guessMime(ext: string): string {
  switch (ext) {
    case 'pdf':
      return 'application/pdf'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'csv':
      return 'text/csv'
    case 'md':
      return 'text/markdown'
    case 'txt':
      return 'text/plain'
    case 'json':
      return 'application/json'
    default:
      return 'application/octet-stream'
  }
}
