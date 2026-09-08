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

Two ways. **Option A is the least intrusive**: the tool drives the Chrome
you already use, already signed in. It creates no session and uses no
device slot.

### Option A — drive your own Chrome

Close Chrome completely, then start it with remote debugging on. In
PowerShell:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\lystos-chrome"
```

Sign in to Lystos in that window, once. That folder is now a normal Chrome
profile that stays signed in — reuse the same command every time.

Then add to `.env`:

```
CHROME_CDP_URL=http://127.0.0.1:9222
```

Leave that Chrome open when you run `npm run ingest`. The tool attaches to
it, reads the feed in a tab, and never touches your login. If the window
isn't signed in, it says so and stops rather than trying to sign in itself.

(The separate `--user-data-dir` is required: recent Chrome refuses remote
debugging on your default profile. It's a real profile, just a second one.)

### Option B — let the tool keep its own profile

**Lystos limits how many devices can be signed in at once, and every
sign-in uses up a slot.** So this tool signs in a single time, by hand, and
reuses that session forever after.

```powershell
npm run login
```

A browser window opens. Sign in there yourself, exactly as you normally
would (including any "cerrar todas las sesiones" prompt or 2FA). The
sign-in is kept in a persistent profile at `data\profile\`, so it survives
restarts the same way your own browser does — you should not have to repeat
this.

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
| `CHROME_CDP_URL` | Drive a Chrome you already have open (see step 3A) |
| `PROXY_SERVER` | Route through a Spanish residential IP |
| `SLOW_MO` / `SETTLE_MS` | Drive the browser slower (default 300ms / 6s) |
| `SMTP_HOST` / `IMAP_HOST` / `DRAFTS_MAILBOX` | Non-Gmail mailboxes |

## Multiple agents

Drop a `<name>.agent.yaml` into `agents/` (see
`agents/example.agent.yaml.sample`) for each extra agent with different
zones, mailbox or wording. With no YAML files present, everything runs from
`.env` as above.
