import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "../../config/agent.js";
import { env } from "../../env.js";
import { logger } from "../../logger.js";
import { LystosSession } from "./session.js";

/** Seconds the browser stays open in headful mode so a human can click to
 *  the right page while everything is recorded. */
const BROWSE_SECONDS = Number(process.env.BROWSE_SECONDS ?? 120);

/** Calibration helper: logs into the agent's Lystos account and records every
 *  JSON response, plus a DOM snapshot and screenshot, to data/capture/<agent>/.
 *
 *  With HEADFUL=1 the browser stays open for a couple of minutes so you can
 *  navigate to the particulares view yourself — whatever you click is
 *  recorded, so the real feed endpoint is discovered rather than guessed. */
export async function capture(agent: AgentConfig): Promise<void> {
  const dir = join(env.dataDir, "capture", agent.id);
  mkdirSync(dir, { recursive: true });
  const headful = process.env.HEADFUL === "1";
  const session = new LystosSession(agent, { headless: !headful });
  const index: { file: string; url: string; status: number; bytes: number }[] = [];

  try {
    const page = await session.page();
    let n = 0;
    page.on("response", (response) => {
      const ct = response.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;
      const file = `${String(++n).padStart(3, "0")}.json`;
      response
        .text()
        .then((body) => {
          writeFileSync(join(dir, file), JSON.stringify({ url: response.url(), body: safeParse(body) }, null, 2));
          index.push({ file, url: response.url(), status: response.status(), bytes: body.length });
        })
        .catch(() => {});
    });

    await page.goto(agent.lystos.searchUrl, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(4_000);

    if (headful) {
      console.log(
        [
          "",
          "=".repeat(70),
          "  BROWSER IS OPEN AND RECORDING.",
          "",
          "  Click through to the listings you care about — the particulares /",
          "  FSBO view, and open one listing so its contact details load.",
          "  Everything the site fetches is being saved.",
          "",
          `  Closing automatically in ${BROWSE_SECONDS}s.`,
          "=".repeat(70),
          "",
        ].join("\n"),
      );
      const until = Date.now() + BROWSE_SECONDS * 1_000;
      while (Date.now() < until && !page.isClosed()) {
        await page.waitForTimeout(2_000);
      }
    } else {
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 2_000);
        await page.waitForTimeout(1_500);
      }
    }

    if (!page.isClosed()) {
      writeFileSync(join(dir, "page.html"), await page.content());
      await page.screenshot({ path: join(dir, "page.png"), fullPage: true }).catch(() => {});
    }
    writeFileSync(join(dir, "_index.json"), JSON.stringify(index, null, 2));

    logger.info({ dir, responses: index.length }, "capture complete");
    // Biggest payloads first — the listing feed is nearly always among them.
    for (const e of [...index].sort((a, b) => b.bytes - a.bytes).slice(0, 25)) {
      logger.info(`  ${e.file}  ${e.status}  ${(e.bytes / 1024).toFixed(1)}kB  ${e.url}`);
    }
    logger.info(
      "Next: open the largest files above, find the one listing properties, and " +
        "send it over — that's what the parser gets calibrated against.",
    );
  } finally {
    await session.close();
  }
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body.slice(0, 10_000);
  }
}
