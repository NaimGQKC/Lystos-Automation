import { env, requireEnv } from "../env.js";
import type { AgentConfig } from "../config/agent.js";
import type { SendResult } from "./types.js";

export interface TemplateSend {
  to: string; // E.164
  templateName: string;
  language: string;
  variables: string[];
}

/** Thin client for the Meta WhatsApp Cloud API. Business-initiated messages
 *  MUST use an approved template — free-form text is only allowed inside the
 *  24h window after the user replies. */
export async function sendTemplate(agent: AgentConfig, msg: TemplateSend): Promise<SendResult> {
  const phoneNumberId = requireEnv(agent.whatsapp!.phoneNumberIdEnv);
  const accessToken = requireEnv(agent.whatsapp!.accessTokenEnv);
  const url = `${env.waGraphBaseUrl}/${env.waGraphVersion}/${phoneNumberId}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to: msg.to.replace("+", ""),
    type: "template",
    template: {
      name: msg.templateName,
      language: { code: msg.language },
      components: msg.variables.length
        ? [{ type: "body", parameters: msg.variables.map((text) => ({ type: "text", text })) }]
        : [],
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, retryable: true, error: `network: ${String(err)}` };
  }

  const payload = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { message?: string; code?: number };
  };

  if (res.ok && payload.messages?.[0]?.id) {
    return { ok: true, providerRef: payload.messages[0].id };
  }
  return {
    ok: false,
    retryable: res.status === 429 || res.status >= 500,
    error: `${res.status}: ${payload.error?.message ?? "unknown error"} (code ${payload.error?.code ?? "?"})`,
  };
}
