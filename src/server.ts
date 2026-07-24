import Fastify from "fastify";
import type { DB } from "./db/index.js";
import { logEvent } from "./db/index.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { normalizePhone } from "./matching/contact.js";

/** Explicit unsubscribe intents only — a reply of "no" alone is a lead
 *  disposition for the agent to judge, not an automated opt-out. */
const OPT_OUT_PATTERNS = [/\bbaja\b/i, /\bstop\b/i, /\bunsubscribe\b/i, /no\s+(me\s+)?contact/i];

export function isOptOut(text: string): boolean {
  return OPT_OUT_PATTERNS.some((re) => re.test(text));
}

/** Webhook server for WhatsApp Cloud API callbacks: delivery statuses keep the
 *  outbox truthful, inbound messages are recorded, and opt-outs hard-block the
 *  contact instantly (GDPR/LSSI requirement, not a nice-to-have). */
export function buildServer(db: DB) {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

  // Meta's subscription verification handshake.
  app.get("/webhooks/whatsapp", async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === env.waVerifyToken && env.waVerifyToken) {
      return reply.send(q["hub.challenge"]);
    }
    return reply.code(403).send("verification failed");
  });

  app.post("/webhooks/whatsapp", async (req, reply) => {
    const body = req.body as {
      entry?: { changes?: { value?: WebhookValue }[] }[];
    };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        handleStatuses(db, value);
        handleInbound(db, value);
      }
    }
    return reply.send({ ok: true });
  });

  return app;
}

interface WebhookValue {
  statuses?: { id: string; status: string; errors?: { title?: string }[] }[];
  messages?: { id: string; from: string; text?: { body?: string }; type?: string }[];
}

function handleStatuses(db: DB, value: WebhookValue): void {
  for (const s of value.statuses ?? []) {
    if (!["delivered", "read", "failed"].includes(s.status)) continue;
    db.prepare(
      `UPDATE messages SET status = ?, error = COALESCE(?, error)
       WHERE provider_ref = ? AND status IN ('sent', 'delivered')`,
    ).run(s.status, s.errors?.[0]?.title ?? null, s.id);
  }
}

function handleInbound(db: DB, value: WebhookValue): void {
  for (const m of value.messages ?? []) {
    const phone = normalizePhone(`+${m.from}`);
    if (!phone) continue;
    const text = m.text?.body ?? "";
    const inserted = db.prepare(
      "INSERT OR IGNORE INTO inbound (contact_key, body, provider_ref) VALUES (?, ?, ?)",
    ).run(phone, text, m.id).changes;
    if (!inserted) continue; // webhook redelivery

    if (isOptOut(text)) {
      db.prepare(
        "UPDATE contacts SET opted_out = 1, opted_out_at = datetime('now') WHERE contact_key = ?",
      ).run(phone);
      db.prepare(
        "UPDATE messages SET status = 'blocked' WHERE contact_key = ? AND status = 'pending'",
      ).run(phone);
      logEvent(db, "opt_out", null, { phone });
      logger.info({ phone }, "contact opted out — blocked");
    } else {
      logEvent(db, "reply_received", null, { phone, text });
      logger.info({ phone, text }, "reply received (visible in report; triage/forwarding is Phase 2)");
    }
  }
}
