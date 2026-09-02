/** Login-page inspector — run this when auto-login can't find its fields.
 *
 *  Opens the Lystos login page and dumps everything needed to fix the
 *  selectors: the final URL after redirects, every input/button on the page,
 *  any iframes (auth is sometimes embedded), plus a screenshot and the raw
 *  HTML. Logs in nothing, submits nothing, needs no credentials.
 *
 *  Run: npm run probe
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../src/env.js";
import { LYSTOS } from "../src/ingestion/lystos/selectors.js";

const OUT = join(env.dataDir, "probe");

async function main() {
  mkdirSync(OUT, { recursive: true });
  const url = process.argv[2] ?? LYSTOS.loginUrl;

  const browser = await chromium.launch({
    headless: process.env.HEADFUL === "1" ? false : true,
    executablePath: env.chromiumPath,
    proxy: env.proxyServer ? { server: env.proxyServer } : undefined,
  });
  const page = await browser.newPage();

  console.log(`\nOpening ${url} …`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(3_000); // let any SPA render

  console.log(`\n=== WHERE WE LANDED ===`);
  console.log(`final url: ${page.url()}`);
  console.log(`title:     ${await page.title()}`);

  const inputs = await page.locator("input").evaluateAll((els) =>
    els.map((e) => {
      const i = e as HTMLInputElement;
      return {
        type: i.type, name: i.name, id: i.id,
        placeholder: i.placeholder,
        ariaLabel: i.getAttribute("aria-label"),
        autocomplete: i.getAttribute("autocomplete"),
        visible: !!(i.offsetWidth || i.offsetHeight),
      };
    }),
  );
  console.log(`\n=== INPUTS (${inputs.length}) ===`);
  for (const i of inputs) console.log("  " + JSON.stringify(i));

  const buttons = await page.locator("button, a[role=button], input[type=submit]").evaluateAll((els) =>
    els.map((e) => ({
      tag: e.tagName.toLowerCase(),
      text: (e.textContent || "").trim().slice(0, 60),
      type: e.getAttribute("type"),
      id: e.id,
      visible: !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight),
    })).filter((b) => b.text || b.type === "submit"),
  );
  console.log(`\n=== BUTTONS (${buttons.length}) ===`);
  for (const b of buttons) console.log("  " + JSON.stringify(b));

  const frames = page.frames().filter((f) => f !== page.mainFrame());
  console.log(`\n=== IFRAMES (${frames.length}) ===`);
  for (const f of frames) console.log(`  ${f.name() || "(unnamed)"} -> ${f.url()}`);

  writeFileSync(join(OUT, "login.html"), await page.content());
  await page.screenshot({ path: join(OUT, "login.png"), fullPage: true });
  console.log(`\nSaved ${join(OUT, "login.png")} and login.html`);
  console.log("Send me everything above plus login.png.\n");

  await browser.close();
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
