# Lystos Automation

Auto-sends a first-touch WhatsApp message to private owners ("particulares")
the moment their property listing appears in a real-estate agent's Lystos
feed. Multi-agent by design: onboarding another agent is one YAML file plus
env vars — no code changes.

See [DESIGN.md](DESIGN.md) for the full architecture and rationale.

```
Lystos (agent's account, Playwright) ──▶ ingest ──▶ filters ──▶ global contact
                                                                ledger (dedupe,
                                                                opt-outs)
                                                                      │
WhatsApp Cloud API ◀── worker (quiet hours, daily cap, pacing, ◀── outbox
        │                       retries, DRY RUN by default)
        └──▶ webhook server: delivery statuses, replies, instant opt-out
```

## Commands

| Command | What it does |
|---|---|
| `npm run ingest` | One scrape pass: pull new listings, match, queue messages. Run from cron every few minutes. |
| `npm run worker` | Long-running send loop. **Dry-run by default** — set `DRY_RUN=false` to send. |
| `npm run serve` | Webhook server for WhatsApp delivery statuses, replies and opt-outs. |
| `npm run capture -- <agent>` | Calibration: records the Lystos app's network traffic + DOM to `data/capture/`. |
| `npm run report` | Pipeline state, message previews, latest replies. |
| `npm test` | Test suite (pipeline idempotency, dedupe, scheduling, webhook, opt-outs). |
| `npm run smoke` | Full end-to-end rehearsal: real browser scraper + pipeline + live-mode sender + webhooks against built-in fake Lystos/Meta servers. No credentials needed. |

Append an agent id to `ingest`/`worker`/`capture` to target one agent.

## Setup

### 1. Install

```bash
npm install
npx playwright install chromium   # browser for the Lystos session
cp .env.example .env              # fill in secrets
```

If a system Chromium should be used instead of the Playwright-managed one,
point `CHROMIUM_PATH` at its binary.

### 2. Calibrate the Lystos scraper (one-time, per Lystos UI change)

This repo was built without live access to app.lystos.com, so the login
selectors and listing-feed parsing in
`src/ingestion/lystos/selectors.ts` / `parsers.ts` are **educated guesses that
must be verified once** against the real app:

1. Put the agent's Lystos credentials in `.env`.
2. In her account, open the saved search for her zones filtered to
   *particulares*, copy the URL into `agents/<agent>.agent.yaml` → `searchUrl`.
3. Run `npm run capture -- <agent>` (add `HEADFUL=1` to watch the browser).
4. In `data/capture/<agent>/`, find the JSON response carrying the listing
   feed. Update `LYSTOS.listingApiPatterns` with a distinctive URL substring,
   and check `parsers.ts` maps its fields (id, price, zone, owner phone).
5. `npm run ingest -- <agent>` then `npm run report` — you should see listings
   and queued previews.

The scraper intercepts the JSON the Lystos SPA fetches for its own UI rather
than scraping the DOM, so it survives visual redesigns; only genuine API
changes require re-calibration.

### 3. WhatsApp Business Cloud API (per agent)

1. Meta Business Manager → WhatsApp → add a **dedicated** sender number
   (never automate a personal WhatsApp — numbers get banned).
2. Create the message templates and submit for approval. Each template in the
   agent YAML must match an approved template's name, language and `{{n}}`
   parameter count/order. Include an opt-out line ("Responde BAJA…").
3. Put the phone-number id and a permanent access token in `.env`.
4. Point the webhook to `https://<your-host>/webhooks/whatsapp` with your
   `WA_VERIFY_TOKEN`, subscribed to `messages`.

### 4. Go live — in stages

1. Run `ingest` (cron) + `worker` with `DRY_RUN=true` for a few days.
2. Review `npm run report` with the agent: are the right listings matched?
   Do the previews read well?
3. Set `DRY_RUN=false`. Caps start conservative (25/day, ≥2 min between
   sends, no sends 20:30–09:30) — raise them slowly as the number builds
   sending reputation with Meta.

### Deploy

Single small VPS is plenty. `docker compose up -d` runs worker + webhook
server; add a host cron entry for ingestion:

```cron
*/5 8-21 * * * cd /opt/lystos-automation && docker compose run --rm app npm run ingest
```

Back up `data/` (SQLite DB + session state). To migrate to Postgres later,
the schema in `src/db/schema.sql` ports directly.

## Onboarding a new agent

1. `cp agents/example.agent.yaml agents/<id>.agent.yaml` and edit zones,
   price band, templates, caps.
2. Add her Lystos credentials + WhatsApp credentials to `.env` under the
   names the YAML references.
3. Calibrate step 2.2 (just the searchUrl; selectors are shared), dry-run,
   then go live.

## Compliance (Spain)

- Business-initiated WhatsApp messages **must** use Meta-approved templates.
- Every template includes an opt-out instruction; a reply matching
  BAJA/STOP/"no me contactes" **instantly and permanently** blocks the
  contact (`contacts.opted_out`) and cancels pending messages.
- The global contact ledger guarantees one first-touch per phone number,
  ever — across relistings and across agents.
- `events` is an append-only audit log of every queued/sent/failed message
  and opt-out: your GDPR accountability record.
- Identify the agent honestly in message one. No sends during quiet hours.
