import { describe, expect, it } from "vitest";
import { parseListingsPayload } from "../src/ingestion/lystos/parsers.js";

/** Shapes taken from a real explorer response (personal data replaced). */
const REAL_PAYLOAD = {
  data: [
    {
      id: "e3559a5f-51d6-4cc6-944e-717da78d1488",
      bedrooms: 4, bathrooms: 2, sqm: 107,
      title: "Piso en venta en Calle de Churruca, 5",
      advertiserName: "Carmen",
      price: 895000,
      propertyType: "Piso",
      address: "Calle de Churruca, 5;Barrio Chueca-Justicia;Distrito Centro;Madrid;Madrid capital, Madrid;",
      advertiserType: "Particular",
      advertiserTypeId: 2,
      advertiserPhone: "-", // Lystos's "no phone" placeholder
      siteUrl: "https://www.idealista.com/inmueble/108069867/",
      isContacted: false, isAutoContacted: false, isDiscarded: false, isScam: false,
    },
    {
      id: "4a79d56d-8333-4e73-9149-029daf525bac",
      bedrooms: 0, sqm: 52, price: 420000,
      title: "Estudio en venta en Calle de Martín de los Heros, 40",
      advertiserName: "Luis",
      propertyType: "Estudio",
      neighborhood: "Argüelles",
      districtArea: "Moncloa",
      municipalityName: "Madrid",
      advertiserType: "Particular",
      advertiserTypeId: 2,
      advertiserPhone: "612345678",
      siteUrl: "https://www.idealista.com/inmueble/112431051/",
      isContacted: false, isAutoContacted: false, isDiscarded: false, isScam: false,
    },
    {
      id: "73a199ac-8e22-4e72-a600-166beeeb3834",
      price: 840000, sqm: 104, bedrooms: 4,
      title: "Piso en venta en CL Paz",
      advertiserName: "Inmobiliaria X",
      agencyName: "Inmobiliaria X",
      advertiserType: "Profesional",
      advertiserTypeId: 1,
      advertiserPhone: "911111111",
      isContacted: false, isAutoContacted: false, isDiscarded: false, isScam: false,
    },
  ],
};

describe("parseListingsPayload — real Lystos explorer shape", () => {
  const listings = parseListingsPayload("https://services.lystos.com/catalog/v1/listings/views/explorer", REAL_PAYLOAD)!;

  it("finds the records under body.data", () => {
    expect(listings).toHaveLength(3);
  });

  it("flags particulares by advertiserTypeId", () => {
    expect(listings[0]!.isPrivateOwner).toBe(true);
    expect(listings[1]!.isPrivateOwner).toBe(true);
    expect(listings[2]!.isPrivateOwner).toBe(false); // Profesional / agency
  });

  it('treats "-" as no phone rather than a contact detail', () => {
    expect(listings[0]!.ownerPhone).toBeUndefined();
    expect(listings[1]!.ownerPhone).toBe("612345678");
  });

  it("derives the zone from explicit fields or the address path", () => {
    // No neighborhood field → second segment of the ';' address path.
    expect(listings[0]!.zone).toBe("Barrio Chueca-Justicia");
    expect(listings[1]!.zone).toBe("Argüelles");
  });

  it("maps the core listing fields", () => {
    expect(listings[1]).toMatchObject({
      sourceId: "lystos:4a79d56d-8333-4e73-9149-029daf525bac",
      price: 420000,
      sqm: 52,
      propertyType: "Estudio",
      ownerName: "Luis",
      url: "https://www.idealista.com/inmueble/112431051/",
    });
  });

  it("confirms this feed carries no owner email", () => {
    expect(listings.every((l) => l.ownerEmail === undefined)).toBe(true);
  });

  it("carries the source's own contacted/discarded flags", () => {
    const contacted = parseListingsPayload("x", {
      data: [{ ...REAL_PAYLOAD.data[1], isContacted: true }],
    })!;
    expect(contacted[0]!.alreadyContacted).toBe(true);

    const scam = parseListingsPayload("x", {
      data: [{ ...REAL_PAYLOAD.data[1], isScam: true }],
    })!;
    expect(scam[0]!.discarded).toBe(true);
  });

  it("falls back to the advertiserType label when the id is missing", () => {
    const parsed = parseListingsPayload("x", {
      data: [{ id: "z", price: 1, advertiserType: "Particular" }],
    })!;
    expect(parsed[0]!.isPrivateOwner).toBe(true);
  });

  it("leaves ownership unknown when the source says nothing", () => {
    const parsed = parseListingsPayload("x", { data: [{ id: "z", price: 1 }] })!;
    expect(parsed[0]!.isPrivateOwner).toBeUndefined(); // rules fail closed
  });

  it("returns null for payloads that are not listing feeds", () => {
    expect(parseListingsPayload("x", { user: { id: 1, name: "x" } })).toBeNull();
    expect(parseListingsPayload("x", { data: [] })).toBeNull();
  });
});
