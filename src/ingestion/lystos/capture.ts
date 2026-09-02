import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "../../config/agent.js";
import { env } from "../../env.js";
import { logger } from "../../logger.js";
import { LystosSession, jitter } from "./session.js";

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
  const index: { file: string; url: string; method: string; status: number; bytes: number }[] = [];

  try {
    const page = await session.page();
    let n = 0;
    page.on("response", (response) => {
      const ct = response.headers()["content-type"] ?? "";
      if (!ct.includes("json")) return;
      const file = `${String(++n).padStart(3, "0")}.json`;
      const request = response.request();
      response
        .text()
        .then((body) => {
          writeFileSync(
            join(dir, file),
            JSON.stringify(
              {
                url: response.url(),
                method: request.method(),
                // The query/filter payload — this is what lets us call the
                // API directly instead of driving the UI.
                requestBody: safeParse(request.postData() ?? ""),
                requestHeaders: redactHeaders(request.headers()),
                status: response.status(),
                body: safeParse(body),
              },
              null,
              2,
            ),
          );
          index.push({
            file, url: response.url(), method: request.method(),
            status: response.status(), bytes: body.length,
          });
        })
        .catch(() => {});
    });

    await session.goto(page, agent.lystos.searchUrl).catch(() => {});

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
        // Closing the window yourself is a normal way to end the session.
        try {
          await page.waitForTimeout(2_000);
        } catch {
          break;
        }
      }
    } else {
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 900);
        await jitter(2_000);
      }
      await jitter(env.settleMs);
    }

    if (!page.isClosed()) {
      writeFileSync(join(dir, "page.html"), await page.content());
      await page.screenshot({ path: join(dir, "page.png"), fullPage: true }).catch(() => {});
    }
    if (!page.isClosed()) await session.saveState(page).catch(() => {});
    writeFileSync(join(dir, "_index.json"), JSON.stringify(index, null, 2));

    logger.info({ dir, responses: index.length }, "capture complete");
    // Biggest payloads first — the listing feed is nearly always among them.
    for (const e of [...index].sort((a, b) => b.bytes - a.bytes).slice(0, 25)) {
      logger.info(`  ${e.file}  ${e.method} ${e.status}  ${(e.bytes / 1024).toFixed(1)}kB  ${e.url}`);
    }
    logger.info(
      "Next: open the largest files above, find the one listing properties, and " +
        "send it over — that's what the parser gets calibrated against.",
    );
  } finally {
    await session.close();
  }
}

/** Keep header shapes (useful for replaying the API) without storing secrets. */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    out[k] = key === "authorization" || key === "cookie" ? `<redacted, ${v.length} chars>` : v;
  }
  return out;
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body.slice(0, 10_000);
  }
}
