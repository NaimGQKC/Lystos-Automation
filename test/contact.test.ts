import { describe, expect, it } from "vitest";
import { normalizePhone, normalizeEmail } from "../src/matching/contact.js";

describe("normalizePhone", () => {
  it("normalizes Spanish national formats to E.164", () => {
    expect(normalizePhone("612 345 678")).toBe("+34612345678");
    expect(normalizePhone("612345678")).toBe("+34612345678");
    expect(normalizePhone("+34 612 345 678")).toBe("+34612345678");
    expect(normalizePhone("0034612345678")).toBe("+34612345678");
  });

  it("keeps valid foreign numbers", () => {
    expect(normalizePhone("+33 6 12 34 56 78")).toBe("+33612345678");
  });

  it("rejects garbage and landline-length fragments", () => {
    expect(normalizePhone("no phone")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims valid addresses", () => {
    expect(normalizeEmail("  Anna@Example.COM ")).toBe("anna@example.com");
  });

  it("rejects malformed addresses", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("a b@c.com")).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});
