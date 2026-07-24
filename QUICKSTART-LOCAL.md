# Real testing on your own machine (~15 min)

Why local: your computer has a real Chrome and a Spanish/residential IP.
Cloud sandboxes get connection-reset by Lystos's CDN. Run this once to prove
the Lystos side works, then we know the whole thing works.

**Nothing is sent at any point.** Dry-run is the default and there are no
sending credentials configured yet.

## 1. Get the code

Requires Node 20+ (`node -v` to check; if missing: https://nodejs.org).

```bash
git clone https://github.com/NaimGQKC/Lystos-Automation.git
cd Lystos-Automation
git checkout claude/lystos-agent-automation-f7fgop
npm install
npx playwright install chromium
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
- `zones`, `priceMin`, `priceMax` → her real targets

Edit `.env` (this file is gitignored — credentials never reach GitHub):

```
LYSTOS_MARIA_EMAIL=her-lystos-email
LYSTOS_MARIA_PASSWORD=her-password
```

## 3. Watch it log in

```bash
HEADFUL=1 npm run capture -- maria
```

A Chrome window opens, logs in, and loads her search. It saves everything it
sees to `data/capture/maria/`. **This is the moment of truth** — if the login
works and files appear, the hard part is solved.

If login fails, it's a selector mismatch: open `data/capture/maria/page.png`
to see where it got stuck, and send me that screenshot plus the terminal
output.

## 4. Send me the results

```bash
cat data/capture/maria/_index.json
```

Then open the 2–3 JSON files whose URLs look like the listing feed (search /
listings / anuncios) and **paste me their contents**. Scrub phone numbers and
emails if you like — I only need the field *names* and structure.

With that I'll calibrate the parser and you'll be able to run:

```bash
npm run ingest -- maria
npm run report
```

...which prints the real listings matched and the exact messages that would
go out.

## Using a Spanish rotating IP (optional)

If Lystos ever blocks your IP, add to `.env`:

```
PROXY_SERVER=http://user:pass@es-proxy-host:port
```

The browser session routes through it automatically. Residential Spanish IPs
work best; datacenter IPs are what get reset.
