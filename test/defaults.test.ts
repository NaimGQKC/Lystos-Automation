import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { loadAgents } from "../src/config/agent.js";
import { defaultAgent, DEFAULT_SEARCH_URL } from "../src/config/defaults.js";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("zero-config default agent", () => {
  it("works with no YAML at all", async () => {
    const agents = await loadAgents("does-not-exist");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.id).toBe("default");
    expect(agents[0]!.channel).toBe("email");
    expect(agents[0]!.lystos.searchUrl).toBe(DEFAULT_SEARCH_URL);
  });

  it("defaults to drafting, with no zone or price restriction", () => {
    const a = defaultAgent();
    expect(a.email!.mode).toBe("draft");
    expect(a.filters.zones).toEqual([]);
    expect(a.filters.priceMin).toBe(0);
  });

  it("picks up optional env overrides", () => {
    process.env.AGENT_NAME = "María";
    process.env.ZONES = "Gràcia, Eixample";
    process.env.PRICE_MAX = "750000";
    process.env.EMAIL_MODE = "send";
    const a = defaultAgent();
    expect(a.name).toBe("María");
    expect(a.filters.zones).toEqual(["Gràcia", "Eixample"]);
    expect(a.filters.priceMax).toBe(750000);
    expect(a.email!.mode).toBe("send");
  });
});
