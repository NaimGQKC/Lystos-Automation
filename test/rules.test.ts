import { describe, expect, it } from "vitest";
import { matchListing } from "../src/matching/rules.js";
import { testAgent, listing } from "./helpers.js";

const agent = testAgent();

describe("matchListing", () => {
  it("matches a private-owner listing inside filters", () => {
    expect(matchListing(agent, listing())).toEqual({ matched: true });
  });

  it("rejects agency listings and unknown ownership (fail closed)", () => {
    expect(matchListing(agent, listing({ isPrivateOwner: false }))).toMatchObject({ reason: "not_private_owner" });
    expect(matchListing(agent, listing({ isPrivateOwner: undefined }))).toMatchObject({ reason: "not_private_owner" });
  });

  it("enforces price band", () => {
    expect(matchListing(agent, listing({ price: 50_000 }))).toMatchObject({ reason: "below_price_min" });
    expect(matchListing(agent, listing({ price: 900_000 }))).toMatchObject({ reason: "above_price_max" });
  });

  it("matches zones case-insensitively by substring, fails open when unknown", () => {
    expect(matchListing(agent, listing({ zone: "GRÀCIA - Vila de Gràcia" }))).toEqual({ matched: true });
    expect(matchListing(agent, listing({ zone: "Sants" }))).toMatchObject({ reason: "zone_mismatch" });
    expect(matchListing(agent, listing({ zone: undefined }))).toEqual({ matched: true });
    expect(matchListing(agent, listing({ price: undefined }))).toEqual({ matched: true });
  });

  it("filters property types only when configured", () => {
    const typed = testAgent({
      filters: { zones: [], propertyTypes: ["flat"], privateOwnerOnly: true },
    });
    expect(matchListing(typed, listing({ propertyType: "Flat" }))).toEqual({ matched: true });
    expect(matchListing(typed, listing({ propertyType: "garage" }))).toMatchObject({ reason: "property_type_mismatch" });
  });
});
