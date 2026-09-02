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

  /** Substrings of XHR/fetch URLs that carry listing data. Broad on purpose:
   *  narrow these only once a capture shows the real feed endpoint. */
  listingApiPatterns: ["listing", "anuncio", "search", "capta", "explora", "propert"],
} as const;

/** True when the given URL belongs to the auth server rather than the app. */
export function isAuthPage(url: string): boolean {
  return LYSTOS.authHostPatterns.some((p) => url.includes(p));
}
