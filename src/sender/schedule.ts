/** Pure scheduling helpers, kept separate from the worker loop for testability. */

/** Minutes since local midnight in the given IANA timezone. */
export function localMinutes(timezone: string, date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid HH:MM time: "${s}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Quiet-hours check that handles ranges crossing midnight (21:00 → 09:30). */
export function isQuietHours(
  quiet: { start: string; end: string },
  timezone: string,
  date = new Date(),
): boolean {
  const now = localMinutes(timezone, date);
  const start = parseHHMM(quiet.start);
  const end = parseHHMM(quiet.end);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** Exponential backoff for failed sends: 2, 4, 8, 16, 32 minutes. */
export function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 60);
}
