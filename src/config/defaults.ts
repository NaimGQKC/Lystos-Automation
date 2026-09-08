import { AgentConfigSchema, type AgentConfig } from "./agent.js";

/** The Lystos explorer view, confirmed from the live app.
 *
 *  Note the particulares/FSBO filter is NOT in this URL: the explorer sends
 *  its filters in the POST body of
 *  services.lystos.com/catalog/v1/listings/views/explorer, and the app
 *  restores the agent's last-used filters from her account. We additionally
 *  enforce privateOwnerOnly on every listing we parse, so an agency ad can't
 *  slip through even if the UI filter isn't applied.
 *
 *  Override with LYSTOS_SEARCH_URL to watch a different saved search. */
export const DEFAULT_SEARCH_URL = "https://app.lystos.com/explorer/search?premiseType=1";

/** Zero-config agent: everything comes from env vars, no YAML needed.
 *  Used automatically when the agents/ directory is absent or empty. */
export function defaultAgent(): AgentConfig {
  return AgentConfigSchema.parse({
    id: "default",
    name: process.env.AGENT_NAME ?? "",
    channel: "email",
    lystos: {
      credentialsEnvPrefix: "LYSTOS",
      searchUrl: process.env.LYSTOS_SEARCH_URL || DEFAULT_SEARCH_URL,
    },
    filters: {
      // No zone/price restriction unless asked for — the particulares view is
      // already the filter that matters.
      zones: envList("ZONES"),
      priceMin: envInt("PRICE_MIN") ?? 0,
      priceMax: envInt("PRICE_MAX") ?? undefined,
      privateOwnerOnly: true,
    },
    email: {
      mode: process.env.EMAIL_MODE === "send" ? "send" : "draft",
      fromEnv: "EMAIL_FROM",
      userEnv: "EMAIL_USER",
      passwordEnv: "EMAIL_PASSWORD",
      smtpHost: process.env.SMTP_HOST ?? "smtp.gmail.com",
      smtpPort: envInt("SMTP_PORT") ?? 465,
      imapHost: process.env.IMAP_HOST ?? "imap.gmail.com",
      imapPort: envInt("IMAP_PORT") ?? 993,
      draftsMailbox: process.env.DRAFTS_MAILBOX ?? "[Gmail]/Drafts",
      templates: [
        {
          name: "first_touch",
          language: "es",
          subject: "Tu {{propertyLabel}} en {{zone}}",
          body: [
            "Hola {{ownerName}},",
            "",
            "He visto tu anuncio del {{propertyLabel}} en {{zone}} publicado por {{price}}.",
            "Soy {{agentName}}, agente inmobiliaria de la zona, y tengo compradores",
            "buscando activamente por allí.",
            "",
            "Si te interesa, puedo pasarte sin compromiso una valoración de lo que se",
            "está cerrando ahora mismo en tu calle. ¿Te viene bien que hablemos esta",
            "semana?",
            "",
            "Un saludo,",
            "{{agentName}}",
            "",
            "—",
            "Si prefieres no recibir más mensajes míos, responde BAJA a este correo.",
          ].join("\n"),
        },
      ],
    },
  });
}

function envList(name: string): string[] {
  const v = process.env[name];
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function envInt(name: string): number | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
