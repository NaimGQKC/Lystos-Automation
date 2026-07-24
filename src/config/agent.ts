import { z } from "zod";
import { parse } from "yaml";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** WhatsApp templates must exist, pre-approved, in Meta Business Manager. */
const WaTemplateSchema = z.object({
  name: z.string(),
  metaTemplateName: z.string(),
  language: z.string().default("es"),
  /** Named variables, in the same order as the template's {{1}}, {{2}}, ... */
  variables: z.array(z.string()),
  /** Human-readable rendering, using {{name}} slots. Previews only. */
  preview: z.string(),
});

/** Email templates are ours — no external approval, edit freely.
 *  Both subject and body use {{variableName}} slots. */
const EmailTemplateSchema = z.object({
  name: z.string(),
  language: z.string().default("es"),
  subject: z.string(),
  body: z.string(),
});

const SendingSchema = z.object({
  /** No sends between start and end (local agent time). May cross midnight. */
  quietHours: z.object({ start: z.string(), end: z.string() }).default({ start: "21:00", end: "09:30" }),
  dailyCap: z.number().int().positive().default(25),
  minSecondsBetweenSends: z.number().int().positive().default(90),
});

const EmailChannelSchema = z.object({
  /** draft = write to the Drafts folder for human review (safe default).
   *  send  = deliver directly via SMTP. Flip this when you're confident. */
  mode: z.enum(["draft", "send"]).default("draft"),
  /** Env var holding the From header, e.g. "María García <maria@agencia.es>" */
  fromEnv: z.string(),
  userEnv: z.string(),
  passwordEnv: z.string(),
  /** Optional Reply-To if replies should reach a different mailbox. */
  replyTo: z.string().optional(),
  smtpHost: z.string(),
  smtpPort: z.number().int().positive().default(465),
  imapHost: z.string(),
  imapPort: z.number().int().positive().default(993),
  /** Mailbox drafts are appended to. Gmail uses "[Gmail]/Drafts". */
  draftsMailbox: z.string().default("Drafts"),
  templates: z.array(EmailTemplateSchema).min(1),
});

const WhatsappChannelSchema = z.object({
  phoneNumberIdEnv: z.string(),
  accessTokenEnv: z.string(),
  templates: z.array(WaTemplateSchema).min(1),
});

export const AgentConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    timezone: z.string().default("Europe/Madrid"),
    /** Which channel first-touch messages go out on. */
    channel: z.enum(["email", "whatsapp"]).default("email"),
    lystos: z.object({
      /** Env vars <prefix>_EMAIL and <prefix>_PASSWORD hold the account login. */
      credentialsEnvPrefix: z.string(),
      /** URL of the saved search / alert feed inside app.lystos.com to scrape. */
      searchUrl: z.string().url(),
    }),
    filters: z.object({
      /** Case-insensitive substring match against zone/municipality. Empty = any. */
      zones: z.array(z.string()).default([]),
      priceMin: z.number().int().nonnegative().default(0),
      priceMax: z.number().int().positive().default(Number.MAX_SAFE_INTEGER),
      propertyTypes: z.array(z.string()).default([]),
      privateOwnerOnly: z.boolean().default(true),
    }),
    sending: SendingSchema.prefault({}),
    email: EmailChannelSchema.optional(),
    whatsapp: WhatsappChannelSchema.optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.channel === "email" && !cfg.email) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'channel is "email" but no email: block is configured' });
    }
    if (cfg.channel === "whatsapp" && !cfg.whatsapp) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'channel is "whatsapp" but no whatsapp: block is configured' });
    }
  });

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;
export type WaTemplate = z.infer<typeof WaTemplateSchema>;

export function loadAgent(path: string): AgentConfig {
  return AgentConfigSchema.parse(parse(readFileSync(path, "utf8")));
}

/** Loads every *.agent.yaml in the agents/ directory.
 *
 *  No YAML at all is the normal single-agent case: everything falls back to
 *  the env-driven default (see config/defaults.ts). Add YAML files only when
 *  running several agents with different zones, mailboxes or wording. */
export async function loadAgents(dir = "agents"): Promise<AgentConfig[]> {
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".agent.yaml"))
    : [];
  if (files.length === 0) {
    const { defaultAgent } = await import("./defaults.js");
    return [defaultAgent()];
  }
  const agents = files.map((f) => loadAgent(join(dir, f)));
  const ids = new Set<string>();
  for (const a of agents) {
    if (ids.has(a.id)) throw new Error(`Duplicate agent id: ${a.id}`);
    ids.add(a.id);
  }
  return agents;
}
