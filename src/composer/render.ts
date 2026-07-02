import { createHash } from "node:crypto";
import type { AgentConfig, MessageTemplate } from "../config/agent.js";
import type { RawListing } from "../ingestion/types.js";

export interface RenderedMessage {
  template: MessageTemplate;
  /** Ordered values for the Meta template's {{1}}, {{2}}, ... slots. */
  variables: string[];
  /** Human-readable rendering for dry-run review and the audit trail. */
  preview: string;
}

/** Named variables a template may reference. Everything falls back to a
 *  neutral value so an approved template never renders with an empty slot
 *  (Meta rejects empty parameters). */
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
  };
}

/** Deterministic A/B variant selection: the same phone always gets the same
 *  variant, so retries can't flip templates mid-conversation, and the split
 *  is uniform across contacts. */
export function pickTemplate(templates: MessageTemplate[], phoneE164: string): MessageTemplate {
  const digest = createHash("sha256").update(phoneE164).digest();
  const idx = digest.readUInt32BE(0) % templates.length;
  const t = templates[idx];
  if (!t) throw new Error("no templates configured");
  return t;
}

export function render(agent: AgentConfig, listing: RawListing, phoneE164: string): RenderedMessage {
  const template = pickTemplate(agent.whatsapp.templates, phoneE164);
  const pool = buildVariablePool(agent, listing);
  const variables = template.variables.map((name) => {
    const v = pool[name];
    if (v === undefined) throw new Error(`Template "${template.name}" references unknown variable "${name}"`);
    return v;
  });
  const preview = template.preview.replace(/\{\{(\w+)\}\}/g, (m, name: string) => pool[name] ?? m);
  return { template, variables, preview };
}
