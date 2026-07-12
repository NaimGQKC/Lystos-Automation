import { describe, expect, it } from "vitest";
import { parseListingsPayload } from "../src/ingestion/lystos/parsers.js";

describe("parseListingsPayload", () => {
  it("extracts listings with numeric or string ids from nested payloads", () => {
    const payload = {
      meta: { total: 2 },
      results: [
        {
          id: 98211, title: "Piso en Verdi", price: 385000, neighborhood: "Gràcia",
          rooms: 3, surface: 85, advertiserType: "particular",
          contact: { name: "Anna", phone: "612 345 678" },
        },
        { id: "abc-123", price: 200000, municipality: "Barcelona", advertiserType: "agency" },
      ],
    };
    const listings = parseListingsPayload("https://x/api/search", payload)!;
    expect(listings).toHaveLength(2);
    expect(listings[0]).toMatchObject({
      sourceId: "lystos:98211",
      price: 385000,
      zone: "Gràcia",
      rooms: 3,
      sqm: 85,
      ownerName: "Anna",
      ownerPhone: "612 345 678",
      isPrivateOwner: true,
    });
    expect(listings[1]).toMatchObject({ sourceId: "lystos:abc-123" });
    expect(listings[1]!.isPrivateOwner).toBeUndefined(); // "agency" → unknown → rules fail closed
  });

  it("returns null for payloads that are not listing feeds", () => {
    expect(parseListingsPayload("https://x/api/user", { user: { id: 1, name: "x" } })).toBeNull();
    expect(parseListingsPayload("https://x/api/empty", { results: [] })).toBeNull();
    expect(parseListingsPayload("https://x/api/other", [{ foo: "bar" }])).toBeNull();
  });
});
