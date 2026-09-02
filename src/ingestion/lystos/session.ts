import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
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
 *  Auth is Keycloak (OpenID Connect) at account.lystos.com. Whether we're
 *  logged in is decided by which host we end up on — far more reliable than
 *  probing for some element in the app's UI.
 *
 *  Deliberately unhurried: actions are spaced out, text is typed rather than
 *  pasted, and pages are given time to settle. This is one agent checking her
 *  own account a few times an hour, and it should look like it. */
export class LystosSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(
    private readonly agent: AgentConfig,
    private readonly opts: { headless?: boolean } = {},
  ) {}

  private get statePath(): string {
    return join(env.dataDir, "state", `${this.agent.id}.json`);
  }

  async page(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.opts.headless ?? true,
        executablePath: env.chromiumPath,
        proxy: env.proxyServer ? { server: env.proxyServer } : undefined,
        slowMo: env.slowMo,
        // Chromium advertises itself as automated by default; this is the
        // agent's own account, so present as an ordinary browser.
        args: ["--disable-blink-features=AutomationControlled"],
      });
    }
    if (!this.context) {
      mkdirSync(join(env.dataDir, "state"), { recursive: true });
      this.context = await this.browser.newContext({
        ...(existsSync(this.statePath) ? { storageState: this.statePath } : {}),
        locale: env.locale,
        timezoneId: env.timezoneId,
        viewport: { width: 1440, height: 900 },
      });
    }
    const page = await this.context.newPage();
    await this.ensureLoggedIn(page);
    return page;
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
    // wrongly conclude we're logged in, so give the redirect a chance to fire.
    if (!isAuthPage(page.url())) {
      await page
        .waitForURL((u) => isAuthPage(u.toString()), { timeout: 8_000 })
        .catch(() => {}); // no redirect = the saved session is still good
    }
    if (!isAuthPage(page.url())) return;

    logger.info({ agent: this.agent.id }, "no valid session, logging in to Lystos");
    const prefix = this.agent.lystos.credentialsEnvPrefix;

    await page.waitForSelector(LYSTOS.login.username, { timeout: 30_000 });
    await jitter(1_200); // a person looks at the form before typing

    // Typed, not pasted: instant field population is a classic bot tell.
    await page.type(LYSTOS.login.username, requireEnv(`${prefix}_EMAIL`), { delay: 90 });
    await jitter(600);
    await page.type(LYSTOS.login.password, requireEnv(`${prefix}_PASSWORD`), { delay: 90 });
    await jitter(800);

    // Longer-lived session = fewer logins later.
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
      throw new Error(
        `Lystos login failed for agent "${this.agent.id}" — still on the auth page.` +
          (message ? ` Lystos says: "${message.trim()}"` : "") +
          " Check the credentials in .env; if they're right, the account may" +
          " require a second factor or a consent step that needs handling.",
      );
    }

    // Land on the target page and let the SPA finish booting.
    await this.goto(page, this.agent.lystos.searchUrl);
    await page.context().storageState({ path: this.statePath });
    logger.info({ agent: this.agent.id, url: page.url() }, "logged in; session saved");
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.context = null;
    this.browser = null;
  }
}
