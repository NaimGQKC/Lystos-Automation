import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import type { AgentConfig } from "../config/agent.js";
import { requireEnv } from "../env.js";
import type { SendResult } from "./types.js";

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

function buildMail(agent: AgentConfig, msg: EmailMessage) {
  const cfg = agent.email!;
  return {
    from: requireEnv(cfg.fromEnv),
    to: msg.to,
    replyTo: cfg.replyTo,
    subject: msg.subject,
    text: msg.body,
  };
}

/** Write the message to the agent's Drafts folder instead of sending it.
 *  This is the safe mode: she opens her mail client, reviews each draft, and
 *  presses send herself. Nothing reaches an owner without a human deciding. */
export async function draftEmail(agent: AgentConfig, msg: EmailMessage): Promise<SendResult> {
  const cfg = agent.email!;
  const user = requireEnv(cfg.userEnv);
  const pass = requireEnv(cfg.passwordEnv);

  let client: ImapFlow | undefined;
  try {
    // MailComposer produces the raw MIME that IMAP APPEND expects.
    const raw = await new Promise<Buffer>((resolve, reject) => {
      const composer = nodemailer.createTransport({ streamTransport: true, buffer: true });
      composer.sendMail(buildMail(agent, msg), (err, info) => {
        if (err) reject(err);
        else resolve(info.message as Buffer);
      });
    });

    client = new ImapFlow({
      host: cfg.imapHost,
      port: cfg.imapPort,
      secure: true,
      auth: { user, pass },
      logger: false,
    });
    await client.connect();
    const res = await client.append(cfg.draftsMailbox, raw, ["\\Draft", "\\Seen"]);
    return { ok: true, providerRef: res && "uid" in res ? String(res.uid) : "drafted" };
  } catch (err) {
    return { ok: false, retryable: true, error: `imap: ${String(err)}` };
  } finally {
    await client?.logout().catch(() => {});
  }
}

/** Deliver directly via SMTP. Only used once mode is flipped to "send". */
export async function sendEmail(agent: AgentConfig, msg: EmailMessage): Promise<SendResult> {
  const cfg = agent.email!;
  try {
    const transport = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpPort === 465,
      auth: { user: requireEnv(cfg.userEnv), pass: requireEnv(cfg.passwordEnv) },
    });
    const info = await transport.sendMail(buildMail(agent, msg));
    return { ok: true, providerRef: info.messageId };
  } catch (err) {
    const text = String(err);
    // 5xx SMTP replies are permanent (bad address, rejected); 4xx are transient.
    const permanent = /\b5\d\d\b/.test(text);
    return { ok: false, retryable: !permanent, error: `smtp: ${text}` };
  }
}

export function deliverEmail(agent: AgentConfig, msg: EmailMessage): Promise<SendResult> {
  return agent.email!.mode === "send" ? sendEmail(agent, msg) : draftEmail(agent, msg);
}
