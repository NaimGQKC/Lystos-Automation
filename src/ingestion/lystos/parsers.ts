import type { RawListing } from "../types.js";

/** ⚠️ CALIBRATION FILE ⚠️  (see selectors.ts for the workflow)
 *
 *  Strategy: rather than scraping the DOM (fragile), we intercept the JSON the
 *  Lystos SPA fetches for its own UI and parse that. This function receives
 *  every intercepted JSON body whose URL matched LYSTOS.listingApiPatterns;
 *  return the listings you can extract, or null if this payload isn't a
 *  listing feed. The generic extractor below handles common shapes so light
 *  API changes don't require code edits — but verify field names against a
 *  real capture before going live. */
export function parseListingsPayload(url: string, json: unknown): RawListing[] | null {
  const items = findListingArray(json);
  if (!items) return null;

  const listings: RawListing[] = [];
  for (const item of items) {
    const it = item as Record<string, unknown>;
    const id = str(it.id ?? it.listingId ?? it.adId ?? it.uuid);
    if (!id) continue;
    listings.push({
      sourceId: `lystos:${id}`,
      source: "lystos",
      url: str(it.url ?? it.link),
      title: str(it.title ?? it.name),
      price: num(it.price ?? it.priceEur ?? (it as any)?.price?.amount),
      zone: str(it.zone ?? it.neighborhood ?? it.district ?? it.municipality ?? it.location),
      propertyType: str(it.propertyType ?? it.type ?? it.typology),
      rooms: num(it.rooms ?? it.bedrooms),
      sqm: num(it.sqm ?? it.surface ?? it.area),
      ownerName: str(it.ownerName ?? it.contactName ?? (it as any)?.contact?.name),
      ownerPhone: str(it.ownerPhone ?? it.phone ?? (it as any)?.contact?.phone),
      isPrivateOwner: bool(it.isPrivate ?? it.isParticular ?? it.privateOwner) ??
        (str(it.advertiserType ?? it.sellerType)?.toLowerCase().includes("particular") || undefined),
      raw: item,
    });
  }
  return listings.length > 0 ? listings : null;
}

/** Walk a JSON payload looking for the first array of objects that smells like
 *  a listing feed (objects with an id and a price-ish or location-ish field). */
function findListingArray(json: unknown, depth = 0): unknown[] | null {
  if (depth > 4 || json === null || typeof json !== "object") return null;
  if (Array.isArray(json)) {
    const looksRight =
      json.length > 0 &&
      json.every((x) => x !== null && typeof x === "object") &&
      json.some((x) => {
        const o = x as Record<string, unknown>;
        const hasId = "id" in o || "listingId" in o || "adId" in o || "uuid" in o;
        const hasSignal = ["price", "priceEur", "zone", "surface", "sqm", "rooms", "municipality"]
          .some((k) => k in o);
        return hasId && hasSignal;
      });
    return looksRight ? json : null;
  }
  for (const value of Object.values(json as Record<string, unknown>)) {
    const found = findListingArray(value, depth + 1);
    if (found) return found;
  }
  return null;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
};
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
