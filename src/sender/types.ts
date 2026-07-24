export interface SendResult {
  ok: boolean;
  /** WhatsApp message id, SMTP message id, or IMAP draft UID. */
  providerRef?: string;
  /** true = worth retrying (network, 429, 5xx); false = permanent. */
  retryable?: boolean;
  error?: string;
}

/** What the worker hands to a channel adapter. */
export interface OutboundMessage {
  to: string;
  templateName: string;
  language: string;
  subject?: string;
  variables: string[];
  body: string;
}
