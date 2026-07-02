import { describe, expect, it } from "vitest";
import { processListings } from "../src/pipeline.js";
import { testDb, testAgent, listing } from "./helpers.js";

describe("pipeline", () => {
  it("queues exactly one message for a matching listing", () => {
    const db = testDb();
    const stats = processListings(db, testAgent(), "lystos", [listing()]);
    expect(stats).toMatchObject({ seen: 1, new: 1, queued: 1 });
    const msg = db.prepare("SELECT * FROM messages").get() as any;
    expect(msg.phone_e164).toBe("+34612345678");
    expect(msg.status).toBe("pending");
    expect(JSON.parse(msg.variables)).toEqual(["Anna", "Gràcia, Barcelona"]);
  });

  it("is idempotent across repeated ingestion passes", () => {
    const db = testDb();
    const agent = testAgent();
    processListings(db, agent, "lystos", [listing()]);
    const second = processListings(db, agent, "lystos", [listing()]);
    expect(second.new).toBe(0);
    expect(second.queued).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM messages").get() as any).n).toBe(1);
  });

  it("never messages the same phone twice, even across listings and agents", () => {
    const db = testDb();
    processListings(db, testAgent(), "lystos", [listing()]);
    // Same owner relists under a new id, and a second agent also matches it.
    const stats1 = processListings(db, testAgent(), "lystos", [listing({ sourceId: "lystos:2" })]);
    const other = testAgent({ id: "other" });
    const stats2 = processListings(db, other, "lystos", [listing({ sourceId: "lystos:3" })]);
    expect(stats1.skipped).toMatchObject({ already_contacted: 1 });
    expect(stats2.skipped).toMatchObject({ already_contacted: 1 });
    expect((db.prepare("SELECT COUNT(*) n FROM messages").get() as any).n).toBe(1);
  });

  it("skips opted-out contacts and records the reason", () => {
    const db = testDb();
    db.prepare(
      "INSERT INTO contacts (phone_e164, opted_out, opted_out_at) VALUES ('+34612345678', 1, datetime('now'))",
    ).run();
    const stats = processListings(db, testAgent(), "lystos", [listing()]);
    expect(stats.skipped).toMatchObject({ opted_out: 1 });
    expect((db.prepare("SELECT COUNT(*) n FROM messages").get() as any).n).toBe(0);
  });

  it("skips non-matching and phoneless listings with reasons", () => {
    const db = testDb();
    const stats = processListings(db, testAgent(), "lystos", [
      listing({ sourceId: "l1", isPrivateOwner: false }),
      listing({ sourceId: "l2", ownerPhone: undefined }),
      listing({ sourceId: "l3", price: 999_999_999 }),
    ]);
    expect(stats.queued).toBe(0);
    expect(stats.skipped).toMatchObject({
      not_private_owner: 1,
      no_valid_phone: 1,
      above_price_max: 1,
    });
    const rows = db.prepare("SELECT id, skip_reason FROM listings ORDER BY id").all();
    expect(rows).toEqual([
      { id: "l1", skip_reason: "not_private_owner" },
      { id: "l2", skip_reason: "no_valid_phone" },
      { id: "l3", skip_reason: "above_price_max" },
    ]);
  });
});
