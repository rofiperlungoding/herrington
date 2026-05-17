/**
 * Life Management — Google Workspace Bridge
 *
 * Paste the contents of this file into a new project at
 * https://script.google.com → New project → Code.gs.
 *
 * Then deploy:
 *   1. Deploy → New deployment.
 *   2. Type: "Web app".
 *   3. Description: anything (e.g., "herrington workspace bridge").
 *   4. Execute as: "Me" (your own Google account).
 *   5. Who has access: "Anyone".  ← required for the edge function to
 *      reach the URL. Security is enforced via the shared secret in
 *      the X-Secret header below — the URL alone is not enough.
 *   6. Click Deploy and copy the Web app URL.
 *
 * Configure script properties (gear icon → "Script properties"):
 *   - SECRET — the same string you set as GOOGLE_GAS_SECRET in `.env`.
 *
 * Then in your `.env`:
 *   GOOGLE_GAS_WEBHOOK_URL=<paste the Web app URL>
 *   GOOGLE_GAS_SECRET=<the same string you set above>
 *
 * This script never stores user data and never makes outbound calls.
 * It only acts on the user's own Google account inside the
 * Workspace APIs the deployment is authorized for.
 */

// =====================================================================
//  Constants
// =====================================================================

/** Hard cap on rows returned by `list_unread_emails` so a runaway
 *  inbox doesn't blow past the Apps Script execution time limit. */
var MAX_EMAIL_FETCH = 10

/** Default duration for create_calendar_event when end is unspecified. */
var DEFAULT_EVENT_DURATION_SEC = 60 * 60

// =====================================================================
//  Webhook entry point
// =====================================================================

/**
 * Apps Script invokes `doPost(e)` for every POST hitting the deployed
 * Web App URL. We dispatch on the `kind` discriminator in the JSON body.
 *
 * Security:
 *   - X-Secret header must match the SECRET script property exactly.
 *     A missing or mismatched secret returns 401.
 *   - The script runs as the deploying user; Workspace API calls
 *     therefore use the user's native authorization scopes.
 */
function doPost(e) {
  try {
    var providedSecret =
      (e && e.parameter && e.parameter.secret) ||
      _readHeader(e, 'X-Secret') ||
      _readHeader(e, 'x-secret')
    var expectedSecret =
      PropertiesService.getScriptProperties().getProperty('SECRET')

    if (!expectedSecret) {
      return _json({
        ok: false,
        error:
          'SECRET script property is not set. Configure it in Project Settings.',
      })
    }
    if (providedSecret !== expectedSecret) {
      return _json({ ok: false, error: 'unauthorized' })
    }

    var raw = e && e.postData && e.postData.contents
    if (!raw) {
      return _json({ ok: false, error: 'missing body' })
    }

    var payload
    try {
      payload = JSON.parse(raw)
    } catch (err) {
      return _json({ ok: false, error: 'body is not valid JSON' })
    }

    switch (payload.kind) {
      case 'list_unread_emails':
        return _json(_listUnreadEmails(payload))
      case 'search_emails':
        return _json(_searchEmails(payload))
      case 'check_calendar_availability':
        return _json(_checkCalendarAvailability(payload))
      case 'create_calendar_event':
        return _json(_createCalendarEvent(payload))
      case 'create_doc':
        return _json(_createDoc(payload))
      default:
        return _json({
          ok: false,
          error: 'unknown action: ' + (payload.kind || '(none)'),
        })
    }
  } catch (err) {
    // Last-resort handler so the bridge always returns JSON.
    return _json({
      ok: false,
      error: 'unhandled: ' + (err && err.message ? err.message : String(err)),
    })
  }
}

// =====================================================================
//  Action: list_unread_emails
// =====================================================================
//
// Returns the most recent unread emails in the user's inbox.
// Subject + sender + first ~280 chars of body so the AI can summarise
// without having to chain follow-up calls.

function _listUnreadEmails(payload) {
  var max = Math.min(payload.max || 5, MAX_EMAIL_FETCH)
  var threads = GmailApp.search('in:inbox is:unread', 0, max)
  var out = []

  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages()
    if (msgs.length === 0) continue
    var msg = msgs[msgs.length - 1] // most recent in thread
    out.push({
      id: msg.getId(),
      from: msg.getFrom(),
      subject: msg.getSubject(),
      receivedAtSec: Math.floor(msg.getDate().getTime() / 1000),
      snippet: (msg.getPlainBody() || '').slice(0, 280),
    })
  }

  return { ok: true, data: { messages: out } }
}

// =====================================================================
//  Action: search_emails
// =====================================================================
//
// Run an arbitrary Gmail search query (full Gmail search syntax) and
// return matching messages — subject, sender, snippet, and a flag
// indicating whether the message is currently unread.
//
// The AI uses this when the user asks for something specific:
//   "find that Stripe invoice email"   → from:stripe subject:invoice
//   "did Netflix send me anything?"    → from:netflix
//   "show me everything from this week" → newer_than:7d
//
// Gmail's search syntax is preserved verbatim; we just guard the
// row count so we don't hit the Apps Script time limit on a wide
// query like "in:anywhere".

