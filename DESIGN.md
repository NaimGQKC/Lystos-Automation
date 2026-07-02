# Lystos Listing-Outreach Automation — Design Document

**Status:** Implemented (MVP) — see README.md. Decisions taken since this draft: her plan has **no API access** and the €0.50/lead native assistant is rejected, so ingestion is Option C done right (Playwright session against her account, intercepting the SPA's JSON rather than scraping the DOM). Stack simplifications for a single-VPS deployment: SQLite instead of Postgres (schema ports directly if/when needed) and a DB-backed outbox worker instead of Redis/BullMQ. WhatsApp Cloud API confirmed as the sending channel.
**Goal:** When a private owner ("particular") publishes a new property listing in the agent's target zones, automatically send them a first-touch message — reliably, compliantly, and fast enough to beat competing agents. Built so onboarding a second, third, Nth agent is configuration, not code.

---

## 1. What Lystos actually gives us (research findings)

Lystos is a Spanish real-estate prospecting platform (Barcelona, founded 2021) used by agents to capture owner-listed properties. Relevant capabilities discovered:

| Capability | Detail |
|---|---|
| **Listing alerts** | Real-time alerts for new listings in selected zones, deliverable to WhatsApp; marketed as arriving "before Idealista alerts". Filterable to private sellers vs agencies. |
| **Public API** (`docs.lystos.com`) | Capture API (deduplicated listing database, filters by location/size/price), Valuation API, Real Sales API, and **webhooks for new listings and leads**. Custom/company-tier access. |
| **AI message templates** | Lystos AI generates WhatsApp templates populated with owner + listing details. |
| **Native "Asistente IA"** | Lystos' own auto-contact feature: when a new listing hits an alert, its AI sends the first WhatsApp message, validates the poster is the actual owner (filters out agencies posing as particulares and sold listings), verifies location, asks to schedule a visit, and pings the agent on WhatsApp when a lead qualifies. Costs **€0.50 per initiated conversation**, unlimited messages after that. |

The last row matters: **Lystos already sells a version of this automation.** Our build has to be justified by control, cost at volume, or multi-agent scalability — and it is (see §3).

## 2. The core flow we're automating

```
new listing published
      → Lystos detects & deduplicates it
      → our system learns about it (webhook, ideally; polling as fallback)
      → filter: private owner? in agent's zones? price band? property type? not already contacted?
      → compose message (template + listing variables, optionally AI-personalized)
      → send via WhatsApp (primary channel in Spain)
      → record state, schedule follow-ups, handle replies/opt-outs
```

## 3. Integration options (build vs buy vs hack)

### Option A — Use Lystos' native AI assistant (buy)
- ✅ Zero code, owner-validation and lead qualification included, live today.
- ❌ €0.50/lead adds up; message flow is Lystos-controlled (limited voice/branding); the "product" is theirs — nothing reusable across agents on our terms; no custom follow-up sequences or analytics.

### Option B — Lystos API + webhooks → our pipeline → WhatsApp Business Cloud API (build) ⭐ recommended
- ✅ Full control of message content, timing, follow-up cadence, and data. Marginal cost per message is near zero (Meta charges ~€0.03–0.06 per business-initiated conversation in Spain vs €0.50). Genuinely multi-tenant. Clean, supported integration surface.
- ❌ Requires API access on her Lystos plan (must confirm — likely a company-tier add-on); requires a Meta WhatsApp Business account + approved message templates (a few days of setup); we own compliance.

### Option C — Automate her Lystos account via browser automation (hack/fallback)
- Playwright session against the web app, scraping the alert feed and owner phone numbers.
- ❌ Fragile, breaks on UI changes, likely violates Lystos ToS, doesn't scale to many agents. **Only a stopgap** if API access turns out to be unavailable or unaffordable — and even then, prefer a lighter fallback: parse the WhatsApp/email alert notifications Lystos already sends her (structured, stable, and something her plan already includes).

**Recommendation:** Design for **B**, with the ingestion layer abstracted so a C-style fallback (alert parsing) can slot in behind the same interface if API access is blocked. Everything downstream of ingestion is identical either way.

## 4. Architecture (multi-tenant from day one)

Modular monolith — one deployable, clear internal seams. Splitting into services later is possible but unnecessary at this scale.

```
                        ┌────────────────────────────────────────────┐
 Lystos webhook ───────▶│ INGESTION                                  │
 (or poller /           │  adapters: lystos-webhook | lystos-poll |  │
  alert parser)         │            alert-email-parser (fallback)   │
                        └───────────────┬────────────────────────────┘
                                        ▼
                        ┌────────────────────────────────────────────┐
                        │ MATCHING & DEDUPE                          │
                        │  per-agent rules: zones, price band, type, │
                        │  private-owner-only; global contact ledger │
                        │  (never message the same owner/phone twice │
                        │   across listings or agents of one agency) │
                        └───────────────┬────────────────────────────┘
                                        ▼
                        ┌────────────────────────────────────────────┐
                        │ COMPOSER                                   │
                        │  approved WhatsApp template + variables    │
                        │  (name, property, zone, price…);           │
                        │  optional LLM personalization within the   │
                        │  template's free-text slot; A/B variants   │
                        └───────────────┬────────────────────────────┘
                                        ▼
                        ┌────────────────────────────────────────────┐
                        │ SENDER (channel adapters)                  │
                        │  whatsapp-cloud-api (primary) | twilio |   │
                        │  sms | email — per-agent sender identity   │
                        │  throttling, quiet hours (no 3am msgs),    │
                        │  daily caps, retry with backoff            │
                        └───────────────┬────────────────────────────┘
                                        ▼
                        ┌────────────────────────────────────────────┐
                        │ CONVERSATION & FOLLOW-UP                   │
                        │  inbound webhook: replies, STOP/opt-out;   │
                        │  reply classification (interested / not /  │
                        │  agency / sold); follow-up sequence for    │
                        │  non-responders (e.g. day 3, day 7);       │
                        │  hot-lead alert forwarded to the agent     │
                        └───────────────┬────────────────────────────┘
                                        ▼
                        ┌────────────────────────────────────────────┐
                        │ STORAGE & OBSERVABILITY                    │
                        │  Postgres: agents, listings, contacts,     │
                        │  messages, events (append-only audit log)  │
                        │  metrics: sends, delivery, reply rate,     │
                        │  template win-rate, leads per zone         │
                        └────────────────────────────────────────────┘
```

### Multi-tenancy model
- `agents` table + per-agent config (target zones as polygon/municipality codes, price bands, property types, templates, quiet hours, daily cap, sender credentials).
- Onboarding a new agent = one config record + connecting their Lystos API key and WhatsApp sender number. No code changes.
- Secrets (Lystos keys, Meta tokens) in environment/secret store, referenced by ID from config — never in the repo or DB plaintext.
- A **global contact ledger** keyed on normalized phone number prevents re-messaging an owner who relisted, changed portals, or is targeted by two agents in the same brokerage.

### Idempotency & reliability (the unglamorous part that makes it trustworthy)
- Every listing event carries a Lystos listing ID → unique constraint means webhook retries or poller overlap can never double-send.
- Outbox pattern: message rows go `pending → sent → delivered/failed`, workers pick up `pending`; a crash mid-send never loses or duplicates a message.
- Dead-letter state + alert to us when a send fails permanently.

## 5. Compliance guardrails (Spain — non-negotiable)

- **WhatsApp:** business-initiated messages **must** use Meta-approved templates via the official Cloud API. No `whatsapp-web.js`/personal-number automation — accounts get banned quickly at exactly the volumes we want, and the agent would lose her number.
- **GDPR/LSSI-CE:** contacting a seller about the property they publicly advertised is defensible as legitimate interest, but: identify the agent honestly in message one, include an obvious opt-out, honor STOP instantly (hard-block in the ledger), retain only necessary data, and log every send (the audit trail in `events` doubles as our GDPR accountability record).
- **Rate discipline:** conservative daily caps and human-like send pacing protect the WhatsApp number's quality rating.

## 6. Innovations worth building (beyond the baseline)

1. **AI-personalized opener** — use listing details plus the Lystos Valuation API to lead with substance: *"…tu piso de 3 habitaciones en Gràcia está publicado a 310k; los cierres reales en tu manzana este trimestre están en 295–330k…"*. Data-backed first messages are the single biggest differentiator vs the generic blasts every owner already receives.
2. **Template A/B testing** — rotate 2–3 approved template variants per agent, measure reply rate, auto-promote the winner.
3. **Reply triage** — classify inbound replies (interested / not owner / already sold / hostile) and forward only hot leads to the agent's personal WhatsApp with full context, so her phone only buzzes for real opportunities.
4. **Speed-to-lead metric** — track listing-published → message-sent latency; being first is most of the value in captación.
5. **Relist radar** — owner ledger notices when a previously-contacted listing expires or is relisted at a lower price → triggers a tailored "I see it's still on the market" follow-up.

## 7. Proposed stack & repo layout

**TypeScript / Node 22** end to end (webhook server, workers, future dashboard in one language), **Postgres**, **BullMQ + Redis** for queues/scheduled follow-ups (or pg-boss to stay Postgres-only at MVP), **Fastify** for webhook endpoints, **Prisma** or Drizzle for the schema, **Docker Compose** for dev, deployable to a single small VPS/Fly.io/Railway box.

```
lystos-automation/
├── src/
│   ├── ingestion/        # lystos-webhook.ts, lystos-poller.ts, alert-parser.ts (fallback)
│   ├── matching/         # rules engine, dedupe, contact ledger
│   ├── composer/         # templates, variables, LLM personalization, A/B
│   ├── sender/           # channel adapters: whatsapp-cloud.ts, twilio.ts, …
│   ├── conversation/     # inbound replies, opt-out, follow-up sequencer, triage
│   ├── config/           # agent config schema + loader
│   └── server.ts         # Fastify app wiring webhooks + health
├── prisma/ (or drizzle/) # schema & migrations
├── agents/               # per-agent config (secrets referenced by env ID)
│   └── example.agent.yaml
├── docker-compose.yml
└── DESIGN.md
```

## 8. Phased plan

- **Phase 0 — Discovery (needs her account):** log into her Lystos account; confirm whether her plan includes API access and webhooks; inspect an alert payload; export a sample listing to see exactly which owner fields (phone!) we get. This decides Option B vs fallback.
- **Phase 1 — MVP (one agent, first touch):** ingestion (webhook or poller) → rules → dedupe → one approved WhatsApp template → send → log. Dry-run mode that writes messages to the DB without sending, so she can review a week of would-be messages before going live.
- **Phase 2 — Conversation:** inbound webhook, opt-out handling, follow-up sequence, hot-lead forwarding.
- **Phase 3 — Scale:** multi-agent onboarding config, A/B testing, analytics dashboard, valuation-powered personalization.

## 9. Open questions (blocking Phase 0 → 1)

1. **Which Lystos plan does she have?** Does it include API/webhook access, or only in-app alerts? (Determines ingestion path.)
2. **Sender identity:** is she willing to set up a WhatsApp Business (Cloud API) number, or does she insist messages come from her personal number? (Personal-number automation is a ban risk; if she insists, the compromise is: we auto-draft, she taps send.)
3. **Volume estimate:** roughly how many new private listings/day appear in her zones? (Sizes cost and rate limits.)
4. **First-touch only, or qualification?** Should the bot converse (validate owner, propose visit — competing with Lystos' €0.50 assistant) or just open the door and hand off to her?
5. **Message language/tone:** her existing scripts, if any, are the best seed for templates.
