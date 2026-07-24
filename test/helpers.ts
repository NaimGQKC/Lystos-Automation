import { openDb, type DB } from "../src/db/index.js";
import { AgentConfigSchema, type AgentConfig } from "../src/config/agent.js";
import type { RawListing } from "../src/ingestion/types.js";

export function testDb(): DB {
  return openDb(":memory:");
}

const baseEmail = {
  mode: "draft" as const,
  fromEnv: "EMAIL_TEST_FROM",
  userEnv: "EMAIL_TEST_USER",
  passwordEnv: "EMAIL_TEST_PASSWORD",
  smtpHost: "smtp.test",
  imapHost: "imap.test",
  draftsMailbox: "Drafts",
  templates: [
    {
      name: "a",
      language: "es",
      subject: "Tu {{propertyLabel}} en {{zone}}",
      body: "Hola {{ownerName}}, soy {{agentName}}. Vi tu anuncio por {{price}}.",
    },
  ],
};

export function testAgent(overrides: Record<string, unknown> = {}): AgentConfig {
  return AgentConfigSchema.parse({
    id: "test",
    name: "Test Agent",
    channel: "email",
    lystos: { credentialsEnvPrefix: "LYSTOS_TEST", searchUrl: "https://app.lystos.com/search/x" },
    filters: { zones: ["Gràcia"], priceMin: 100000, priceMax: 500000, privateOwnerOnly: true },
    sending: { quietHours: { start: "21:00", end: "09:00" }, dailyCap: 3, minSecondsBetweenSends: 60 },
    email: baseEmail,
    ...overrides,
  });
}

/** Agent configured for the WhatsApp channel (phone contacts). */
export function testWaAgent(overrides: Record<string, unknown> = {}): AgentConfig {
  return testAgent({
    channel: "whatsapp",
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
    ownerEmail: "anna@example.com",
    isPrivateOwner: true,
    raw: {},
    ...overrides,
  };
}
