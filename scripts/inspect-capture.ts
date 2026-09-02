/** Summarises what a capture actually contains, so the parser can be
 *  calibrated without anyone pasting megabytes of JSON around.
 *
 *  For every captured response it finds arrays of objects, reports where they
 *  live and how big they are, lists their field names, and prints ONE example
 *  record with emails/phones/names masked.
 *
 *  Run: npm run inspect
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../src/env.js";

const agentId = process.argv[2] ?? "default";
const dir = join(env.dataDir, "capture", agentId);

/** Mask anything that looks personal — we only need shapes, not real data. */
function redact(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (/@/.test(value) && /\.[a-z]{2,}/i.test(value)) return "<email>";
    if (/^[+\d][\d\s().-]{7,}$/.test(value)) return "<phone>";
    if (/name|nombre|contact|owner|propietario/i.test(key)) return "<name>";
    return value.length > 120 ? value.slice(0, 120) + "…" : value;
  }
  if (Array.isArray(value)) return value.slice(0, 2).map((v) => redact(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

/** Walk the payload, reporting every array-of-objects we can find. */
function findArrays(node: unknown, path: string, hits: { path: string; items: unknown[] }[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    if (node.length && node.every((x) => x && typeof x === "object")) {
      hits.push({ path: path || "(root)", items: node });
    }
    return;
  }
  for (const [k, v] of Object.entries(node)) findArrays(v, path ? `${path}.${k}` : k, hits);
}

function main() {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f));
  } catch {
    console.error(`No capture found at ${dir}. Run:  npm run capture`);
    process.exit(1);
  }

  // Largest payloads first — the listing feed is nearly always the biggest.
  const entries = files
    .map((f) => ({ f, raw: readFileSync(join(dir, f), "utf8") }))
    .sort((a, b) => b.raw.length - a.raw.length)
    .slice(0, 6);

  for (const { f, raw } of entries) {
    const rec = JSON.parse(raw) as {
      url: string; method?: string; requestBody?: unknown; body: unknown;
    };
    const hits: { path: string; items: unknown[] }[] = [];
    findArrays(rec.body, "", hits);
    if (!hits.length) continue;

    const biggest = hits.sort((a, b) => b.items.length - a.items.length)[0]!;
    console.log("\n" + "=".repeat(72));
    console.log(`${f}   ${rec.method ?? "GET"} ${rec.url}`);
    console.log(`records: ${biggest.items.length} at body.${biggest.path}`);
    console.log("=".repeat(72));

    const sample = biggest.items[0] as Record<string, unknown>;
    console.log("\nFIELDS: " + Object.keys(sample).join(", "));
    console.log("\nONE RECORD (personal data masked):");
    console.log(JSON.stringify(redact(sample), null, 2).slice(0, 4_000));

    if (rec.requestBody && typeof rec.requestBody === "object") {
      console.log("\nREQUEST PAYLOAD (the filters the app sent):");
      console.log(JSON.stringify(rec.requestBody, null, 2).slice(0, 2_000));
    }
  }
  console.log("\nSend the above over — that's everything needed to finish the parser.\n");
}

main();
