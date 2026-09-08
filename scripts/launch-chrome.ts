/** Starts your real Chrome with remote debugging on, using a profile this
 *  tool can attach to.
 *
 *  You do NOT sign into Google/Chrome in this window — it's an ordinary
 *  blank profile. You sign into Lystos once, and it stays signed in.
 *
 *  Why a separate profile at all: since Chrome 136 the browser refuses
 *  remote debugging on your DEFAULT profile (a deliberate anti-cookie-theft
 *  measure). A second profile is the supported way round it.
 *
 *  Run: npm run chrome
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "../src/env.js";

const PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9222);

/** Usual install locations, most likely first. */
function findChrome(): string | undefined {
  if (env.chromiumPath && existsSync(env.chromiumPath)) return env.chromiumPath;

  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

  return candidates.find((p) => p && existsSync(p));
}

function main(): void {
  const chrome = findChrome();
  if (!chrome) {
    console.error(
      "Couldn't find Chrome in the usual places.\n" +
        "Set CHROMIUM_PATH in .env to the full path of chrome.exe and try again.",
    );
    process.exit(1);
  }

  const profileDir = resolve(join(env.dataDir, "chrome-profile"));
  mkdirSync(profileDir, { recursive: true });
  const firstRun = !existsSync(join(profileDir, "Default"));

  const child = spawn(
    chrome,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://app.lystos.com/",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();

  console.log(
    [
      "",
      "=".repeat(70),
      "  CHROME IS STARTING.",
      "",
      firstRun
        ? "  This profile is new, so sign in to LYSTOS in that window.\n" +
          "  You do NOT need a Google/Chrome password — skip any Chrome sign-in\n" +
          "  prompt. Only Lystos matters, and only this once."
        : "  This profile should already be signed in to Lystos.",
      "",
      "  Then add this line to your .env (once):",
      `      CHROME_CDP_URL=http://127.0.0.1:${PORT}`,
      "",
      "  Leave the window open and run:  npm run ingest",
      "=".repeat(70),
      "",
    ].join("\n"),
  );
}

main();
