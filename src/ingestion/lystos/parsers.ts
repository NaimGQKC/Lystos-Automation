import type { RawListing } from "../types.js";

/** Parses the Lystos explorer feed.
 *
 *  Calibrated against the live response from
 *  services.lystos.com/catalog/v1/listings/views/explorer — records live at
 *  `body.data`, 40 per page.
 *
 *  Two things worth knowing about this payload:
 *
 *  1. There is NO owner email field. The only contact detail is
 *     `advertiserPhone`, and it is frequently "-" or "" even for private
 *     sellers. Reaching owners by email is not possible from this feed.
 *  2. `advertiserTypeId` is the reliable private-seller flag: 2 = Particular
 *     (FSBO), 1 = Profesional (agency). The string `advertiserType` carries
 *     the same information and is used as a fallback.
 */
export function parseListingsPayload(url: string, json: unknown): RawListing[] | null {
  const items = findListingArray(json);
  if (!items) return null;

  const listings: RawListing[] = [];
  for (const item of items) {
    const it = item as Record<string, unknown>;
    const id = idStr(it.id ?? it.listingId ?? it.externalId);
    if (!id) continue;

    listings.push({
      sourceId: `lystos:${id}`,
      source: "lystos",
      url: str(it.siteUrl ?? it.url),
      title: str(it.title),
      price: num(it.price),
      zone: parseZone(it),
      propertyType: str(it.propertyType),
      rooms: num(it.bedrooms),
      sqm: num(it.sqm ?? it.sqmUsable),
      ownerName: cleanName(str(it.advertiserName)),
      ownerPhone: cleanPhone(str(it.advertiserPhone)),
      // Not present in this feed — kept so other sources can supply it.
      ownerEmail: str(it.advertiserEmail ?? it.email),
      isPrivateOwner: parsePrivateOwner(it),
      /** Lystos's own record of whether this listing was already contacted. */
      alreadyContacted: bool(it.isContacted) === true || bool(it.isAutoContacted) === true,
      discarded: bool(it.isDiscarded) === true || bool(it.isScam) === true,
      raw: item,
    });
  }
  return listings.length > 0 ? listings : null;
}

/** 2 = Particular (FSBO), 1 = Profesional. Falls back to the label, then to
 *  undefined — which the matching rules treat as "not proven private", so an
 *  unknown advertiser is never messaged. */
function parsePrivateOwner(it: Record<string, unknown>): boolean | undefined {
  const typeId = num(it.advertiserTypeId);
  if (typeId === 2) return true;
  if (typeId === 1) return false;

  const label = str(it.advertiserType)?.toLowerCase();
  if (!label) return undefined;
  if (label.includes("particular")) return true;
  if (label.includes("profesional") || label.includes("agenc")) return false;
  return undefined;
}

/** The most specific place name available. `address` is a ';'-delimited path
 *  like "Calle X;Barrio Sol;Distrito Centro;Madrid;Madrid capital, Madrid;" —
 *  its second segment is the neighbourhood when the explicit fields are
 *  missing (they're absent from some responses). */
function parseZone(it: Record<string, unknown>): string | undefined {
  const explicit = str(it.neighborhood) ?? str(it.districtArea) ?? str(it.municipalityName);
  if (explicit) return explicit;

  const address = str(it.address);
  if (!address) return undefined;
  const parts = address.split(";").map((p) => p.trim()).filter(Boolean);
  return parts[1] ?? parts[0];
}

/** Lystos writes "-" or "" when a listing carries no phone at all. */
function cleanPhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || !/\d/.test(trimmed)) return undefined;
  return trimmed;
}

/** Portals often use placeholders instead of a real name. */
function cleanName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || /^particular$/i.test(trimmed)) return undefined;
  return trimmed;
}

/** Walk a JSON payload looking for the array of listing records. Prefers the
 *  known `data` key, then falls back to any array that looks like listings. */
function findListingArray(json: unknown, depth = 0): unknown[] | null {
  if (depth > 4 || json === null || typeof json !== "object") return null;

  if (!Array.isArray(json)) {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.data) && looksLikeListings(obj.data)) return obj.data;
    for (const value of Object.values(obj)) {
      const found = findListingArray(value, depth + 1);
      if (found) return found;
    }
    return null;
  }

  return looksLikeListings(json) ? json : null;
}

function looksLikeListings(arr: unknown[]): boolean {
  if (arr.length === 0 || !arr.every((x) => x && typeof x === "object")) return false;
  return arr.some((x) => {
    const o = x as Record<string, unknown>;
    const hasId = "id" in o || "listingId" in o || "externalId" in o;
    const hasSignal = ["price", "sqm", "advertiserType", "advertiserTypeId", "propertyType", "neighborhood"]
      .some((k) => k in o);
    return hasId && hasSignal;
  });
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** Ids may arrive as numbers or strings depending on the endpoint. */
const idStr = (v: unknown): string | undefined =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : str(v);
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
};
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
