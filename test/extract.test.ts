import { describe, expect, it } from "vitest";
import { extractEmail, extractEmails } from "../src/ingestion/lystos/extract.js";

describe("extractEmail — plain addresses", () => {
  it("finds an address in ad text", () => {
    expect(
      extractEmail("Vendo piso sin comisiones. Contacto: maria.lopez@gmail.com o por teléfono."),
    ).toBe("maria.lopez@gmail.com");
  });

  it("strips trailing punctuation", () => {
    expect(extractEmail("Escríbeme a juan@hotmail.es.")).toBe("juan@hotmail.es");
    expect(extractEmail("(correo: ana@yahoo.es)")).toBe("ana@yahoo.es");
  });

  it("uppercases are normalised", () => {
    expect(extractEmail("MARIA@GMAIL.COM")).toBe("maria@gmail.com");
  });
});

describe("extractEmail — obfuscated addresses", () => {
  // Private sellers disguise addresses precisely to defeat scraping.
  it("handles (arroba) and (punto)", () => {
    expect(extractEmail("escribe a juan (arroba) gmail (punto) com")).toBe("juan@gmail.com");
  });

  it("handles bare arroba/punto words", () => {
    expect(extractEmail("maria arroba hotmail punto es")).toBe("maria@hotmail.es");
  });

  it("handles [at] / [dot]", () => {
    expect(extractEmail("owner [at] outlook [dot] com")).toBe("owner@outlook.com");
  });

  it("handles spaced-out separators", () => {
    expect(extractEmail("contacto: pedro @ gmail . com")).toBe("pedro@gmail.com");
  });
});

describe("extractEmail — things that are not the owner", () => {
  it("ignores portal and CRM addresses", () => {
    expect(extractEmail("Anuncio publicado en info@idealista.com")).toBeUndefined();
    expect(extractEmail("soporte@fotocasa.es")).toBeUndefined();
  });

  it("still finds the owner's address alongside a portal one", () => {
    expect(
      extractEmail("Publicado via info@idealista.com. Escríbeme: dueno@gmail.com"),
    ).toBe("dueno@gmail.com");
  });

  it("ignores image filenames that look like addresses", () => {
    expect(extractEmail("ver foto1@2x.png en la galería")).toBeUndefined();
  });

  it("returns nothing for text with no address", () => {
    expect(extractEmail("ABSTENERSE INMOBILIARIAS. VENTA DIRECTA DEL PROPIETARIO.")).toBeUndefined();
    expect(extractEmail("")).toBeUndefined();
    expect(extractEmail(undefined)).toBeUndefined();
  });
});

describe("extractEmails", () => {
  it("returns every distinct owner address found", () => {
    const found = extractEmails("Contacto: ana@gmail.com o bien luis (arroba) yahoo.es");
    expect(found).toContain("ana@gmail.com");
    expect(found).toContain("luis@yahoo.es");
  });
});
