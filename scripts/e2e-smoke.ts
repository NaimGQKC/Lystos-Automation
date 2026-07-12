/** End-to-end live-fire rehearsal, no external services required.
 *
 *  Stands up (1) a fake Lystos: an HTML page that fetches a listing feed the
 *  way the real SPA does, and (2) a fake Meta Graph API that records what it
 *  receives. Then runs the REAL stack against them: Playwright scraper with
 *  network interception → pipeline (match/dedupe/ledger) → outbox worker in
 *  LIVE mode → delivery-status + opt-out webhooks → report.
 *
 *  This proves every component works wired together. The only thing it cannot
 *  prove is the real Lystos markup/payload shape (see README calibration).
 *
 *  Run: npm run smoke
 */
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";
import { AgentConfigSchema } from "../src/config/agent.js";
import { LystosScraper } from "../src/ingestion/lystos/scraper.js";
import { processListings } from "../src/pipeline.js";
import { processAgentQueue } from "../src/sender/worker.js";
import { buildServer } from "../src/server.js";
import { report } from "../src/report.js";

// ---------- fake Lystos: SPA page + listing-feed endpoint ----------
const FEED = {
  results: [
    {
      id: 98211, title: "Piso en Carrer de Verdi", price: 385000,
      neighborhood: "Gràcia", municipality: "Barcelona", propertyType: "flat",
      rooms: 3, surface: 85, advertiserType: "particular",
      contact: { name: "Anna", phone: "612 345 678" },
      url: "https://app.lystos.com/listing/98211",
    },
    {
      id: 98212, title: "Ático en Passeig de Gràcia", price: 890000, // over budget
      neighborhood: "Eixample", municipality: "Barcelona", propertyType: "flat",
      rooms: 4, surface: 120, advertiserType: "particular",
      contact: { name: "Jordi", phone: "622 111 222" },
    },
    {
      id: 98213, title: "Piso en Sants", price: 310000, // agency, not particular
      neighborhood: "Sants", municipality: "Barcelona", propertyType: "flat",
      rooms: 2, surface: 70, advertiserType: "agency",
      contact: { name: "Inmo XYZ", phone: "933 000 000" },
    },
  ],
};

const SPA_HTML = `<!doctype html><html><body>
  <div data-testid="user-menu">Fake Lystos — logged in</div>
  <div id="app">loading…</div>
  <script>fetch('/api/v2/search/listings').then(r => r.json())
    .then(d => { document.getElementById('app').textContent = d.results.length + ' listings'; });
  </script></body></html>`;

function fakeLystos(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/v2/search/listings")) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(FEED));
    } else {
      res.setHeader("content-type", "text/html");
      res.end(SPA_HTML);
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }),
    ),
  );
}

// ---------- fake Meta Graph API ----------
function fakeMeta(received: unknown[]): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ url: req.url, body: JSON.parse(body) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ messages: [{ id: `wamid.smoke.${received.length}` }] }));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }),
    ),
  );
}

async function main() {
  const lystos = await fakeLystos();
  const metaCalls: any[] = [];
  const meta = await fakeMeta(metaCalls);

  process.env.WA_SMOKE_PHONE_ID = "555000111";
  process.env.WA_SMOKE_TOKEN = "smoke-token";
  process.env.WA_GRAPH_BASE_URL = meta.url; // read lazily? no — env.ts already loaded; patch below
  const { env } = await import("../src/env.js");
  (env as any).waGraphBaseUrl = meta.url;
  (env as any).dataDir = "data/smoke";

  const agent = AgentConfigSchema.parse({
    id: "smoke",
    name: "Agente de Prueba",
    lystos: { credentialsEnvPrefix: "LYSTOS_SMOKE", searchUrl: `${lystos.url}/search` },
    filters: { zones: ["Gràcia"], priceMin: 100000, priceMax: 600000, privateOwnerOnly: true },
    whatsapp: {
      phoneNumberIdEnv: "WA_SMOKE_PHONE_ID",
      accessTokenEnv: "WA_SMOKE_TOKEN",
      templates: [{
        name: "smoke_a", metaTemplateName: "captacion_saludo_v1", language: "es",
        variables: ["ownerName", "propertyLabel", "zone", "agentName"],
        preview: "Hola {{ownerName}}, he visto tu {{propertyLabel}} en {{zone}} — {{agentName}}",
      }],
      sending: { quietHours: { start: "00:00", end: "00:00" }, dailyCap: 50, minSecondsBetweenSends: 1 },
    },
  });

  const db = openDb(":memory:");
  const steps: string[] = [];
  const ok = (label: string) => steps.push(`  ✔ ${label}`);

  // 1) REAL Playwright scraper against the fake SPA (network interception).
  const listings = await new LystosScraper(agent).fetchNewListings();
  assert.equal(listings.length, 3, `scraper intercepted ${listings.length}/3 listings`);
  assert.equal(listings[0]?.ownerPhone, "612 345 678");
  ok("browser scraper intercepted the SPA's JSON feed and parsed 3 listings (id, price, zone, owner phone)");

  // 2) Pipeline: match, filter, ledger, enqueue.
  const stats = processListings(db, agent, "lystos", listings);
  assert.equal(stats.queued, 1);
  assert.deepEqual(stats.skipped, { above_price_max: 1, not_private_owner: 1 });
  ok("pipeline queued 1 message (Gràcia particular) and skipped over-budget + agency listings with reasons");

  // 2b) Re-ingest: idempotency.
  const again = processListings(db, agent, "lystos", listings);
  assert.equal(again.new + again.queued, 0);
  ok("second ingestion pass queued nothing (idempotent)");

  // 3) Worker in LIVE mode → fake Meta.
  await new Promise((r) => setTimeout(r, 1100)); // respect 1s pacing
  const outcome = await processAgentQueue(db, agent, { dryRun: false });
  assert.equal(outcome, "sent");
  assert.equal(metaCalls.length, 1);
  const sent = metaCalls[0].body;
  assert.equal(sent.to, "34612345678");
  assert.equal(sent.template.name, "captacion_saludo_v1");
  assert.deepEqual(
    sent.template.components[0].parameters.map((p: any) => p.text),
    ["Anna", "flat de 3 hab., 85 m²", "Gràcia", "Agente de Prueba"],
  );
  ok(`worker sent a real HTTP template message to the (mock) Meta API: to=+34612345678, template=captacion_saludo_v1`);

  // 4) Delivery status + opt-out via the real webhook server.
  const app = buildServer(db);
  await app.inject({
    method: "POST", url: "/webhooks/whatsapp",
    payload: { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.smoke.1", status: "delivered" }] } }] }] },
  });
  assert.equal((db.prepare("SELECT status FROM messages").get() as any).status, "delivered");
  ok("delivery-status webhook marked the message delivered");

  await app.inject({
    method: "POST", url: "/webhooks/whatsapp",
    payload: { entry: [{ changes: [{ value: { messages: [{ id: "wamid.in.1", from: "34612345678", text: { body: "BAJA" } }] } }] }] },
  });
  assert.equal((db.prepare("SELECT opted_out FROM contacts").get() as any).opted_out, 1);
  ok("opt-out reply (BAJA) hard-blocked the contact");

  console.log("\nE2E SMOKE TEST — all stages passed:\n" + steps.join("\n"));
  console.log("\n--- report ---\n" + report(db));

  await app.close();
  lystos.server.close();
  meta.server.close();
}

main().catch((err) => {
  console.error("\nE2E SMOKE TEST FAILED:", err);
  process.exit(1);
});
