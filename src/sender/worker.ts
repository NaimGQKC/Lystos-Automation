import type { DB } from "../db/index.js";
import { logEvent } from "../db/index.js";
import type { AgentConfig } from "../config/agent.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { sendTemplate } from "./whatsapp.js";
import { deliverEmail } from "./email.js";
import { isQuietHours, backoffMinutes } from "./schedule.js";
import type { OutboundMessage, SendResult } from "./types.js";

const MAX_ATTEMPTS = 5;

type PendingRow = {
  id: number;
  agent_id: string;
  listing_id: string;
  channel: string;
  contact_key: string;
  template_name: string;
  language: string;
  subject: string | null;
  variables: string;
  preview: string;
  attempts: number;
};

export type Deliver = (agent: AgentConfig, msg: OutboundMessage) => Promise<SendResult>;

/** Route to the agent's channel adapter. */
const defaultDeliver: Deliver = (agent, msg) =>
  agent.channel === "email"
    ? deliverEmail(agent, { to: msg.to, subject: msg.subject ?? "", body: msg.body })
    : sendTemplate(agent, {
        to: msg.to, templateName: msg.templateName, language: msg.language, variables: msg.variables,
      });

export type WorkerOutcome =
  | "sent" | "drafted" | "dry_run" | "idle" | "quiet_hours" | "daily_cap" | "pacing" | "failed";

/** One worker pass for one agent. Handles AT MOST ONE message per call — the
 *  caller's tick interval plus minSecondsBetweenSends provides human-like
 *  pacing. */
export async function processAgentQueue(
  db: DB,
  agent: AgentConfig,
  opts: { dryRun?: boolean; now?: Date; deliver?: Deliver } = {},
): Promise<WorkerOutcome> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? env.dryRun;
  const deliver = opts.deliver ?? defaultDeliver;
  const s = agent.sending;
  // Drafting is not an outbound send: no owner is contacted, so quiet hours
  // and pacing don't apply — only the daily cap, to keep review batches sane.
  const drafting = agent.channel === "email" && agent.email!.mode === "draft";

  if (!drafting && isQuietHours(s.quietHours, agent.timezone, now)) return "quiet_hours";

  const doneToday = (
    db.prepare(
      `SELECT COUNT(*) AS n FROM messages
       WHERE agent_id = ? AND status IN ('sent','drafted','delivered','read')
         AND date(sent_at) = date('now')`,
    ).get(agent.id) as { n: number }
  ).n;
  if (doneToday >= s.dailyCap) return "daily_cap";

  if (!drafting) {
    const last = db.prepare(
      `SELECT MAX(sent_at) AS t FROM messages WHERE agent_id = ? AND sent_at IS NOT NULL`,
    ).get(agent.id) as { t: string | null };
    if (last.t) {
      const elapsed = (now.getTime() - Date.parse(last.t + "Z")) / 1000;
      if (elapsed < s.minSecondsBetweenSends) return "pacing";
    }
  }

  const row = db.prepare(
    `SELECT m.* FROM messages m
     JOIN contacts c ON c.contact_key = m.contact_key
     WHERE m.agent_id = ? AND m.status = 'pending'
       AND m.next_attempt_at <= datetime('now') AND c.opted_out = 0
     ORDER BY m.created_at LIMIT 1`,
  ).get(agent.id) as PendingRow | undefined;
  if (!row) return "idle";

  if (dryRun) {
    db.prepare("UPDATE messages SET status = 'dry_run', sent_at = datetime('now') WHERE id = ?").run(row.id);
    logEvent(db, "message_dry_run", agent.id, {
      messageId: row.id, contact: row.contact_key, subject: row.subject, preview: row.preview,
    });
    logger.info({ to: row.contact_key, subject: row.subject }, "[DRY RUN] would deliver");
    return "dry_run";
  }

  const result = await deliver(agent, {
    to: row.contact_key,
    templateName: row.template_name,
    language: row.language,
    subject: row.subject ?? undefined,
    variables: JSON.parse(row.variables) as string[],
    body: row.preview,
  });

  if (result.ok) {
    const status = drafting ? "drafted" : "sent";
    db.prepare(
      "UPDATE messages SET status = ?, provider_ref = ?, sent_at = datetime('now'), attempts = attempts + 1 WHERE id = ?",
    ).run(status, result.providerRef ?? null, row.id);
    logEvent(db, `message_${status}`, agent.id, {
      messageId: row.id, contact: row.contact_key, providerRef: result.providerRef,
    });
    logger.info({ to: row.contact_key, status }, drafting ? "draft created for review" : "message sent");
    return drafting ? "drafted" : "sent";
  }

  const attempts = row.attempts + 1;
  const permanent = !result.retryable || attempts >= MAX_ATTEMPTS;
  db.prepare(
    `UPDATE messages
     SET attempts = ?, error = ?,
         status = CASE WHEN ? THEN 'failed' ELSE 'pending' END,
         next_attempt_at = datetime('now', '+' || ? || ' minutes')
     WHERE id = ?`,
  ).run(attempts, result.error ?? "unknown", permanent ? 1 : 0, backoffMinutes(attempts), row.id);
  logEvent(db, permanent ? "message_failed" : "message_retry", agent.id, {
    messageId: row.id, contact: row.contact_key, attempts, error: result.error,
  });
  logger.warn({ to: row.contact_key, attempts, permanent, error: result.error }, "delivery failed");
  return "failed";
}
