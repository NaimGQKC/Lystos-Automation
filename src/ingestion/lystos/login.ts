import { chromium } from "playwright";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "../../config/agent.js";
import { env } from "../../env.js";
import { logger } from "../../logger.js";
import { isAuthPage } from "./selectors.js";

/** One-time, human-supervised sign-in.
 *
 *  Lystos caps concurrent devices and every sign-in burns a slot, so the tool
 *  should sign in ONCE and reuse that session forever after. This opens a
 *  real browser window, lets a human log in (handling any 2FA or
 *  device prompt themselves), then saves the session to disk.
 *
 *  Run: npm run login
 */
export async function login(agent: AgentConfig): Promise<void> {
  const statePath = join(env.dataDir, "state", `${agent.id}.json`);
  mkdirSync(join(env.dataDir, "state"), { recursive: true });

  // A stale session is worse than none: it can leave the app half-signed-in.
  if (existsSync(statePath)) {
    rmSync(statePath);
    logger.info({ statePath }, "removed the previous saved session");
  }

  const browser = await chromium.launch({
    headless: false, // always visible: a human is driving this
    executablePath: env.chromiumPath,
    proxy: env.proxyServer ? { server: env.proxyServer } : undefined,
    slowMo: env.slowMo,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    locale: env.locale,
    timezoneId: env.timezoneId,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log(
    [
      "",
      "=".repeat(70),
      "  A BROWSER WINDOW IS OPEN. SIGN IN TO LYSTOS THERE, BY HAND.",
      "",
      "  Do it exactly as you normally would — including any 'close all",
      "  sessions' prompt or 2FA. This uses ONE device slot, once.",
      "",
      "  As soon as you reach the app, the session is saved here and every",
      "  later run reuses it instead of signing in again.",
      "",
      "  Waiting up to 5 minutes…",
      "=".repeat(70),
      "",
    ].join("\n"),
  );

  await page.goto(agent.lystos.searchUrl, { waitUntil: "domcontentloaded" }).catch(() => {});

  const deadline = Date.now() + 5 * 60_000;
  let landed = false;
  while (Date.now() < deadline && !page.isClosed()) {
    if (!isAuthPage(page.url())) {
      // Give the SPA a moment to settle before deciding we're really in.
      await page.waitForTimeout(2_500).catch(() => {});
      if (!page.isClosed() && !isAuthPage(page.url())) {
        landed = true;
        break;
      }
    }
    await page.waitForTimeout(1_500).catch(() => {});
  }

  if (!landed) {
    await browser.close();
    throw new Error(
      "Didn't reach the app before timing out — nothing was saved. " +
        "Run `npm run login` again and complete the sign-in in the window.",
    );
  }

  await context.storageState({ path: statePath });
  console.log(`\nSession saved to ${statePath}. You can close the window.\n`);
  logger.info({ agent: agent.id }, "session saved — later runs will reuse it");
  await browser.close();
}
