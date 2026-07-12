import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "../../config/agent.js";
import { env, requireEnv } from "../../env.js";
import { logger } from "../../logger.js";
import { LYSTOS } from "./selectors.js";

/** Manages an authenticated browser session against app.lystos.com.
 *  Login state (cookies/localStorage) is persisted per agent so we log in
 *  rarely — repeated logins are both slow and a bot-detection signal. */
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
      });
    }
    if (!this.context) {
      mkdirSync(join(env.dataDir, "state"), { recursive: true });
      this.context = await this.browser.newContext(
        existsSync(this.statePath) ? { storageState: this.statePath } : {},
      );
    }
    const page = await this.context.newPage();
    await this.ensureLoggedIn(page);
    return page;
  }

  private async ensureLoggedIn(page: Page): Promise<void> {
    await page.goto(this.agent.lystos.searchUrl, { waitUntil: "domcontentloaded" });
    const probe = page.locator(LYSTOS.loggedInProbe).first();
    if (await probe.isVisible({ timeout: 5_000 }).catch(() => false)) return;

    logger.info({ agent: this.agent.id }, "no valid session, logging in to Lystos");
    const prefix = this.agent.lystos.credentialsEnvPrefix;
    await page.goto(LYSTOS.loginUrl, { waitUntil: "domcontentloaded" });
    await page.fill(LYSTOS.login.email, requireEnv(`${prefix}_EMAIL`));
    await page.fill(LYSTOS.login.password, requireEnv(`${prefix}_PASSWORD`));
    await page.click(LYSTOS.login.submit);
    await page.waitForLoadState("networkidle");

    await page.goto(this.agent.lystos.searchUrl, { waitUntil: "domcontentloaded" });
    if (!(await probe.isVisible({ timeout: 10_000 }).catch(() => false))) {
      throw new Error(
        `Lystos login for agent "${this.agent.id}" did not reach an authenticated page. ` +
          `Selectors likely need calibration — run: npm run capture -- ${this.agent.id}`,
      );
    }
    await page.context().storageState({ path: this.statePath });
    logger.info({ agent: this.agent.id }, "session saved");
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.context = null;
    this.browser = null;
  }
}
