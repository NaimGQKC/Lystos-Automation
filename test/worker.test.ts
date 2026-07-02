import { describe, expect, it, vi } from "vitest";
import { processListings } from "../src/pipeline.js";
import { processAgentQueue } from "../src/sender/worker.js";
import { isQuietHours, backoffMinutes } from "../src/sender/schedule.js";
import { testDb, testAgent, listing } from "./helpers.js";

// 12:00 UTC = 14:00 Europe/Madrid in summer — safely outside test quiet hours.
const midday = new Date("2026-07-02T12:00:00Z");
const night = new Date("2026-07-02T22:00:00Z"); // 00:00 Madrid

describe("schedule helpers", () => {
  it("detects quiet hours across midnight", () => {
    const quiet = { start: "21:00", end: "09:00" };
    expect(isQuietHours(quiet, "Europe/Madrid", night)).toBe(true);
    expect(isQuietHours(quiet, "Europe/Madrid", midday)).toBe(false);
  });

  it("backs off exponentially with a cap", () => {
    expect(backoffMinutes(1)).toBe(2);
    expect(backoffMinutes(3)).toBe(8);
    expect(backoffMinutes(10)).toBe(60);
  });
});

function seeded() {
  const db = testDb();
  const agent = testAgent();
  processListings(db, agent, "lystos", [listing()]);
  return { db, agent };
}

describe("processAgentQueue", () => {
  it("refuses to send during quiet hours", async () => {
    const { db, agent } = seeded();
    expect(await processAgentQueue(db, agent, { now: night, dryRun: true })).toBe("quiet_hours");
  });

  it("dry-run marks the message without calling the sender", async () => {
    const { db, agent } = seeded();
    const send = vi.fn();
    expect(await processAgentQueue(db, agent, { now: midday, dryRun: true, send })).toBe("dry_run");
    expect(send).not.toHaveBeenCalled();
    expect((db.prepare("SELECT status FROM messages").get() as any).status).toBe("dry_run");
  });

  it("sends via the sender and records the wa_message_id", async () => {
    const { db, agent } = seeded();
    const send = vi.fn().mockResolvedValue({ ok: true, waMessageId: "wamid.X" });
    expect(await processAgentQueue(db, agent, { now: midday, dryRun: false, send })).toBe("sent");
    const row = db.prepare("SELECT status, wa_message_id FROM messages").get() as any;
    expect(row).toEqual({ status: "sent", wa_message_id: "wamid.X" });
  });

  it("retries retryable failures with backoff, then fails permanently", async () => {
    const { db, agent } = seeded();
    const send = vi.fn().mockResolvedValue({ ok: false, retryable: true, error: "500: boom" });
    await processAgentQueue(db, agent, { now: midday, dryRun: false, send });
    let row = db.prepare("SELECT status, attempts FROM messages").get() as any;
    expect(row).toEqual({ status: "pending", attempts: 1 });

    // Non-retryable error → permanent failure immediately.
    db.prepare("UPDATE messages SET next_attempt_at = datetime('now')").run();
    send.mockResolvedValue({ ok: false, retryable: false, error: "400: bad template" });
    await processAgentQueue(db, agent, { now: midday, dryRun: false, send });
    row = db.prepare("SELECT status, attempts FROM messages").get() as any;
    expect(row).toEqual({ status: "failed", attempts: 2 });
  });

  it("enforces the daily cap", async () => {
    const { db, agent } = seeded(); // cap is 3 in testAgent
    db.prepare(
      `INSERT INTO messages (agent_id, listing_id, phone_e164, template_name, language, variables, preview, status, sent_at)
       VALUES ('test','x','+34600000001','t','es','[]','p','sent', datetime('now')),
              ('test','y','+34600000002','t','es','[]','p','sent', datetime('now')),
              ('test','z','+34600000003','t','es','[]','p','sent', datetime('now'))`,
    ).run();
    expect(await processAgentQueue(db, agent, { now: midday, dryRun: true })).toBe("daily_cap");
  });

  it("paces sends and skips opted-out contacts", async () => {
    const { db, agent } = seeded();
    db.prepare(
      `INSERT INTO messages (agent_id, listing_id, phone_e164, template_name, language, variables, preview, status, sent_at)
       VALUES ('test','w','+34600000009','t','es','[]','p','sent', datetime('now'))`,
    ).run();
    expect(await processAgentQueue(db, agent, { now: new Date(), dryRun: true })).toBe("pacing");

    db.prepare("DELETE FROM messages WHERE listing_id = 'w'").run();
    db.prepare("UPDATE contacts SET opted_out = 1").run();
    expect(await processAgentQueue(db, agent, { now: midday, dryRun: true })).toBe("idle");
  });
});
