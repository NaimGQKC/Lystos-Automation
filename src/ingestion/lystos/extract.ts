/** Pulling contact details out of free-text ad descriptions.
 *
 *  Private sellers routinely put their email in the ad body rather than in a
 *  structured field — and just as routinely obfuscate it to dodge scrapers
 *  ("nombre (arroba) gmail punto com"). This normalises the common Spanish
 *  and English disguises before matching.
 */

/** Portal, CRM and stock-photo domains that appear in ad text but never
 *  belong to the owner. Messaging these would be worse than messaging nobody. */
const NON_OWNER_DOMAINS = [
  "idealista.com", "fotocasa.es", "habitaclia.com", "pisos.com", "yaencontre.com",
  "milanuncios.com", "tucasa.com", "kyero.com", "indomio.es", "lystos.com",
  "example.com", "sentry.io", "wixpress.com", "gmail.example",
];

/** Normalise disguised separators back into a plain address.
 *  "juan (arroba) gmail punto com" → "juan@gmail.com" */
function deobfuscate(text: string): string {
  return text
    .replace(/\s*[([{<]\s*(arroba|at|@)\s*[)\]}>]\s*/gi, "@")
    .replace(/\s+(arroba|at)\s+/gi, "@")
    .replace(/\s*[([{<]\s*(punto|dot|\.)\s*[)\]}>]\s*/gi, ".")
    .replace(/\s+(punto|dot)\s+/gi, ".")
    // Collapse spacing around separators: "juan @ gmail . com"
    .replace(/\s*@\s*/g, "@")
    .replace(/\s*\.\s*(?=[a-z]{2,4}\b)/gi, ".");
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Every plausible owner email found in the text, most likely first.
 *  Addresses on portal/CRM domains are excluded. */
export function extractEmails(text: string | undefined | null): string[] {
  if (!text) return [];

  const found = new Set<string>();
  // Match the raw text first (cheapest, most reliable), then the
  // de-obfuscated form to catch the disguised ones.
  for (const candidate of [text, deobfuscate(text)]) {
    for (const match of candidate.matchAll(EMAIL_RE)) {
      const email = match[0].toLowerCase().replace(/[.,;:)\]}>]+$/, "");
      if (!isPlausibleOwnerEmail(email)) continue;
      found.add(email);
    }
  }
  return [...found];
}

/** The single best owner email in the text, or undefined. */
export function extractEmail(text: string | undefined | null): string | undefined {
  return extractEmails(text)[0];
}

function isPlausibleOwnerEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const domain = email.slice(at + 1);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return false;
  if (domain.length > 100 || email.length > 254) return false;
  // A trailing image/file extension means we matched a filename, not an address.
  if (/\.(jpe?g|png|webp|gif|pdf|html?)$/i.test(email)) return false;
  return !NON_OWNER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}
