import type { AgentConfig } from "../config/agent.js";
import type { RawListing } from "../ingestion/types.js";

export type MatchResult = { matched: true } | { matched: false; reason: string };

/** Decide whether a listing qualifies for this agent's outreach.
 *  Unknown values fail closed for ownership (we only message confirmed
 *  particulares) and fail open for zone/price when the source didn't provide
 *  them — the scraped feed is already scoped by the agent's saved search. */
export function matchListing(agent: AgentConfig, listing: RawListing): MatchResult {
  const f = agent.filters;

  if (f.privateOwnerOnly && listing.isPrivateOwner !== true) {
    return { matched: false, reason: "not_private_owner" };
  }

  if (listing.price !== undefined) {
    if (listing.price < f.priceMin) return { matched: false, reason: "below_price_min" };
    if (listing.price > f.priceMax) return { matched: false, reason: "above_price_max" };
  }

  if (f.zones.length > 0 && listing.zone !== undefined) {
    const zone = listing.zone.toLowerCase();
    if (!f.zones.some((z) => zone.includes(z.toLowerCase()))) {
      return { matched: false, reason: "zone_mismatch" };
    }
  }

  if (f.propertyTypes.length > 0 && listing.propertyType !== undefined) {
    const type = listing.propertyType.toLowerCase();
    if (!f.propertyTypes.some((t) => type === t.toLowerCase())) {
      return { matched: false, reason: "property_type_mismatch" };
    }
  }

  return { matched: true };
}
