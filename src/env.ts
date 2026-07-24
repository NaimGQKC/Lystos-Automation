import "dotenv/config";

/** Central place for process-level settings. Per-agent secrets are looked up
 *  by the env var names declared in each agent's YAML config. */
export const env = {
  /** When true, messages are rendered and recorded but never sent. */
  dryRun: process.env.DRY_RUN !== "false", // dry-run is the DEFAULT; set DRY_RUN=false to go live
  dbPath: process.env.DB_PATH ?? "data/lystos.db",
  dataDir: process.env.DATA_DIR ?? "data",
  port: Number(process.env.PORT ?? 8080),
  waVerifyToken: process.env.WA_VERIFY_TOKEN ?? "",
  waGraphVersion: process.env.WA_GRAPH_VERSION ?? "v21.0",
  /** Overridable so a mock server can stand in for Meta during rehearsals. */
  waGraphBaseUrl: process.env.WA_GRAPH_BASE_URL ?? "https://graph.facebook.com",
  /** Explicit Chromium binary for playwright (optional; used when the
   *  installed playwright version doesn't match the system browsers). */
  chromiumPath: process.env.CHROMIUM_PATH || undefined,
  /** Optional upstream proxy for the Lystos browser session, e.g. a Spanish
   *  residential/rotating IP. Datacenter IPs get reset by Lystos's CDN.
   *  Format: http://user:pass@host:port */
  proxyServer: process.env.PROXY_SERVER || undefined,
  /** Worker loop tick in seconds (per-agent pacing is enforced on top). */
  workerTickSeconds: Number(process.env.WORKER_TICK_SECONDS ?? 20),
};

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
