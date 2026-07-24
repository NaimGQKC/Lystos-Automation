import { describe, expect, it } from "vitest";
import { pickIndex, render } from "../src/composer/render.js";
import { testAgent, testWaAgent, listing } from "./helpers.js";

describe("composer — email", () => {
  it("renders subject and body with variables inlined", () => {
    const msg = render(testAgent(), listing(), "anna@example.com");
    expect(msg.channel).toBe("email");
    expect(msg.subject).toBe("Tu flat de 3 hab., 85 m² en Gràcia, Barcelona");
    expect(msg.preview).toBe(
      "Hola Anna, soy Test Agent. Vi tu anuncio por 300.000 €.",
    );
  });

  it("never leaves an empty slot when listing data is missing", () => {
    const msg = render(testAgent(), listing({ ownerName: undefined, price: undefined }), "x@y.com");
    expect(msg.preview).toContain("propietario/a");
    expect(msg.preview).toContain("el precio publicado");
  });
});

describe("composer — whatsapp", () => {
  it("renders ordered variables and a human preview", () => {
    const msg = render(testWaAgent(), listing(), "+34612345678");
    expect(msg.channel).toBe("whatsapp");
    expect(msg.variables).toEqual(["Anna", "Gràcia, Barcelona"]);
    expect(msg.preview).toBe("Hola Anna de Gràcia, Barcelona — Test Agent");
  });

  it("throws on a template referencing an unknown variable", () => {
    const agent = testWaAgent();
    agent.whatsapp!.templates[0]!.variables = ["nonsense"];
    expect(() => render(agent, listing(), "+34612345678")).toThrow(/unknown variable/);
  });
});

describe("A/B selection", () => {
  it("is deterministic per contact and roughly uniform", () => {
    expect(pickIndex(2, "anna@example.com")).toBe(pickIndex(2, "anna@example.com"));
    let a = 0;
    for (let i = 0; i < 1000; i++) if (pickIndex(2, `user${i}@example.com`) === 0) a++;
    expect(a).toBeGreaterThan(350);
    expect(a).toBeLessThan(650);
  });
});
