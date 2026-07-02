import type { DB } from "./db/index.js";

/** Plain-text operational report: what was found, queued, sent, answered.
 *  In dry-run mode this is how the agent reviews a week of would-be messages
 *  before anything goes live. */
export function report(db: DB): string {
  const lines: string[] = [];

  const listings = db.prepare(
    `SELECT agent_id, status, COALESCE(skip_reason, '') AS reason, COUNT(*) AS n
     FROM listings GROUP BY agent_id, status, reason ORDER BY agent_id, n DESC`,
  ).all() as { agent_id: string; status: string; reason: string; n: number }[];
  lines.push("== Listings ==");
  for (const r of listings) {
    lines.push(`  ${r.agent_id}  ${r.status}${r.reason ? ` (${r.reason})` : ""}: ${r.n}`);
  }

  const messages = db.prepare(
    `SELECT agent_id, status, COUNT(*) AS n FROM messages
     GROUP BY agent_id, status ORDER BY agent_id, n DESC`,
  ).all() as { agent_id: string; status: string; n: number }[];
  lines.push("== Messages ==");
  for (const r of messages) lines.push(`  ${r.agent_id}  ${r.status}: ${r.n}`);

  const pendingPreviews = db.prepare(
    `SELECT agent_id, phone_e164, preview FROM messages
     WHERE status IN ('pending', 'dry_run') ORDER BY created_at DESC LIMIT 20`,
  ).all() as { agent_id: string; phone_e164: string; preview: string }[];
  if (pendingPreviews.length) {
    lines.push("== Latest pending / dry-run previews ==");
    for (const r of pendingPreviews) lines.push(`  [${r.agent_id}] ${r.phone_e164}: ${r.preview}`);
  }

  const replies = db.prepare(
    "SELECT ts, phone_e164, body FROM inbound ORDER BY ts DESC LIMIT 20",
  ).all() as { ts: string; phone_e164: string; body: string }[];
  if (replies.length) {
    lines.push("== Latest replies ==");
    for (const r of replies) lines.push(`  ${r.ts}  ${r.phone_e164}: ${r.body}`);
  }

  return lines.join("\n") || "(empty)";
}
