import { describe, expect, it, vi } from "vitest";
import { processListings } from "../src/pipeline.js";
import { processAgentQueue } from "../src/sender/worker.js";
import { isQuietHours, backoffMinutes } from "../src/sender/schedule.js";
import { testDb, testAgent, testWaAgent, listing } from "./helpers.js";

// 12:00 UTC = 14:00 Europe/Madrid in summer — outside test quiet hours.
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

function seeded(agent = testAgent()) {
  const db = testDb();
  processListings(db, agent, "lystos", [listing()]);
  return { db, agent };
}

describe("processAgentQueue — draft mode", () => {
  it("creates a draft and marks it 'drafted'", async () => {
    const { db, agent } = seeded();
    const deliver = vi.fn().mockResolvedValue({ ok: true, providerRef: "42" });
    expect(await processAgentQueue(db, agent, { now: midday, dryRun: false, deliver })).toBe("drafted");

    const [, msg] = deliver.mock.calls[0]!;
    expect(msg.to).toBe("anna@example.com");
    expect(msg.subject).toContain("Gràcia");
    expect(msg.body).toContain("Hola Anna");

    const row = db.prepare("SELECT status, provider_ref FROM messages").get() as any;
    expect(row).toEqual({ status: "drafted", provider_ref: "42" });
  });

  it("drafts outside quiet hours too — nobody is contacted by a draft", async () => {
    const { db, agent } = seeded();
    const deliver = vi.fn().mockResolvedValue({ ok: true });
    expect(await processAgentQueue(db, agent, { now: night, dryRun: false, deliver })).toBe("drafted");
  });

  it("still respects the daily cap", async () => {
    const { db, agent } = seeded(); // cap is 3
    db.prepare(
      `INSERT INTO messages (agent_id, listing_id, channel, contact_key, template_name, language, variables, preview, status, sent_at)
       VALUES ('test','x','email','a@x.com','t','es','[]','p','drafted', datetime('now')),
              ('test','y','email','b@x.com','t','es','[]','p','drafted', datetime('now')),
              ('test','z','email','c@x.com','t','es','[]','p','drafted', datetime('now'))`,
    ).run();
    expect(await processAgentQueue(db, agent, { now: midday, dryRun: true })).toBe("daily_cap");
  });
});

describe("processAgentQueue — send mode", () => {
  const sendModeAgent = () =>
    testAgent({ email: { ...testAgent().email!, mode: "send" as const } });

  it("marks messages 'sent' and enforces quiet hours", async () => {
    const { db, agent } = seeded(sendModeAgent());
    const deliver = vi.fn().mockResolvedValue({ ok: true, providerRef: "<id@x>" });
    expect(await processAgentQueue(db, agent, { now: night, dryRun: false, deliver })).toBe("quiet_hours");
    expect(deliver).not.toHaveBeenCalled();

    expect(await processAgentQueue(db, agent, { now: midday, dryRun: false, deliver })).toBe("sent");
    expect((db.prepare("SELECT status FROM messages").get() as any).status).toBe("sent");
  });
});

describe("processAgentQueue — common behaviour", () => {
  it("dry-run records without calling the adapter", async () => {
    const { db, agent } = seeded();
    const deliver = vi.fn();
    expect(await processAgentQueue(db, agent, { now: midday, dryRun: true, deliver })).toBe("dry_run");
    expect(deliver).not.toHaveBeenCalled();
    expect((db.prepare("SELECT status FROM messages").get() as any).status).toBe("dry_run");
  });

  it("retries retryable failures, then fails permanently", async () => {
    const { db, agent } = seeded();
    const deliver = vi.fn().mockResolvedValue({ ok: false, retryable: true, error: "imap: timeout" });
    await processAgentQueue(db, agent, { now: midday, dryRun: false, deliver });
    expect(db.prepare("SELECT status, attempts FROM messages").get()).toEqual({ status: "pending", attempts: 1 });

    db.prepare("UPDATE messages SET next_attempt_at = datetime('now')").run();
    deliver.mockResolvedValue({ ok: false, retryable: false, error: "smtp: 550 no such user" });
    await processAgentQueue(db, agent, { now: midday, dryRun: false, deliver });
    expect(db.prepare("SELECT status, attempts FROM messages").get()).toEqual({ status: "failed", attempts: 2 });
  });

  it("skips opted-out contacts", async () => {
    const { db, agent } = seeded();
    db.prepare("UPDATE contacts SET opted_out = 1").run();
    expect(await processAgentQueue(db, agent, { now: midday, dryRun: true })).toBe("idle");
  });

  it("paces real sends on the whatsapp channel", async () => {
    const { db, agent } = seeded(testWaAgent());
    db.prepare(
      `INSERT INTO messages (agent_id, listing_id, channel, contact_key, template_name, language, variables, preview, status, sent_at)
       VALUES ('test','w','whatsapp','+34600000009','t','es','[]','p','sent', datetime('now'))`,
    ).run();
    expect(await processAgentQueue(db, agent, { now: new Date(), dryRun: false })).toBe("pacing");
  });
});
