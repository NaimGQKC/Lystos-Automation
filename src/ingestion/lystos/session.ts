import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "../../config/agent.js";
import { env, requireEnv } from "../../env.js";
import { logger } from "../../logger.js";
import { LYSTOS, isAuthPage } from "./selectors.js";

/** Sleep for roughly `ms`, varied ±30% so the rhythm isn't machine-regular. */
export function jitter(ms: number): Promise<void> {
  const spread = ms * 0.3;
  return new Promise((r) => setTimeout(r, ms - spread + Math.random() * spread * 2));
}

/** Manages an authenticated browser session against app.lystos.com.
 *
 *  Runs in one of two modes:
 *
 *  ATTACH (CHROME_CDP_URL set) — drive a Chrome the user already has open and
 *  signed in. Nothing new is launched, no session is created, no device slot
 *  is consumed. Their profile, their IP, their cookies.
 *
 *  PROFILE (default) — launch Chrome against a persistent profile directory,
 *  exactly like a real browser keeps yours. Sign in once and the session
 *  survives restarts, so we stop burning Lystos device slots re-authenticating.
 *
 *  Auth itself is Keycloak at account.lystos.com; whether we're signed in is
 *  decided by which host we land on rather than by probing the app's UI.
 *
 *  Deliberately unhurried throughout: actions are spaced, credentials are
 *  typed rather than pasted, and pages are given time to settle. */
