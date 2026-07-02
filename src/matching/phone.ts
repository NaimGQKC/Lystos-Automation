import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Normalize a raw phone string to E.164, defaulting to Spain.
 *  Returns null for anything unparseable or invalid — callers must skip those. */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), "ES");
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164, e.g. +34612345678
}
