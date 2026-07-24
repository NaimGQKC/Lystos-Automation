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

  const previews = db.prepare(
    `SELECT agent_id, contact_key, subject, preview, status FROM messages
     WHERE status IN ('pending', 'dry_run', 'drafted') ORDER BY created_at DESC LIMIT 10`,
  ).all() as {
    agent_id: string; contact_key: string; subject: string | null; preview: string; status: string;
  }[];
  if (previews.length) {
    lines.push("== Messages awaiting review / would be sent ==");
    for (const r of previews) {
      lines.push(`  ---- [${r.agent_id}] to ${r.contact_key} (${r.status})`);
      if (r.subject) lines.push(`  Asunto: ${r.subject}`);
      for (const line of r.preview.split("\n")) lines.push(`  | ${line}`);
    }
  }

  const replies = db.prepare(
    "SELECT ts, contact_key, body FROM inbound ORDER BY ts DESC LIMIT 20",
  ).all() as { ts: string; contact_key: string; body: string }[];
  if (replies.length) {
    lines.push("== Latest replies ==");
    for (const r of replies) lines.push(`  ${r.ts}  ${r.contact_key}: ${r.body}`);
  }

  return lines.join("\n") || "(empty)";
}
