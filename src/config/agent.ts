import { z } from "zod";
import { parse } from "yaml";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TemplateSchema = z.object({
  /** Local identifier for A/B reporting. */
  name: z.string(),
  /** Exact name of the Meta-approved template. */
  metaTemplateName: z.string(),
  language: z.string().default("es"),
  /** Named variables, in the same order as the template's {{1}}, {{2}}, ... */
  variables: z.array(z.string()),
  /** Human-readable rendering of the approved template body, using {{name}} slots.
   *  Only used for previews/dry-run reports — the real body lives in Meta. */
  preview: z.string(),
});

export const AgentConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  timezone: z.string().default("Europe/Madrid"),
  lystos: z.object({
    /** Env vars <prefix>_EMAIL and <prefix>_PASSWORD hold the account login. */
    credentialsEnvPrefix: z.string(),
    /** URL of the saved search / alert feed inside app.lystos.com to scrape. */
    searchUrl: z.string().url(),
  }),
  filters: z.object({
    /** Case-insensitive substring match against the listing's zone/municipality. Empty = any. */
    zones: z.array(z.string()).default([]),
    priceMin: z.number().int().nonnegative().default(0),
    priceMax: z.number().int().positive().default(Number.MAX_SAFE_INTEGER),
    /** e.g. ["flat", "house"]. Empty = any. */
    propertyTypes: z.array(z.string()).default([]),
    privateOwnerOnly: z.boolean().default(true),
  }),
  whatsapp: z.object({
    phoneNumberIdEnv: z.string(),
    accessTokenEnv: z.string(),
    templates: z.array(TemplateSchema).min(1),
    sending: z.object({
      /** No sends between start and end (local agent time). Crosses midnight. */
      quietHours: z.object({ start: z.string(), end: z.string() }).default({ start: "21:00", end: "09:30" }),
      dailyCap: z.number().int().positive().default(25),
      minSecondsBetweenSends: z.number().int().positive().default(90),
    }),
  }),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type MessageTemplate = z.infer<typeof TemplateSchema>;

export function loadAgent(path: string): AgentConfig {
  return AgentConfigSchema.parse(parse(readFileSync(path, "utf8")));
}

/** Loads every *.agent.yaml in the agents/ directory. Onboarding a new agent
 *  is dropping a file here — no code changes. */
export function loadAgents(dir = "agents"): AgentConfig[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".agent.yaml"));
  if (files.length === 0) throw new Error(`No *.agent.yaml files found in ${dir}/`);
  const agents = files.map((f) => loadAgent(join(dir, f)));
  const ids = new Set<string>();
  for (const a of agents) {
    if (ids.has(a.id)) throw new Error(`Duplicate agent id: ${a.id}`);
    ids.add(a.id);
  }
  return agents;
}
