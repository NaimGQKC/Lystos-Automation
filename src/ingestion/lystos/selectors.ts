/** ⚠️ CALIBRATION FILE ⚠️
 *
 *  These selectors and URL patterns were written blind — this sandbox cannot
 *  reach lystos.com. Before first use, run `npm run capture -- <agent-id>` on a
 *  machine with the agent's credentials: it logs in, records every JSON
 *  network response and a DOM snapshot to data/capture/, and prints a summary.
 *  Then update this file (and parsers.ts) to match reality. Everything else in
 *  the pipeline is independent of these values.
 */
export const LYSTOS = {
  loginUrl: "https://app.lystos.com/login",
  login: {
    email: 'input[type="email"], input[name="email"]',
    password: 'input[type="password"], input[name="password"]',
    submit: 'button[type="submit"]',
  },
  /** A selector that only exists when authenticated — used to detect that a
   *  persisted session is still valid. */
  loggedInProbe: '[data-testid="user-menu"], nav [class*="avatar" i]',
  /** Substrings of XHR/fetch URLs that carry listing data. The capture run
   *  will reveal the real ones. */
  listingApiPatterns: ["listing", "anuncio", "search", "capta"],
} as const;
