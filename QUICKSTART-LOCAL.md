# Real testing on your own machine (~15 min)

Why local: your computer has a real Chrome and a Spanish/residential IP.
Cloud sandboxes get connection-reset by Lystos's CDN. Run this once and we
know the whole thing works.

**Two layers of safety.** `DRY_RUN=true` (the default) contacts nothing at
all. And even with `DRY_RUN=false`, `mode: draft` only writes into her
**Drafts folder** — she reviews each one and presses send herself. Flipping
to real sending is a one-line change, later, when you're ready.

## 1. Get the code

Requires Node 20+ (`node -v`; if missing: https://nodejs.org).

```bash
git clone https://github.com/NaimGQKC/Lystos-Automation.git
cd Lystos-Automation
git checkout claude/lystos-agent-automation-f7fgop
npm install
npx playwright install chromium
```

Sanity check that everything works before touching real accounts:

```bash
npm test        # 38 tests
npm run smoke   # full end-to-end rehearsal, prints a sample draft
```

## 2. Point it at her Lystos search

```bash
cp agents/example.agent.yaml agents/maria.agent.yaml
cp .env.example .env
```

In her Lystos account, open the saved search for her zones filtered to
**particulares**, and copy the URL from the address bar.

Edit `agents/maria.agent.yaml`:
- `id: maria`
- `searchUrl:` → paste that URL
- `credentialsEnvPrefix: LYSTOS_MARIA`
- `fromEnv/userEnv/passwordEnv` → `EMAIL_MARIA_FROM` / `_USER` / `_PASSWORD`
- `zones`, `priceMin`, `priceMax` → her real targets
- the two `templates` → her words (edit freely, no approval needed)

Edit `.env` (gitignored — credentials never reach GitHub):

```
LYSTOS_MARIA_EMAIL=her-lystos-email
LYSTOS_MARIA_PASSWORD=her-lystos-password

EMAIL_MARIA_FROM=María García <maria@inmobiliaria.es>
EMAIL_MARIA_USER=maria@inmobiliaria.es
EMAIL_MARIA_PASSWORD=her-app-password
```

If her mail is Gmail/Outlook with 2FA, generate an **app password** — the
normal account password won't authenticate over IMAP/SMTP.

## 3. Watch it log into Lystos

```bash
HEADFUL=1 npm run capture -- maria
```

A Chrome window opens, logs in, and loads her search. Everything it sees is
saved to `data/capture/maria/`. **This is the moment of truth** — if login
works and files appear, the hard part is solved.

If it fails, open `data/capture/maria/page.png` to see where it stopped and
send me that plus the terminal output.

## 4. Send me the feed

```bash
cat data/capture/maria/_index.json
```

Open the 2–3 JSON files whose URLs look like the listing feed (search /
listings / anuncios) and **paste me their contents**. Scrub personal data if
you like — I only need field *names* and structure.

This also answers the one open question: **do her listings carry owner email
addresses?** If they only have phones, email can't reach owners directly and
we'll switch the plan (see below).

## 5. See the real messages

Once I've calibrated the parser to her real feed:

```bash
npm run ingest -- maria     # scrape + match + queue
npm run report              # exactly what would be sent, to whom
```

Still zero contact — `DRY_RUN=true`.

## 6. Create real drafts in her mailbox

When the report looks right:

```bash
DRY_RUN=false npm run worker -- maria
```

Drafts appear in her Drafts folder, addressed to owners, ready for her to
review and send. Stop it with Ctrl-C once a few have landed.

## 7. Later: flip to fully automatic sending

In `agents/maria.agent.yaml`, change `mode: draft` → `mode: send`. Same
pipeline, no drafts — emails go straight out, respecting quiet hours, the
daily cap, and pacing.

## If owner emails don't exist in the feed

Then the owner-email plan can't work as-is, and the options are:
1. **Draft to her instead** — same automation, the draft lands in her inbox
   with the owner's phone and a ready-to-send message she copies into
   WhatsApp. One small change.
2. **Go back to WhatsApp** — the code still supports it (`channel: whatsapp`),
   it just needs the Meta Business setup you wanted to avoid.

The capture in step 4 tells us which world we're in.

## Using a Spanish rotating IP (optional)

If Lystos blocks your IP, add to `.env`:

```
PROXY_SERVER=http://user:pass@es-proxy-host:port
```

The browser session routes through it automatically. Residential Spanish IPs
work; datacenter IPs are what get reset.
