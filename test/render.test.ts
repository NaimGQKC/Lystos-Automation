import { describe, expect, it } from "vitest";
import { pickTemplate, render } from "../src/composer/render.js";
import { testAgent, listing } from "./helpers.js";

describe("composer", () => {
  it("renders ordered variables and a human preview", () => {
    const agent = testAgent();
    const msg = render(agent, listing(), "+34612345678");
    expect(msg.variables).toEqual(["Anna", "Gràcia, Barcelona"]);
    expect(msg.preview).toBe("Hola Anna de Gràcia, Barcelona — Test Agent");
  });

  it("never renders an empty slot (Meta rejects empty parameters)", () => {
    const agent = testAgent();
    const msg = render(agent, listing({ ownerName: undefined, zone: undefined }), "+34612345678");
    expect(msg.variables).toEqual(["propietario/a", "tu zona"]);
  });

  it("throws on a template referencing an unknown variable", () => {
    const agent = testAgent();
    agent.whatsapp.templates[0]!.variables = ["nonsense"];
    expect(() => render(agent, listing(), "+34612345678")).toThrow(/unknown variable/);
  });

  it("A/B pick is deterministic per phone and roughly uniform", () => {
    const templates = [
      { name: "a", metaTemplateName: "a", language: "es", variables: [], preview: "" },
      { name: "b", metaTemplateName: "b", language: "es", variables: [], preview: "" },
    ];
    const first = pickTemplate(templates, "+34600000001");
    expect(pickTemplate(templates, "+34600000001")).toBe(first);

    let a = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickTemplate(templates, `+346${String(i).padStart(8, "0")}`).name === "a") a++;
    }
    expect(a).toBeGreaterThan(350);
    expect(a).toBeLessThan(650);
  });
});
