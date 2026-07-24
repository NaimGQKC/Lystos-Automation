import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { AgentConfig } from "../config/agent.js";
import type { RawListing } from "../ingestion/types.js";

/** Normalize a raw phone string to E.164, defaulting to Spain.
 *  Returns null for anything unparseable or invalid — callers must skip those. */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), "ES");
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164, e.g. +34612345678
}

/** Conservative email validation + normalization (lowercased, trimmed). */
export function normalizeEmail(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/.test(value)) return null;
  return value;
}

export type Contact = { key: string; type: "phone" | "email" };

/** The address we'd reach this owner at on the agent's chosen channel.
 *  Returns null when the listing carries no usable contact for that channel. */
export function resolveContact(agent: AgentConfig, listing: RawListing): Contact | null {
  if (agent.channel === "email") {
    const email = normalizeEmail(listing.ownerEmail);
    return email ? { key: email, type: "email" } : null;
  }
  const phone = normalizePhone(listing.ownerPhone);
  return phone ? { key: phone, type: "phone" } : null;
}
