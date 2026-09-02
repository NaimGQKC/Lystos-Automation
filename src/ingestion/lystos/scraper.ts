import type { AgentConfig } from "../../config/agent.js";
import type { IngestionSource, RawListing } from "../types.js";
import { logger } from "../../logger.js";
import { env } from "../../env.js";
import { LystosSession, jitter } from "./session.js";
import { LYSTOS } from "./selectors.js";
import { parseListingsPayload } from "./parsers.js";

/** Ingestion source that drives the agent's own Lystos account.
 *
 *  Instead of scraping the DOM, it loads the agent's saved-search URL and
 *  intercepts the JSON responses the Lystos SPA fetches for its own UI —
 *  far more robust than CSS selectors, and it survives visual redesigns. */
export class LystosScraper implements IngestionSource {
  readonly name = "lystos";

  constructor(private readonly agent: AgentConfig) {}

  async fetchNewListings(): Promise<RawListing[]> {
    const session = new LystosSession(this.agent);
    const byId = new Map<string, RawListing>();
    try {
      const page = await session.page();

      page.on("response", (response) => {
        const url = response.url();
        if (!LYSTOS.listingApiPatterns.some((p) => url.toLowerCase().includes(p))) return;
        response
          .json()
          .then((json) => {
            const listings = parseListingsPayload(url, json);
            if (!listings) return;
            for (const l of listings) byId.set(l.sourceId, l);
            logger.debug({ url, count: listings.length }, "parsed listing payload");
          })
          .catch(() => {}); // non-JSON or already-consumed body
      });

      // (Re)load the saved search so the SPA fires its data requests, then give
      // lazy/paginated requests time to land. Unhurried on purpose.
      await session.goto(page, this.agent.lystos.searchUrl);
      // A slow scroll both triggers lazy loading and reads like a person.
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 900);
        await jitter(1_800);
      }
      await jitter(env.settleMs);

      if (byId.size === 0) {
        logger.warn(
          { agent: this.agent.id },
          "no listing payloads intercepted — listingApiPatterns/parsers need calibration " +
            `(run: npm run capture -- ${this.agent.id})`,
        );
      }
      return [...byId.values()];
    } finally {
      await session.close();
    }
  }
}
