/** Selectors for the Lystos login flow.
 *
 *  Verified 2026 against the real site: app.lystos.com delegates auth to a
 *  Keycloak instance at account.lystos.com (OpenID Connect). The form fields
 *  below are Keycloak's standard login template, so they're stable across
 *  Lystos UI redesigns — only a Keycloak theme change would move them.
 */
export const LYSTOS = {
  loginUrl: "https://app.lystos.com/login",

  /** Hosts/paths that mean "you are on the auth server, not logged in". */
  authHostPatterns: ["account.lystos.com", "openid-connect"],

  login: {
    // Note: type="text", not type="email".
    username: "#username",
    password: "#password",
    // Keeps the session alive longer → fewer logins → less bot suspicion.
    rememberMe: "#rememberMe",
    // An <input type="submit">, not a <button>.
    submit: "#kc-login",
    // Keycloak renders these when credentials are rejected.
    error: "#input-error, .alert-error, .pf-c-alert__title",
  },

  /** Substrings of XHR/fetch URLs that carry listing data. Confirmed from a
   *  live capture: the app's own backend is services.lystos.com.
   *    /catalog/v1/listings/views/explorer  → the listing feed (the one we want)
   *    /account/v1/alerts/views/grouped     → the agent's configured alerts
   *  "coordinates" is deliberately excluded: it's map-pin data with no
   *  contact details. */
  listingApiPatterns: ["catalog/v1/listings/views/explorer", "account/v1/alerts/views/grouped"],
} as const;

/** True when the given URL belongs to the auth server rather than the app. */
export function isAuthPage(url: string): boolean {
  return LYSTOS.authHostPatterns.some((p) => url.includes(p));
}
