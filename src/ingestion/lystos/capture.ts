import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "../../config/agent.js";
import { env } from "../../env.js";
import { logger } from "../../logger.js";
import { LystosSession } from "./session.js";

/** Calibration helper: logs into the agent's Lystos account, opens the saved
 *  search, and records EVERY JSON network response plus a DOM snapshot and
 *  screenshot to data/capture/<agent>/. Inspect the output to fill in
 *  selectors.ts (login/probe selectors, listingApiPatterns) and verify
 *  parsers.ts field names — then the scraper is production-ready. */
export async function capture(agent: AgentConfig): Promise<void> {
  const dir = join(env.dataDir, "capture", agent.id);
  mkdirSync(dir, { recursive: true });
  const session = new LystosSession(agent, { headless: process.env.HEADFUL !== "1" ? true : false });
  const index: { file: string; url: string; status: number }[] = [];

  try {
    const page = await session.page();
    let n = 0;
    page.on("response", (response) => {
      const ct = response.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;
      const file = `${String(++n).padStart(3, "0")}.json`;
      response
        .json()
        .then((json) => {
          writeFileSync(join(dir, file), JSON.stringify({ url: response.url(), json }, null, 2));
          index.push({ file, url: response.url(), status: response.status() });
        })
        .catch(() => {});
    });

    await page.goto(agent.lystos.searchUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(5_000);
    // Scroll to trigger lazy loading / pagination requests.
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 2_000);
      await page.waitForTimeout(1_500);
    }

    writeFileSync(join(dir, "page.html"), await page.content());
    await page.screenshot({ path: join(dir, "page.png"), fullPage: true });
    writeFileSync(join(dir, "_index.json"), JSON.stringify(index, null, 2));

    logger.info({ dir, responses: index.length }, "capture complete");
    for (const e of index) logger.info(`  ${e.file}  ${e.status}  ${e.url}`);
    logger.info(
      "Next: find the response(s) carrying the listing feed, add a distinctive URL " +
        "substring to LYSTOS.listingApiPatterns in selectors.ts, and check that " +
        "parsers.ts extracts id/price/zone/ownerPhone from that shape.",
    );
  } finally {
    await session.close();
  }
}
