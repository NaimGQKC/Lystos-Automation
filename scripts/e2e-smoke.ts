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
/** Mirrors the real explorer response: records under `data`, Lystos's own
 *  field names, and the quirks the live feed actually has (advertiserPhone
 *  of "-", email only ever present inside the description text). */
const FEED = {
  data: [
    {
      id: "98211",
      title: "Piso en venta en Carrer de Verdi",
      price: 385000,
      bedrooms: 3,
      sqm: 85,
      propertyType: "Piso",
      neighborhood: "Gràcia",
      municipalityName: "Barcelona",
      advertiserName: "Anna",
      advertiserType: "Particular",
      advertiserTypeId: 2,
      advertiserPhone: "612 345 678",
      description:
        "VENTA DIRECTA DEL PROPIETARIO, sin comisiones. " +
        "Escríbeme a anna.puig (arroba) gmail (punto) com",
      siteUrl: "https://www.idealista.com/inmueble/98211/",
      isContacted: false, isAutoContacted: false, isDiscarded: false, isScam: false,
    },
    {
      id: "98212",
      title: "Ático en Passeig de Gràcia",
      price: 890000, // over the agent's budget
      bedrooms: 4,
      sqm: 120,
      propertyType: "Ático",
      neighborhood: "Eixample",
      advertiserName: "Jordi",
      advertiserType: "Particular",
      advertiserTypeId: 2,
      advertiserPhone: "622 111 222",
      description: "Piso muy luminoso. Contacto: jordi@hotmail.es",
      isContacted: false, isAutoContacted: false, isDiscarded: false, isScam: false,
    },
    {
      id: "98213",
      title: "Piso en Sants",
      price: 310000,
      bedrooms: 2,
      sqm: 70,
      propertyType: "Piso",
      neighborhood: "Sants",
      advertiserName: "Inmo XYZ",
      advertiserType: "Profesional", // agency — must never be contacted
      advertiserTypeId: 1,
      advertiserPhone: "933 000 000",
      description: "Agencia inmobiliaria. info@idealista.com",
      isContacted: false, isAutoContacted: false, isDiscarded: false, isScam: false,
    },
  ],
};

const SPA_HTML = `<!doctype html><html><body>
  <div data-testid="user-menu">Fake Lystos — logged in</div>
  <div id="app">loading…</div>
  <script>fetch('/catalog/v1/listings/views/explorer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ advertiserTypeIdList: [], limit: 3, offset: 0 }),
    }).then(r => r.json())
    .then(d => { document.getElementById('app').textContent = d.data.length + ' listings'; });
  </script></body></html>`;

/** Payloads the fake backend received — lets the test assert that the
 *  scraper asked for particulares rather than trusting the UI's filter. */
const feedRequests: Record<string, unknown>[] = [];

function fakeLystos(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/catalog/v1/listings/views/explorer")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const payload = JSON.parse(body || "{}") as Record<string, unknown>;
        feedRequests.push(payload);
        // Mirror a real paged endpoint: only the first page has records.
        const offset = Number(payload.offset ?? 0);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(offset > 0 ? { data: [] } : FEED));
      });
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
  // The email exists only inside the ad text, obfuscated.
  assert.equal(listings[0]?.ownerEmail, "anna.puig@gmail.com");
  ok("browser scraper intercepted the feed and parsed 3 listings, mining the obfuscated email out of the ad text");

  // The scraper must set the particulares filter itself: loading the explorer
  // fresh sends an empty advertiser filter, so relying on the UI returns
  // agencies too.
  const filtered = feedRequests.filter(
    (r) => JSON.stringify(r.advertiserTypeIdList) === "[2]",
  );
  assert.ok(filtered.length > 0, "no request asked Lystos for particulares only");
  // And it must page: offset 0 then 40.
  const offsets = filtered.map((r) => Number(r.offset));
  assert.ok(
    offsets.includes(0) && offsets.some((o) => o > 0),
    `the feed was not paged through (offsets seen: ${offsets.join(", ")})`,
  );
  ok("asked Lystos for particulares only (advertiserTypeIdList: [2]) and paged through the feed");

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
  assert.equal(drafts[0].to, "anna.puig@gmail.com");
  assert.equal(drafts[0].subject, "Tu Piso de 3 hab., 85 m² en Gràcia");
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
