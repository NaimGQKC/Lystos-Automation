import { describe, expect, it } from "vitest";
import { buildServer, isOptOut } from "../src/server.js";
import { processListings } from "../src/pipeline.js";
import { testDb, testAgent, listing } from "./helpers.js";

describe("opt-out detection", () => {
  it("catches explicit unsubscribe intents only", () => {
    expect(isOptOut("BAJA")).toBe(true);
    expect(isOptOut("stop por favor")).toBe(true);
    expect(isOptOut("No me contactes más")).toBe(true);
    expect(isOptOut("No, ya está vendido")).toBe(false);
    expect(isOptOut("¿cuánto me darías?")).toBe(false);
  });
});

describe("whatsapp webhook", () => {
  it("updates delivery status by wa_message_id", async () => {
    const db = testDb();
    const agent = testAgent();
    processListings(db, agent, "lystos", [listing()]);
    db.prepare("UPDATE messages SET status = 'sent', wa_message_id = 'wamid.1'").run();

    const app = buildServer(db);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      payload: {
        entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered" }] } }] }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect((db.prepare("SELECT status FROM messages").get() as any).status).toBe("delivered");
  });

  it("hard-blocks a contact on opt-out and cancels pending messages", async () => {
    const db = testDb();
    processListings(db, testAgent(), "lystos", [listing()]);

    const app = buildServer(db);
    await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      payload: {
        entry: [{ changes: [{ value: {
          messages: [{ id: "wamid.in1", from: "34612345678", text: { body: "BAJA" } }],
        } }] }],
      },
    });
    const contact = db.prepare("SELECT opted_out FROM contacts").get() as any;
    expect(contact.opted_out).toBe(1);
    expect((db.prepare("SELECT status FROM messages").get() as any).status).toBe("blocked");
  });

  it("ignores webhook redeliveries of the same inbound message", async () => {
    const db = testDb();
    const app = buildServer(db);
    const payload = {
      entry: [{ changes: [{ value: {
        messages: [{ id: "wamid.dup", from: "34612345678", text: { body: "hola" } }],
      } }] }],
    };
    await app.inject({ method: "POST", url: "/webhooks/whatsapp", payload });
    await app.inject({ method: "POST", url: "/webhooks/whatsapp", payload });
    expect((db.prepare("SELECT COUNT(*) n FROM inbound").get() as any).n).toBe(1);
  });
});
