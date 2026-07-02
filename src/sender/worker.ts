import type { DB } from "../db/index.js";
import { logEvent } from "../db/index.js";
import type { AgentConfig } from "../config/agent.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { sendTemplate, type SendResult } from "./whatsapp.js";
import { isQuietHours, backoffMinutes } from "./schedule.js";

const MAX_ATTEMPTS = 5;

type PendingRow = {
  id: number;
  agent_id: string;
  listing_id: string;
  phone_e164: string;
  template_name: string;
  language: string;
  variables: string;
  preview: string;
  attempts: number;
};

export type Sender = typeof sendTemplate;

/** One worker pass for one agent. Sends AT MOST ONE message per call — the
 *  caller's tick interval plus minSecondsBetweenSends provides human-like
 *  pacing, which protects the WhatsApp number's quality rating. */
export async function processAgentQueue(
  db: DB,
  agent: AgentConfig,
  opts: { dryRun?: boolean; now?: Date; send?: Sender } = {},
): Promise<"sent" | "dry_run" | "idle" | "quiet_hours" | "daily_cap" | "pacing" | "failed"> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? env.dryRun;
  const send = opts.send ?? sendTemplate;
  const s = agent.whatsapp.sending;

  if (isQuietHours(s.quietHours, agent.timezone, now)) return "quiet_hours";

  const sentToday = (
    db.prepare(
      `SELECT COUNT(*) AS n FROM messages
       WHERE agent_id = ? AND status IN ('sent','delivered','read')
         AND date(sent_at) = date('now')`,
    ).get(agent.id) as { n: number }
  ).n;
  if (sentToday >= s.dailyCap) return "daily_cap";

  const lastSent = db.prepare(
    `SELECT MAX(sent_at) AS t FROM messages WHERE agent_id = ? AND sent_at IS NOT NULL`,
  ).get(agent.id) as { t: string | null };
  if (lastSent.t) {
    const elapsed = (now.getTime() - Date.parse(lastSent.t + "Z")) / 1000;
    if (elapsed < s.minSecondsBetweenSends) return "pacing";
  }

  const row = db.prepare(
    `SELECT m.* FROM messages m
     JOIN contacts c ON c.phone_e164 = m.phone_e164
     WHERE m.agent_id = ? AND m.status = 'pending'
       AND m.next_attempt_at <= datetime('now') AND c.opted_out = 0
     ORDER BY m.created_at LIMIT 1`,
  ).get(agent.id) as PendingRow | undefined;
  if (!row) return "idle";

  if (dryRun) {
    db.prepare("UPDATE messages SET status = 'dry_run', sent_at = datetime('now') WHERE id = ?").run(row.id);
    logEvent(db, "message_dry_run", agent.id, { messageId: row.id, phone: row.phone_e164, preview: row.preview });
    logger.info({ phone: row.phone_e164, preview: row.preview }, "[DRY RUN] would send");
    return "dry_run";
  }

  const result: SendResult = await send(agent, {
    to: row.phone_e164,
    templateName: row.template_name,
    language: row.language,
    variables: JSON.parse(row.variables) as string[],
  });

  if (result.ok) {
    db.prepare(
      "UPDATE messages SET status = 'sent', wa_message_id = ?, sent_at = datetime('now'), attempts = attempts + 1 WHERE id = ?",
    ).run(result.waMessageId ?? null, row.id);
    logEvent(db, "message_sent", agent.id, { messageId: row.id, phone: row.phone_e164, waMessageId: result.waMessageId });
    logger.info({ phone: row.phone_e164, waMessageId: result.waMessageId }, "message sent");
    return "sent";
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
    messageId: row.id, phone: row.phone_e164, attempts, error: result.error,
  });
  logger.warn({ phone: row.phone_e164, attempts, permanent, error: result.error }, "send failed");
  return "failed";
}
