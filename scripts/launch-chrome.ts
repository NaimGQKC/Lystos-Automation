/** Starts a real Chrome with remote debugging on, for the tool to attach to.
 *
 *  This uses a dedicated profile that persists between runs. You sign in to
 *  Lystos in it ONCE; after that it stays signed in, so no run ever creates a
 *  fresh login — which is what was exhausting the account's device slots.
 *
 *  You do NOT sign into Google/Chrome — skip any Chrome sign-in prompt. Only
 *  the Lystos login matters.
 *
 *  Why a separate profile rather than your everyday one: since Chrome 136 the
 *  browser refuses remote debugging on the default profile (an anti-cookie-
 *  theft measure). A dedicated profile is the supported way round it.
 *
 *  Run: npm run chrome
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "../src/env.js";

const PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9222);

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
  const firstRun = readdirSync(profileDir).length === 0;

  const child = spawn(
    chrome,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://app.lystos.com/explorer/search?premiseType=1",
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
        ? "  First run — sign in to LYSTOS in that window (once).\n" +
          "  No Google/Chrome password needed; skip any Chrome sign-in prompt.\n" +
          "  It stays signed in afterwards, so this is the only sign-in — and\n" +
          "  therefore the only Lystos device slot this tool ever uses."
        : "  This profile is already signed in to Lystos — nothing to do.",
      "",
      "  Add this to your .env (once):",
      `      CHROME_CDP_URL=http://127.0.0.1:${PORT}`,
      "",
      "  Then leave the window open and run:  npm run ingest",
      "=".repeat(70),
      "",
    ].join("\n"),
  );
}

main();
