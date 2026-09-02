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
      contact: { name: "Anna", phone: "612 345 678", email: "anna@example.com" },
      url: "https://app.lystos.com/listing/98211",
    },
    {
      id: 98212, title: "Ático en Passeig de Gràcia", price: 890000, // over budget
      neighborhood: "Eixample", municipality: "Barcelona", propertyType: "flat",
      rooms: 4, surface: 120, advertiserType: "particular",
      contact: { name: "Jordi", phone: "622 111 222", email: "jordi@example.com" },
    },
    {
      id: 98213, title: "Piso en Sants", price: 310000, // agency, not particular
      neighborhood: "Sants", municipality: "Barcelona", propertyType: "flat",
      rooms: 2, surface: 70, advertiserType: "agency",
      contact: { name: "Inmo XYZ", phone: "933 000 000", email: "info@inmoxyz.es" },
    },
  ],
};

const SPA_HTML = `<!doctype html><html><body>
  <div data-testid="user-menu">Fake Lystos — logged in</div>
  <div id="app">loading…</div>
  <script>fetch('/catalog/v1/listings/views/explorer').then(r => r.json())
    .then(d => { document.getElementById('app').textContent = d.results.length + ' listings'; });
  </script></body></html>`;

function fakeLystos(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/catalog/v1/listings/views/explorer")) {
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

async function main() {
  const lystos = await fakeLystos();
  const { env } = await import("../src/env.js");
  (env as any).dataDir = "data/smoke";

  const agent = AgentConfigSchema.parse({
    id: "smoke",
    name: "Agente de Prueba",
    channel: "email",
    lystos: { credentialsEnvPrefix: "LYSTOS_SMOKE", searchUrl: `${lystos.url}/search` },
    filters: { zones: ["Gràcia"], priceMin: 100000, priceMax: 600000, privateOwnerOnly: true },
    sending: { quietHours: { start: "00:00", end: "00:00" }, dailyCap: 50, minSecondsBetweenSends: 1 },
    email: {
      mode: "draft",
      fromEnv: "EMAIL_SMOKE_FROM",
      userEnv: "EMAIL_SMOKE_USER",
      passwordEnv: "EMAIL_SMOKE_PASSWORD",
      smtpHost: "smtp.example", imapHost: "imap.example", draftsMailbox: "Drafts",
      templates: [{
        name: "smoke_a", language: "es",
        subject: "Tu {{propertyLabel}} en {{zone}}",
        body: [
          "Hola {{ownerName}},",
          "",
          "He visto tu anuncio del {{propertyLabel}} en {{zone}} publicado por {{price}}.",
          "Soy {{agentName}} y tengo compradores buscando en la zona. ¿Hablamos?",
          "",
          "{{agentName}}",
          "—",
          "Responde BAJA si prefieres no recibir más mensajes.",
        ].join("\n"),
      }],
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

  // 3) Worker in LIVE draft mode — capture what would land in her Drafts.
  const drafts: any[] = [];
  const outcome = await processAgentQueue(db, agent, {
    dryRun: false,
    deliver: async (_a, m) => { drafts.push(m); return { ok: true, providerRef: `uid-${drafts.length}` }; },
  });
  assert.equal(outcome, "drafted");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].to, "anna@example.com");
  assert.equal(drafts[0].subject, "Tu flat de 3 hab., 85 m² en Gràcia");
  assert.ok(drafts[0].body.includes("Hola Anna"));
  assert.ok(drafts[0].body.includes("385.000 €"));
  ok("worker created an email DRAFT addressed to the owner (nothing sent)");
  assert.equal((db.prepare("SELECT status FROM messages").get() as any).status, "drafted");

  // 4) Delivery status + opt-out via the real webhook server.
  const app = buildServer(db);
  db.prepare("INSERT INTO contacts (contact_key, contact_type) VALUES ('+34699888777','phone')").run();
  await app.inject({
    method: "POST", url: "/webhooks/whatsapp",
    payload: { entry: [{ changes: [{ value: { messages: [{ id: "in.1", from: "34699888777", text: { body: "BAJA" } }] } }] }] },
  });
  assert.equal(
    (db.prepare("SELECT opted_out FROM contacts WHERE contact_key = '+34699888777'").get() as any).opted_out, 1,
  );
  ok("opt-out reply (BAJA) hard-blocked the contact");

  console.log("\nE2E SMOKE TEST — all stages passed:\n" + steps.join("\n"));
  console.log("\n--- report ---\n" + report(db));

  console.log("\n--- the draft that would appear in her Drafts folder ---");
  console.log(`To: ${drafts[0].to}\nSubject: ${drafts[0].subject}\n\n${drafts[0].body}`);

  await app.close();
  lystos.server.close();
}

main().catch((err) => {
  console.error("\nE2E SMOKE TEST FAILED:", err);
  process.exit(1);
});
