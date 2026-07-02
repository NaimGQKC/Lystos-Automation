-- Every listing we have ever seen, keyed on the source's stable listing id.
-- The PK is what makes re-ingestion (scraper overlap, restarts) idempotent.
CREATE TABLE IF NOT EXISTS listings (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  source        TEXT NOT NULL,
  url           TEXT,
  title         TEXT,
  price         INTEGER,
  zone          TEXT,
  property_type TEXT,
  rooms         INTEGER,
  sqm           INTEGER,
  owner_name    TEXT,
  owner_phone   TEXT,
  is_private_owner INTEGER,
  raw           TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new',   -- new | queued | skipped
  skip_reason   TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Global contact ledger: one row per phone number, across ALL agents.
-- A phone in this table has been claimed for outreach; inserting is how a
-- pipeline run reserves it, so the same owner is never messaged twice even
-- if they relist, change portal, or match two agents' filters.
CREATE TABLE IF NOT EXISTS contacts (
  phone_e164        TEXT PRIMARY KEY,
  first_listing_id  TEXT,
  first_agent_id    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  opted_out         INTEGER NOT NULL DEFAULT 0,
  opted_out_at      TEXT
);

-- Outbox: the send queue. Workers only ever act on rows here, so a crash
-- between "decided to send" and "sent" can never lose or duplicate a message.
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        TEXT NOT NULL,
  listing_id      TEXT NOT NULL,
  phone_e164      TEXT NOT NULL,
  template_name   TEXT NOT NULL,      -- Meta-approved template name
  language        TEXT NOT NULL,
  variables       TEXT NOT NULL,      -- JSON array, ordered as {{1}},{{2}},...
  preview         TEXT NOT NULL,      -- human-readable rendering for review
  status          TEXT NOT NULL DEFAULT 'pending',
                  -- pending | sent | delivered | read | failed | dry_run | blocked
  wa_message_id   TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at         TEXT,
  UNIQUE (agent_id, phone_e164)
);

-- Replies and delivery callbacks from the WhatsApp webhook.
CREATE TABLE IF NOT EXISTS inbound (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL DEFAULT (datetime('now')),
  phone_e164    TEXT NOT NULL,
  body          TEXT,
  wa_message_id TEXT UNIQUE
);

-- Append-only audit log. Doubles as the GDPR accountability record.
CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL DEFAULT (datetime('now')),
  type     TEXT NOT NULL,
  agent_id TEXT,
  payload  TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_pending
  ON messages (status, next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_listings_agent ON listings (agent_id, first_seen_at);
