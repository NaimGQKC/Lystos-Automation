import { openDb, type DB } from "../src/db/index.js";
import { AgentConfigSchema, type AgentConfig } from "../src/config/agent.js";
import type { RawListing } from "../src/ingestion/types.js";

export function testDb(): DB {
  return openDb(":memory:");
}

export function testAgent(overrides: Record<string, unknown> = {}): AgentConfig {
  return AgentConfigSchema.parse({
    id: "test",
    name: "Test Agent",
    lystos: { credentialsEnvPrefix: "LYSTOS_TEST", searchUrl: "https://app.lystos.com/search/x" },
    filters: { zones: ["Gràcia"], priceMin: 100000, priceMax: 500000, privateOwnerOnly: true },
    whatsapp: {
      phoneNumberIdEnv: "WA_TEST_PHONE_ID",
      accessTokenEnv: "WA_TEST_TOKEN",
      templates: [
        {
          name: "a",
          metaTemplateName: "meta_a",
          language: "es",
          variables: ["ownerName", "zone"],
          preview: "Hola {{ownerName}} de {{zone}} — {{agentName}}",
        },
      ],
      sending: { quietHours: { start: "21:00", end: "09:00" }, dailyCap: 3, minSecondsBetweenSends: 60 },
    },
    ...overrides,
  });
}

export function listing(overrides: Partial<RawListing> = {}): RawListing {
  return {
    sourceId: "lystos:1",
    source: "lystos",
    title: "Piso en Gràcia",
    price: 300000,
    zone: "Gràcia, Barcelona",
    propertyType: "flat",
    rooms: 3,
    sqm: 85,
    ownerName: "Anna",
    ownerPhone: "612 345 678",
    isPrivateOwner: true,
    raw: {},
    ...overrides,
  };
}
