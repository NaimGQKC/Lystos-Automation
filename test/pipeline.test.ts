import { describe, expect, it } from "vitest";
import { processListings } from "../src/pipeline.js";
import { testDb, testAgent, testWaAgent, listing } from "./helpers.js";

describe("pipeline", () => {
  it("queues one email message for a matching listing", () => {
    const db = testDb();
    const stats = processListings(db, testAgent(), "lystos", [listing()]);
    expect(stats).toMatchObject({ seen: 1, new: 1, queued: 1, withEmail: 1, withPhone: 1 });
    const msg = db.prepare("SELECT * FROM messages").get() as any;
    expect(msg.contact_key).toBe("anna@example.com");
    expect(msg.channel).toBe("email");
    expect(msg.subject).toContain("Gràcia");
    expect(msg.status).toBe("pending");
  });

  it("uses the phone as contact key on the whatsapp channel", () => {
    const db = testDb();
    processListings(db, testWaAgent(), "lystos", [listing()]);
    const msg = db.prepare("SELECT * FROM messages").get() as any;
    expect(msg.contact_key).toBe("+34612345678");
    expect(msg.channel).toBe("whatsapp");
  });

  it("parks a listing with no email but a phone for a human to handle", () => {
    const db = testDb();
    const stats = processListings(db, testAgent(), "lystos", [listing({ ownerEmail: undefined })]);
    expect(stats.queued).toBe(0);
    expect(stats.needsReview).toBe(1);
    const row = db.prepare("SELECT status, skip_reason, owner_phone FROM listings").get() as any;
    expect(row).toMatchObject({ status: "needs_review", skip_reason: "no_owner_email" });
    expect(row.owner_phone).toBe("612 345 678"); // she can still call them
  });

  it("skips outright when there is no way to reach the owner at all", () => {
    const db = testDb();
    const stats = processListings(db, testAgent(), "lystos", [
      listing({ ownerEmail: undefined, ownerPhone: undefined }),
    ]);
    expect(stats.needsReview).toBe(0);
    expect(stats.skipped).toMatchObject({ no_owner_email: 1 });
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

  it("never messages the same contact twice, across listings and agents", () => {
    const db = testDb();
    processListings(db, testAgent(), "lystos", [listing()]);
    const relisted = processListings(db, testAgent(), "lystos", [listing({ sourceId: "lystos:2" })]);
    const other = processListings(db, testAgent({ id: "other" }), "lystos", [listing({ sourceId: "lystos:3" })]);
    expect(relisted.skipped).toMatchObject({ already_contacted: 1 });
    expect(other.skipped).toMatchObject({ already_contacted: 1 });
    expect((db.prepare("SELECT COUNT(*) n FROM messages").get() as any).n).toBe(1);
  });

  it("skips opted-out contacts", () => {
    const db = testDb();
    db.prepare(
      "INSERT INTO contacts (contact_key, contact_type, opted_out, opted_out_at) VALUES ('anna@example.com','email',1,datetime('now'))",
    ).run();
    const stats = processListings(db, testAgent(), "lystos", [listing()]);
    expect(stats.skipped).toMatchObject({ opted_out: 1 });
    expect((db.prepare("SELECT COUNT(*) n FROM messages").get() as any).n).toBe(0);
  });

  it("records skip reasons for non-matching listings", () => {
    const db = testDb();
    const stats = processListings(db, testAgent(), "lystos", [
      listing({ sourceId: "l1", isPrivateOwner: false }),
      listing({ sourceId: "l2", ownerEmail: "nonsense", ownerPhone: undefined }),
      listing({ sourceId: "l3", price: 999_999_999 }),
    ]);
    expect(stats.queued).toBe(0);
    expect(stats.skipped).toMatchObject({
      not_private_owner: 1,
      no_owner_email: 1,
      above_price_max: 1,
    });
  });
});
