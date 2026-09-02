# Setup (~5 min)

No config files. Fill in `.env`, run two commands.

## 1. Install

Requires Node 20+ (`node -v`; if missing: https://nodejs.org).

```powershell
git clone https://github.com/NaimGQKC/Lystos-Automation.git lystos-bot
cd lystos-bot
git checkout claude/lystos-agent-automation-f7fgop
npm install
npx playwright install chromium
```

Check it works before touching real accounts (uses a built-in fake Lystos):

```powershell
npm run smoke
```

## 2. Fill in `.env`

```powershell
copy .env.example .env
notepad .env
```

Six lines: her Lystos login, her name, and her mailbox login. That's it —
the particulares (FSBO) feed is a fixed page on Lystos, so there's nothing
to configure.

Gmail/Outlook with 2FA need an **app password**, not the account password.

## 3. Sign in — ONCE

**Lystos limits how many devices can be signed in at once, and every
sign-in uses up a slot.** So this tool signs in a single time, by hand, and
reuses that session forever after.

```powershell
npm run login
```

A browser window opens. Sign in there yourself, exactly as you normally
would (including any "cerrar todas las sesiones" prompt or 2FA). As soon as
you reach the app, the session is saved to `data\state\` and the window can
be closed.

If you ever see *"Has sobrepasado el límite de dispositivos activos"*: open
Lystos in your normal browser, click **Cerrar todas las sesiones**, sign in
again, then re-run `npm run login`. The tool never clicks that button
itself — it would sign the agent out of her own phone and laptop.

## 4. Grab the feed

```powershell
$env:HEADFUL=1
npm run capture
```

Reuses the saved session — no new sign-in — loads the particulares feed and
saves everything to `data\capture\default\`.

If anything fails, a screenshot lands in that same folder showing exactly
where it stopped.

## 5. See what it would send

```powershell
npm run ingest
npm run report
```

Prints the listings it matched and the exact emails it would write.
Nothing is contacted — `DRY_RUN=true`.

Listings where no owner email was found are **not** dropped: they appear
under "Needs a human" with the owner's phone and the listing link, so they
can be picked up manually.

## 6. Create real drafts

When the report looks right, set `DRY_RUN=false` in `.env`, then:

```powershell
npm run worker
```

Drafts appear in her Drafts folder, addressed to owners, ready for her to
review and send. Ctrl-C to stop.

## 7. Later: fully automatic

Add `EMAIL_MODE=send` to `.env`. Same pipeline, no drafts — emails go
straight out, respecting the daily cap, pacing, and quiet hours.

## Running it on a schedule

`npm run ingest` is one pass — run it every few minutes (Task Scheduler on
Windows, cron on Linux). `npm run worker` runs continuously and drains the
queue.

## Optional tweaks (all in `.env`)

| Variable | Effect |
| :-- | :-- |
| `ZONES=Gràcia,Eixample` | Only these areas |
| `PRICE_MIN` / `PRICE_MAX` | Only this price band |
| `LYSTOS_SEARCH_URL` | Watch a specific saved search instead |
| `PROXY_SERVER` | Route through a Spanish residential IP |
| `SLOW_MO` / `SETTLE_MS` | Drive the browser slower (default 300ms / 6s) |
| `SMTP_HOST` / `IMAP_HOST` / `DRAFTS_MAILBOX` | Non-Gmail mailboxes |

## Multiple agents

Drop a `<name>.agent.yaml` into `agents/` (see
`agents/example.agent.yaml.sample`) for each extra agent with different
zones, mailbox or wording. With no YAML files present, everything runs from
`.env` as above.
