# Google Workspace Bridge — Apps Script Deployment

This directory contains the Google Apps Script source code that mediates between the Life Management AI assistant and the user's Google Workspace (Gmail, Calendar, Drive). The script runs inside the user's own Google account, eliminating the need for a third-party OAuth integration or paid automation service.

---

## Architecture

```
[ AI Assistant (Mistral) ]
            │  tool call
            ▼
[ Edge Function: chat.ts ]
            │  HTTPS POST + X-Secret header
            ▼
[ Google Apps Script Web App (Code.gs) ]
            │  native auth (executes as the user)
            ▼
[ Gmail / Calendar / Docs / Drive ]
```

The AI asks the assistant to act on the user's Workspace data via OpenAI-compatible tool calls. The edge function forwards each call to the deployed Apps Script Web App, which runs under the user's own Google identity and returns a JSON envelope back up the chain.

## Why Apps Script

- **Free.** Apps Script's quota is generous for personal use (≈ 20,000 outbound URL fetches per day).
- **No OAuth dance.** The script runs as the authenticated user. The application never touches Google OAuth tokens.
- **Full Workspace access.** Gmail, Calendar, Drive, Docs, Sheets — all native.

## One-Time Deployment

### 1. Create the script

1. Open [script.google.com](https://script.google.com) and click **New project**.
2. Replace the contents of `Code.gs` with the file in this directory (also named `Code.gs`).
3. Rename the project to something memorable (e.g., `herrington workspace bridge`).

### 2. Set the shared secret

1. Click the **gear icon → Project Settings**.
2. Under **Script properties**, click **Add script property**.
3. Property name: `SECRET`. Value: any long random string (e.g., the output of `openssl rand -hex 32`).
4. Save.

### 3. Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Configure:
   - **Description**: anything descriptive.
   - **Execute as**: `Me` (your own Google account).
   - **Who has access**: `Anyone`.
4. Click **Deploy**.
5. The first deployment opens an authorization screen. Approve the requested scopes (Gmail, Calendar, Drive, Docs).
6. Copy the **Web app URL**.

### 4. Wire the application

Add the following entries to your `.env` file:

```
GOOGLE_GAS_WEBHOOK_URL=https://script.google.com/macros/s/AKfycbx.../exec
GOOGLE_GAS_SECRET=<the same string you set as SECRET above>
```

Restart the dev server. The AI assistant will pick up the new tools automatically on the next chat turn.

## Updating the Script

When this `Code.gs` file changes (new actions added, bug fixes), repeat steps 1–3 of the deployment. The Web app URL **does not change** between deployments of the same project as long as you select **Manage deployments → edit → New version** rather than creating a brand new deployment.

## Available Actions

The Apps Script accepts the following discriminated-union payloads on `POST`:

| `kind` | Inputs | Output |
|---|---|---|
| `list_unread_emails` | `max?: number` (capped at 10) | Array of `{ id, from, subject, receivedAtSec, snippet }` |
| `check_calendar_availability` | `startSec`, `endSec` (unix seconds) | `{ events, isFree }` for the window |
| `create_calendar_event` | `title`, `startSec`, `endSec?`, `description?` | The created event with `htmlLink` |
| `create_doc` | `title`, `body`, `folderId?` | The created document with `url` |

Every response is a JSON envelope of shape `{ ok: boolean, data?: T, error?: string }`.

## Security

- The Web app URL alone is not enough to invoke actions. Every request must include the shared secret as a `secret` query parameter (Apps Script's `doPost(e)` strips custom headers — query parameters are the reliable transport here). The bridge URL is HTTPS, so the secret stays inside TLS and is never visible on the wire.
- The application stores the secret in `.env` as `GOOGLE_GAS_SECRET`. The browser never sees it; only edge functions read it.
- The `Anyone` access setting is required for the Web app to be reachable from outside Google's network. Authentication is performed by the secret check inside `Code.gs`, not by Google's identity layer.
- The script never makes outbound calls and never stores anything beyond the active request. There is no logging, no analytics, no telemetry.

## Quotas

Apps Script's daily quota for free Google accounts (as of writing) covers personal use comfortably:

| Resource | Daily quota |
|---|---|
| URL fetches inbound (this Web app) | 20,000 |
| Gmail read | 20,000 messages read |
| Calendar events created | 5,000 |
| Documents created | 250 |

These limits are per user, not per script, so multi-account use would require duplicate deployments (not supported by this template).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ok: false, error: "unauthorized"` | Secret mismatch | Verify `GOOGLE_GAS_SECRET` in `.env` matches the `SECRET` script property exactly (no quotes, no trailing whitespace). |
| `ok: false, error: "missing body"` | Request reached the script but the body was empty | Inspect the edge log; `callGoogleAction` should always send a JSON body. |
| `Apps Script returned a non-JSON response` | Apps Script error page returned as HTML | Open the script in the editor → View → Executions to see the stack trace. Common cause: the requested service (e.g., Calendar) is not authorized — re-deploy and re-authorize. |
| `Google webhook HTTP 401` from edge | Web app set to "Only myself" or similar | Re-deploy with **Who has access**: `Anyone`. |
| Calendar / Gmail returns empty when there is data | First-time auth was rejected | Open the script editor, run any function manually once to retrigger the consent screen. |
