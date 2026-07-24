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
  owner_email   TEXT,
  is_private_owner INTEGER,
  raw           TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new',   -- new | queued | skipped | needs_review
  skip_reason   TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Global contact ledger: one row per contact, across ALL agents.
-- contact_key is an E.164 phone or a lowercased email address depending on
-- the channel. Inserting is how a pipeline run reserves a contact, so the
-- same owner is never messaged twice even if they relist, change portal, or
-- match two agents' filters.
CREATE TABLE IF NOT EXISTS contacts (
  contact_key       TEXT PRIMARY KEY,
  contact_type      TEXT NOT NULL,             -- phone | email
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
  channel         TEXT NOT NULL,      -- email | whatsapp
  contact_key     TEXT NOT NULL,
  template_name   TEXT NOT NULL,
  language        TEXT NOT NULL,
  subject         TEXT,               -- email only
  variables       TEXT NOT NULL,      -- JSON array (whatsapp {{1}},{{2}}…)
  preview         TEXT NOT NULL,      -- rendered body / human-readable text
  status          TEXT NOT NULL DEFAULT 'pending',
                  -- pending | drafted | sent | delivered | read | failed
                  -- | dry_run | blocked
  provider_ref    TEXT,               -- wa message id, or draft UID
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at         TEXT,
  UNIQUE (agent_id, contact_key)
);

-- Replies and delivery callbacks.
CREATE TABLE IF NOT EXISTS inbound (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL DEFAULT (datetime('now')),
  contact_key   TEXT NOT NULL,
  body          TEXT,
  provider_ref  TEXT UNIQUE
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