export class LystosSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page_: Page | null = null;
  /** True when we attached to someone else's browser and must not close it. */
  private attached = false;

  constructor(
    private readonly agent: AgentConfig,
    private readonly opts: { headless?: boolean } = {},
  ) {}

  /** Where this agent's browser profile lives (PROFILE mode). */
  get profileDir(): string {
    return join(env.dataDir, "profile", this.agent.id);
  }

  async page(): Promise<Page> {
    if (this.page_) return this.page_;

    this.context = env.chromeCdpUrl ? await this.attachToRunningChrome() : await this.launchWithProfile();
    // Reuse an existing tab when attached, so we don't pile up windows.
    const existing = this.context.pages();
    this.page_ = this.attached && existing.length ? existing[0]! : await this.context.newPage();

    await this.ensureLoggedIn(this.page_);
    return this.page_;
  }

  /** ATTACH mode: connect to a Chrome started with --remote-debugging-port. */
  private async attachToRunningChrome(): Promise<BrowserContext> {
    const url = env.chromeCdpUrl!;
    try {
      this.browser = await chromium.connectOverCDP(url);
    } catch (err) {
      throw new Error(
        `Couldn't attach to Chrome at ${url}.\n` +
          "  Start Chrome with remote debugging enabled first — see QUICKSTART-LOCAL.md.\n" +
          `  (${String(err)})`,
      );
    }
    this.attached = true;
    const contexts = this.browser.contexts();
    if (!contexts.length) throw new Error("Attached to Chrome but it has no open window.");
    logger.info({ url }, "attached to your running Chrome — using its existing session");
    return contexts[0]!;
  }

  /** PROFILE mode: a persistent profile directory, like a real browser. */
  private async launchWithProfile(): Promise<BrowserContext> {
    mkdirSync(this.profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(this.profileDir, {
      headless: this.opts.headless ?? true,
      executablePath: env.chromiumPath,
      proxy: env.proxyServer ? { server: env.proxyServer } : undefined,
      slowMo: env.slowMo,
      locale: env.locale,
      timezoneId: env.timezoneId,
      viewport: { width: 1440, height: 900 },
      // Chromium advertises itself as automated by default; this is the
      // agent's own account, so present as an ordinary browser.
      args: ["--disable-blink-features=AutomationControlled"],
    });
    return context;
  }

  /** Navigate and wait for the page to actually finish moving. */
  async goto(page: Page, url: string): Promise<void> {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    await jitter(env.settleMs);
  }

  private async ensureLoggedIn(page: Page): Promise<void> {
    await this.goto(page, this.agent.lystos.searchUrl);
    // The redirect to Keycloak is client-side: the app boots first, THEN
    // bounces to the auth host. Checking the URL immediately after goto would
    // wrongly conclude we're signed in, so give the redirect a chance to fire.
    if (!isAuthPage(page.url())) {
      await page
        .waitForURL((u) => isAuthPage(u.toString()), { timeout: 8_000 })
        .catch(() => {}); // no redirect = the profile's session is still good
    }
    if (!isAuthPage(page.url())) return;

    if (this.attached) {
      throw new Error(
        "The Chrome you attached to isn't signed in to Lystos.\n" +
          "  Sign in in that window yourself, then run this again — nothing here\n" +
          "  will touch your login.",
      );
    }

    logger.info({ agent: this.agent.id, at: page.url() }, "profile has no valid session, signing in");
    const prefix = this.agent.lystos.credentialsEnvPrefix;

    // We may be on Lystos's own /login gate, which bounces to Keycloak a
    // moment later — so wait for the form itself rather than for a URL.
    let formVisible = await page
      .waitForSelector(LYSTOS.login.username, { timeout: 20_000, state: "visible" })
      .then(() => true)
      .catch(() => false);

    if (!formVisible) {
      // The gate sometimes waits for a click rather than redirecting itself.
      const gate = page.locator(LYSTOS.login.gateButton).first();
      if (await gate.isVisible({ timeout: 3_000 }).catch(() => false)) {
        logger.info("clicking through the Lystos login gate");
        await gate.click().catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      }
      formVisible = await page
        .waitForSelector(LYSTOS.login.username, { timeout: 25_000, state: "visible" })
        .then(() => true)
        .catch(() => false);
    }

    if (!formVisible) {
      await this.dumpFailure(page, "no-login-form");
      throw new Error(
        `Never reached the Lystos login form (stuck at ${page.url()}).\n` +
          `  Look at ${join(env.dataDir, "capture", this.agent.id, "no-login-form.png")} — it shows the page.\n` +
          "  Fix: run `npm run login` to sign in by hand once, or set CHROME_CDP_URL\n" +
          "  to drive a Chrome you're already signed in to (see QUICKSTART-LOCAL.md).",
      );
    }

    await jitter(1_200); // a person looks at the form before typing

    // Typed, not pasted: instant field population is a classic bot tell.
    await page.type(LYSTOS.login.username, requireEnv(`${prefix}_EMAIL`), { delay: 90 });
    await jitter(600);
    await page.type(LYSTOS.login.password, requireEnv(`${prefix}_PASSWORD`), { delay: 90 });
    await jitter(800);

    // Longer-lived session = fewer sign-ins later.
    const remember = page.locator(LYSTOS.login.rememberMe);
    if (await remember.isVisible().catch(() => false)) {
      await remember.check().catch(() => {});
      await jitter(400);
    }

    await page.click(LYSTOS.login.submit);
    await page
      .waitForURL((u) => !isAuthPage(u.toString()), { timeout: 60_000 })
      .catch(() => {}); // fall through to the explicit check below

    if (isAuthPage(page.url())) {
      const message = await page
        .locator(LYSTOS.login.error)
        .first()
        .textContent({ timeout: 2_000 })
        .catch(() => null);
      await this.dumpFailure(page, "login-rejected");
      throw new Error(
        `Lystos sign-in failed for agent "${this.agent.id}" — still on the auth page.` +
          (message ? ` Lystos says: "${message.trim()}"` : "") +
          " Check the credentials in .env; if they're right, the account may" +
          " require a second factor or a consent step that needs handling.",
      );
    }

    await this.assertNotDeviceLimited(page);
    await this.goto(page, this.agent.lystos.searchUrl);
    await this.assertNotDeviceLimited(page);
    logger.info({ agent: this.agent.id, url: page.url() }, "signed in; the profile will remember this");
  }

  /** Lystos allows only so many signed-in devices. Hitting that wall is not
   *  something to retry through: every attempt consumes another slot. */
  private async assertNotDeviceLimited(page: Page): Promise<void> {
    const body = (await page.textContent("body").catch(() => "")) ?? "";
    const hay = body.toLowerCase();
    if (!LYSTOS.deviceLimit.textPatterns.some((p) => hay.includes(p))) return;

    await this.dumpFailure(page, "device-limit");
    throw new Error(
      "Lystos says the account has too many active devices.\n" +
        "  This is a session limit, not a ban or a block.\n" +
        "  Fix: open Lystos in a normal browser, click 'Cerrar todas las sesiones',\n" +
        "  sign in once, then run `npm run login` here.\n" +
        "  Better still, set CHROME_CDP_URL to drive the Chrome you already use —\n" +
        "  that consumes no slot at all.\n" +
        "  (Deliberately not clicking that button automatically — it would sign the\n" +
        "  agent out of her own phone and laptop.)",
    );
  }

  /** Kept for callers that want an explicit checkpoint. The persistent
   *  profile already stores cookies on disk, so this is belt and braces. */
  async saveState(page: Page): Promise<void> {
    if (this.attached) return; // never write to someone else's browser
    await page
      .context()
      .storageState({ path: join(env.dataDir, "state", `${this.agent.id}.json`) })
      .catch(() => {});
  }

  /** Save a screenshot + HTML when sign-in goes wrong; guessing from a stack
   *  trace is miserable, and one look at the page usually explains it. */
  private async dumpFailure(page: Page, label: string): Promise<void> {
    const dir = join(env.dataDir, "capture", this.agent.id);
    try {
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${label}.png`), fullPage: true });
      writeFileSync(join(dir, `${label}.html`), await page.content());
      logger.error({ dir, label }, "saved a screenshot of the failure");
    } catch {
      // A screenshot is a nice-to-have; never let it mask the real error.
    }
  }

  async close(): Promise<void> {
    if (this.attached) {
      // It's the user's browser: leave it exactly as we found it.
      await this.browser?.close().catch(() => {}); // detaches, doesn't quit Chrome
    } else {
      await this.context?.close().catch(() => {});
      await this.browser?.close().catch(() => {});
    }
    this.browser = null;
    this.context = null;
    this.page_ = null;
  }
}