function _searchEmails(payload) {
  if (typeof payload.query !== 'string' || payload.query.trim().length === 0) {
    return { ok: false, error: 'query is required' }
  }

  // Cap to MAX_EMAIL_FETCH so a query like "in:anywhere" can't fetch
  // a hundred threads. The AI is told to refine the query when this
  // returns a full bucket of results.
  var max = Math.min(
    typeof payload.max === 'number' && isFinite(payload.max)
      ? Math.max(1, Math.floor(payload.max))
      : 10,
    MAX_EMAIL_FETCH,
  )

  var threads = GmailApp.search(payload.query, 0, max)
  var out = []

  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages()
    if (msgs.length === 0) continue
    var msg = msgs[msgs.length - 1] // most recent in thread
    out.push({
      id: msg.getId(),
      from: msg.getFrom(),
      subject: msg.getSubject(),
      receivedAtSec: Math.floor(msg.getDate().getTime() / 1000),
      snippet: (msg.getPlainBody() || '').slice(0, 280),
      isUnread: msg.isUnread(),
    })
  }

  return {
    ok: true,
    data: {
      query: payload.query,
      messages: out,
    },
  }
}

// =====================================================================
//  Action: check_calendar_availability
// =====================================================================
//
// Returns the events that overlap the supplied window. The AI
// interprets "free" as `events.length === 0` for the requested span.

function _checkCalendarAvailability(payload) {
  if (
    typeof payload.startSec !== 'number' ||
    typeof payload.endSec !== 'number'
  ) {
    return { ok: false, error: 'startSec and endSec are required' }
  }
  if (payload.endSec <= payload.startSec) {
    return { ok: false, error: 'endSec must be greater than startSec' }
  }

  var calendar = CalendarApp.getDefaultCalendar()
  var events = calendar.getEvents(
    new Date(payload.startSec * 1000),
    new Date(payload.endSec * 1000),
  )
  var formatted = events.map(function (ev) {
    return {
      id: ev.getId(),
      title: ev.getTitle(),
      startSec: Math.floor(ev.getStartTime().getTime() / 1000),
      endSec: Math.floor(ev.getEndTime().getTime() / 1000),
    }
  })
  return {
    ok: true,
    data: {
      events: formatted,
      isFree: formatted.length === 0,
    },
  }
}

// =====================================================================
//  Action: create_calendar_event
// =====================================================================

function _createCalendarEvent(payload) {
  if (!payload.title || typeof payload.title !== 'string') {
    return { ok: false, error: 'title is required' }
  }
  if (typeof payload.startSec !== 'number') {
    return { ok: false, error: 'startSec is required' }
  }
  var endSec =
    typeof payload.endSec === 'number'
      ? payload.endSec
      : payload.startSec + DEFAULT_EVENT_DURATION_SEC
  if (endSec <= payload.startSec) {
    return { ok: false, error: 'endSec must be greater than startSec' }
  }

  var calendar = CalendarApp.getDefaultCalendar()
  var ev = calendar.createEvent(
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
      htmlLink: 'https://calendar.google.com/calendar/u/0/r/eventedit/' +
        ev.getId().split('@')[0],
    },
  }
}

// =====================================================================
//  Action: create_doc
// =====================================================================
//
// Creates a Google Doc in the user's Drive. Optional folderId moves
// the doc out of the root. Body is treated as plain text — Markdown
// renders as plain text; an "import as Doc" pass would need the
// Drive Advanced Service which we deliberately keep off to avoid
// extra OAuth scopes.

function _createDoc(payload) {
  if (!payload.title || typeof payload.title !== 'string') {
    return { ok: false, error: 'title is required' }
  }
  if (typeof payload.body !== 'string') {
    return { ok: false, error: 'body is required (string)' }
  }

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
      return {
        ok: true,
        data: {
          id: doc.getId(),
          url: doc.getUrl(),
          warning:
            'Doc created but could not be moved into the requested folder: ' +
            (err && err.message ? err.message : String(err)),
        },
      }
    }
  }

  return {
    ok: true,
    data: {
      id: doc.getId(),
      url: doc.getUrl(),
    },
  }
}

/**
 * Render a lightweight Markdown subset into the Document Body so the
 * AI's `**bold**`, headings, and ordered/unordered lists actually
 * appear formatted (not as literal asterisks). Supported syntax:
 *
 *   #, ##, ###      → Heading 1 / 2 / 3
 *   -, *  (line)    → bullet list item
 *   1.            → numbered list item
 *   **text**        → bold inline
 *   *text* / _text_ → italic inline
 *   `code`          → monospace inline
 *
 * Anything else falls through as plain paragraph text. Blank lines
 * preserve paragraph breaks. Long bodies get truncated by the caller
 * before reaching here (200k char cap), so we don't need streaming.
 */
