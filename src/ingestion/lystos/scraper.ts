import type { AgentConfig } from "../../config/agent.js";
import type { IngestionSource, RawListing } from "../types.js";
import { logger } from "../../logger.js";
import { env } from "../../env.js";
import { LystosSession, jitter } from "./session.js";
import { LYSTOS } from "./selectors.js";
import { parseListingsPayload } from "./parsers.js";

/** Records per request — the value the Lystos UI itself uses. */
const PAGE_SIZE = 40;
/** Safety stop, so a bad filter can't walk the entire database. */
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 15);

/** A live explorer request, captured so we can replay it for later pages. */
interface FeedRequest {
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
}

/** Ingestion source that drives the agent's own Lystos account.
 *
 *  It loads her explorer view once (so the app performs its own authenticated
 *  request with her saved filters), captures that request, then replays it
 *  page by page. The UI only ever shows the first 40 results; replaying is
 *  how we see the whole feed without clicking through it. */
export class LystosScraper implements IngestionSource {
  readonly name = "lystos";

  constructor(private readonly agent: AgentConfig) {}

  async fetchNewListings(): Promise<RawListing[]> {
    const session = new LystosSession(this.agent);
    const byId = new Map<string, RawListing>();
    let feedRequest: FeedRequest | undefined;

    try {
      const page = await session.page();

      // Capture the app's own request so we can page through it afterwards.
      page.on("request", (request) => {
        const url = request.url();
        if (!url.includes("catalog/v1/listings/views/explorer")) return;
        const raw = request.postData();
        if (!raw) return;
        try {
          feedRequest = {
            url,
            headers: request.headers(),
            payload: JSON.parse(raw) as Record<string, unknown>,
          };
        } catch {
          // Not JSON — nothing to replay.
        }
      });

      page.on("response", (response) => {
        const url = response.url();
        if (!LYSTOS.listingApiPatterns.some((p) => url.toLowerCase().includes(p))) return;
        response
          .json()
          .then((json) => {
            for (const l of parseListingsPayload(url, json) ?? []) byId.set(l.sourceId, l);
          })
          .catch(() => {}); // non-JSON or already-consumed body
      });

      await session.goto(page, this.agent.lystos.searchUrl);
      await jitter(env.settleMs);

      if (feedRequest) {
        await this.paginate(page, feedRequest, byId);
      } else {
        logger.warn(
          { agent: this.agent.id },
          "never saw the explorer request, so only the first page was read — " +
            "check that the search page actually loaded",
        );
      }

      logger.info(
        { agent: this.agent.id, listings: byId.size },
        "finished reading the Lystos feed",
      );
      // Keep the saved session fresh so we don't have to sign in again
      // (each sign-in consumes one of the account's device slots).
      await session.saveState(page).catch(() => {});
      return [...byId.values()];
    } finally {
      await session.close();
    }
  }

  /** Replay the captured request with a rising offset until the feed runs
   *  out. Uses the page's own request context, so it carries her session and
   *  looks like the app's traffic rather than a separate client. */
  private async paginate(
    page: Awaited<ReturnType<LystosSession["page"]>>,
    feed: FeedRequest,
    byId: Map<string, RawListing>,
  ): Promise<void> {
    const limit = Number(feed.payload.limit) || PAGE_SIZE;

    for (let pageIndex = 1; pageIndex < MAX_PAGES; pageIndex++) {
      const offset = pageIndex * limit;
      await jitter(2_500); // pace the requests like a person scrolling

      let batch: RawListing[] = [];
      try {
        const response = await page.request.post(feed.url, {
          headers: feed.headers,
          data: { ...feed.payload, limit, offset },
          timeout: 45_000,
        });
        if (!response.ok()) {
          logger.warn({ offset, status: response.status() }, "feed page request failed; stopping");
          return;
        }
        batch = parseListingsPayload(feed.url, await response.json()) ?? [];
      } catch (err) {
        logger.warn({ err, offset }, "feed page request failed; stopping");
        return;
      }

      const before = byId.size;
      for (const l of batch) byId.set(l.sourceId, l);
      logger.debug(
        { offset, received: batch.length, newListings: byId.size - before },
        "read a page of the feed",
      );

      // A short page means we've reached the end.
      if (batch.length < limit) return;
    }
    logger.warn({ maxPages: MAX_PAGES }, "hit the page limit; raise MAX_PAGES to read further");
  }
}
