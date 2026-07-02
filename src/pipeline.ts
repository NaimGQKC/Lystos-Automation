import type { DB } from "./db/index.js";
import { logEvent } from "./db/index.js";
import type { AgentConfig } from "./config/agent.js";
import type { IngestionSource, RawListing } from "./ingestion/types.js";
import { matchListing } from "./matching/rules.js";
import { normalizePhone } from "./matching/phone.js";
import { render } from "./composer/render.js";
import { logger } from "./logger.js";

export interface IngestStats {
  seen: number;
  new: number;
  queued: number;
  skipped: Record<string, number>;
}

/** One ingestion pass for one agent: pull listings from the source, keep the
 *  new ones, apply the agent's rules, claim the phone in the global contact
 *  ledger, and enqueue exactly one first-touch message per owner.
 *
 *  Safe to run as often as you like: listing PK + ledger PK + the outbox
 *  UNIQUE constraint make the whole pass idempotent. */
export function ingest(db: DB, agent: AgentConfig, source: IngestionSource): Promise<IngestStats> {
  return source.fetchNewListings().then((listings) => processListings(db, agent, source.name, listings));
}

export function processListings(
  db: DB,
  agent: AgentConfig,
  sourceName: string,
  listings: RawListing[],
): IngestStats {
  const stats: IngestStats = { seen: listings.length, new: 0, queued: 0, skipped: {} };
  const skip = (reason: string) => {
    stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;
  };

  const insertListing = db.prepare(`
    INSERT OR IGNORE INTO listings
      (id, agent_id, source, url, title, price, zone, property_type, rooms, sqm,
       owner_name, owner_phone, is_private_owner, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const setStatus = db.prepare("UPDATE listings SET status = ?, skip_reason = ? WHERE id = ?");
  const claimContact = db.prepare(
    "INSERT OR IGNORE INTO contacts (phone_e164, first_listing_id, first_agent_id) VALUES (?, ?, ?)",
  );
  const isOptedOut = db.prepare("SELECT opted_out FROM contacts WHERE phone_e164 = ?");
  const enqueue = db.prepare(`
    INSERT OR IGNORE INTO messages
      (agent_id, listing_id, phone_e164, template_name, language, variables, preview)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const processOne = db.transaction((l: RawListing) => {
    const inserted = insertListing.run(
      l.sourceId, agent.id, sourceName, l.url ?? null, l.title ?? null, l.price ?? null,
      l.zone ?? null, l.propertyType ?? null, l.rooms ?? null, l.sqm ?? null,
      l.ownerName ?? null, l.ownerPhone ?? null,
      l.isPrivateOwner === undefined ? null : Number(l.isPrivateOwner),
      JSON.stringify(l.raw ?? null),
    ).changes;
    if (!inserted) return; // already processed in a previous pass
    stats.new++;

    const match = matchListing(agent, l);
    if (!match.matched) {
      setStatus.run("skipped", match.reason, l.sourceId);
      skip(match.reason);
      return;
    }

    const phone = normalizePhone(l.ownerPhone);
    if (!phone) {
      setStatus.run("skipped", "no_valid_phone", l.sourceId);
      skip("no_valid_phone");
      return;
    }

    // Claim the phone globally. 0 changes = someone already owns this contact
    // (earlier listing, other agent) — never message the same person twice.
    const claimed = claimContact.run(phone, l.sourceId, agent.id).changes;
    if (!claimed) {
      const row = isOptedOut.get(phone) as { opted_out: number } | undefined;
      const reason = row?.opted_out ? "opted_out" : "already_contacted";
      setStatus.run("skipped", reason, l.sourceId);
      skip(reason);
      return;
    }

    const msg = render(agent, l, phone);
    enqueue.run(
      agent.id, l.sourceId, phone, msg.template.metaTemplateName, msg.template.language,
      JSON.stringify(msg.variables), msg.preview,
    );
    setStatus.run("queued", null, l.sourceId);
    logEvent(db, "message_queued", agent.id, {
      listingId: l.sourceId, phone, template: msg.template.name,
    });
    stats.queued++;
  });

  for (const l of listings) {
    try {
      processOne(l);
    } catch (err) {
      skip("error");
      logEvent(db, "ingest_error", agent.id, { listingId: l.sourceId, error: String(err) });
      logger.error({ err, listingId: l.sourceId }, "failed to process listing");
    }
  }

  logEvent(db, "ingest_run", agent.id, stats);
  return stats;
}