function _renderMarkdownToBody(body, markdown) {
  body.clear()

  var lines = String(markdown).split(/\r?\n/)
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (!line || !line.trim()) {
      // Blank line — leave a paragraph break.
      body.appendParagraph('')
      continue
    }

    var trimmed = line.trim()

    // Headings.
    var headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (headingMatch) {
      var level = headingMatch[1].length
      var heading = body.appendParagraph(headingMatch[2])
      heading.setHeading(
        level === 1
          ? DocumentApp.ParagraphHeading.HEADING1
          : level === 2
          ? DocumentApp.ParagraphHeading.HEADING2
          : DocumentApp.ParagraphHeading.HEADING3,
      )
      _applyInlineFormatting(heading.editAsText(), heading.getText())
      continue
    }

    // Numbered list (1. foo / 2. foo).
    var numberedMatch = /^\d+\.\s+(.+)$/.exec(trimmed)
    if (numberedMatch) {
      var numItem = body.appendListItem(numberedMatch[1])
      numItem.setGlyphType(DocumentApp.GlyphType.NUMBER)
      _applyInlineFormatting(numItem.editAsText(), numItem.getText())
      continue
    }

    // Bullet list (- foo, * foo).
    var bulletMatch = /^[-*]\s+(.+)$/.exec(trimmed)
    if (bulletMatch) {
      var bulletItem = body.appendListItem(bulletMatch[1])
      bulletItem.setGlyphType(DocumentApp.GlyphType.BULLET)
      _applyInlineFormatting(bulletItem.editAsText(), bulletItem.getText())
      continue
    }

    // Plain paragraph.
    var para = body.appendParagraph(trimmed)
    _applyInlineFormatting(para.editAsText(), para.getText())
  }
}

/**
 * Walk a Text element and apply bold / italic / monospace runs based
 * on the original markdown. The substitution is destructive — we
 * rewrite the displayed text to strip the markdown delimiters once
 * the formatting has been recorded.
 */
function _applyInlineFormatting(textElement, raw) {
  // Patterns ordered most-specific first so `**bold**` doesn't get
  // chewed by the italic pattern.
  var patterns = [
    { regex: /\*\*([^*]+)\*\*/g, apply: 'bold' },
    { regex: /__([^_]+)__/g, apply: 'bold' },
    { regex: /(?:^|[^*])\*([^*\s][^*]*[^*\s]|[^*\s])\*/g, apply: 'italic' },
    { regex: /(?:^|[^_])_([^_\s][^_]*[^_\s]|[^_\s])_/g, apply: 'italic' },
    { regex: /`([^`]+)`/g, apply: 'mono' },
  ]

  // Iteratively rewrite. Each pass strips the delimiters from the
  // matched range and reapplies the formatting on the surviving
  // characters.
  for (var p = 0; p < patterns.length; p++) {
    var pattern = patterns[p]
    var current = textElement.getText()
    var match
    while ((match = pattern.regex.exec(current)) !== null) {
      var fullMatch = match[0]
      var inner = match[1]
      // Some italic patterns include a leading non-delimiter char to
      // avoid eating the bold delimiters; trim it back if present.
      var leadingChar =
        pattern.apply === 'italic' && fullMatch.charAt(0) !== '*' &&
        fullMatch.charAt(0) !== '_'
          ? fullMatch.charAt(0)
          : ''
      var startInMatch = leadingChar ? 1 : 0
      var matchStart = match.index + startInMatch
      var matchEnd = matchStart + fullMatch.length - leadingChar.length
      var innerStart = matchStart + (pattern.apply === 'mono' ? 1 : 2)
      var innerEnd = innerStart + inner.length

      // Replace the full match with just the inner text.
      textElement.deleteText(matchStart, matchEnd - 1)
      textElement.insertText(matchStart, inner)

      // Apply formatting to the inserted range.
      var rangeStart = matchStart
      var rangeEnd = matchStart + inner.length - 1
      if (rangeEnd >= rangeStart) {
        if (pattern.apply === 'bold') {
          textElement.setBold(rangeStart, rangeEnd, true)
        } else if (pattern.apply === 'italic') {
          textElement.setItalic(rangeStart, rangeEnd, true)
        } else if (pattern.apply === 'mono') {
          textElement.setFontFamily(rangeStart, rangeEnd, 'Roboto Mono')
        }
      }

      // Continue scanning from the end of the formatted range. We
      // re-read the text because positions shifted.
      current = textElement.getText()
      pattern.regex.lastIndex = rangeEnd + 1
      // Avoid catastrophic loops if the pattern re-matches itself.
      if (innerStart === innerEnd) break
    }
  }
}

// =====================================================================
//  Helpers
// =====================================================================

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  )
}

/**
 * Apps Script's `doPost(e)` exposes headers via `e.headers` only on
 * newer V8 runtimes. This helper reads either the request property
 * (legacy) or the headers map, returning `null` on miss.
 */
function _readHeader(e, name) {
  if (!e) return null
  if (e.headers && typeof e.headers === 'object') {
    var direct = e.headers[name]
    if (typeof direct === 'string' && direct.length > 0) return direct
    // Apps Script normalises some header names to lowercase.
    var lower = e.headers[name.toLowerCase()]
    if (typeof lower === 'string' && lower.length > 0) return lower
  }
  return null
}
