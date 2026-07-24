import { createHash } from "node:crypto";
import type { AgentConfig } from "../config/agent.js";
import type { RawListing } from "../ingestion/types.js";

export interface RenderedMessage {
  channel: "email" | "whatsapp";
  templateName: string;
  language: string;
  /** Email only. */
  subject?: string;
  /** WhatsApp: ordered values for {{1}}, {{2}}, … Email: [] (already inlined). */
  variables: string[];
  /** Rendered body (email) or human-readable preview (whatsapp). */
  preview: string;
}

/** Named variables a template may reference. Everything falls back to a
 *  neutral value so a message never renders with an empty slot. */
export function buildVariablePool(agent: AgentConfig, listing: RawListing): Record<string, string> {
  const rooms = listing.rooms !== undefined ? `${listing.rooms} hab.` : "";
  const sqm = listing.sqm !== undefined ? `${listing.sqm} m²` : "";
  const type = listing.propertyType ?? "inmueble";
  const propertyLabel = [type, [rooms, sqm].filter(Boolean).join(", ")].filter(Boolean).join(" de ");
  return {
    ownerName: listing.ownerName?.trim() || "propietario/a",
    agentName: agent.name,
    zone: listing.zone ?? "tu zona",
    price: listing.price !== undefined ? `${listing.price.toLocaleString("es-ES")} €` : "el precio publicado",
    propertyLabel,
    title: listing.title ?? propertyLabel,
    listingUrl: listing.url ?? "",
  };
}

export function fill(text: string, pool: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, name: string) => pool[name] ?? m);
}

/** Deterministic A/B variant selection: the same contact always gets the same
 *  variant, so retries can't flip templates, and the split is uniform. */
export function pickIndex(count: number, contactKey: string): number {
  const digest = createHash("sha256").update(contactKey).digest();
  return digest.readUInt32BE(0) % count;
}

export function render(agent: AgentConfig, listing: RawListing, contactKey: string): RenderedMessage {
  const pool = buildVariablePool(agent, listing);

  if (agent.channel === "email") {
    const templates = agent.email!.templates;
    const t = templates[pickIndex(templates.length, contactKey)]!;
    return {
      channel: "email",
      templateName: t.name,
      language: t.language,
      subject: fill(t.subject, pool),
      variables: [],
      preview: fill(t.body, pool),
    };
  }

  const templates = agent.whatsapp!.templates;
  const t = templates[pickIndex(templates.length, contactKey)]!;
  const variables = t.variables.map((name) => {
    const v = pool[name];
    if (v === undefined) throw new Error(`Template "${t.name}" references unknown variable "${name}"`);
    return v;
  });
  return {
    channel: "whatsapp",
    templateName: t.metaTemplateName,
    language: t.language,
    variables,
    preview: fill(t.preview, pool),
  };
}
