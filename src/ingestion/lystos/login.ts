import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
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
  if (env.chromeCdpUrl) {
    console.log(
      "\nCHROME_CDP_URL is set, so this tool uses the Chrome you already have open.\n" +
        "Just sign in to Lystos in that window — there's nothing to do here.\n",
    );
    return;
  }

  // Sign in INTO the persistent profile the scraper uses, so the session
  // survives restarts the way a normal browser's does.
  const profileDir = join(env.dataDir, "profile", agent.id);
  mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false, // always visible: a human is driving this
    executablePath: env.chromiumPath,
    proxy: env.proxyServer ? { server: env.proxyServer } : undefined,
    slowMo: env.slowMo,
    locale: env.locale,
    timezoneId: env.timezoneId,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] ?? (await context.newPage());

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
    await context.close();
    throw new Error(
      "Didn't reach the app before timing out — nothing was saved. " +
        "Run `npm run login` again and complete the sign-in in the window.",
    );
  }

  console.log(`\nSigned in. The profile at ${profileDir} will remember it.\n`);
  logger.info({ agent: agent.id, profileDir }, "signed in — later runs reuse this profile");
  await context.close();
}
