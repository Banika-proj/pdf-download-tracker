-- The Desk — PDF Download Tracker — D1 schema
-- Run once with: wrangler d1 execute desk-db --file=./schema.sql --remote
-- (drop --remote for local dev)

CREATE TABLE IF NOT EXISTS publications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  link         TEXT,
  frequency    TEXT NOT NULL,
  expectedDay  TEXT,
  login        TEXT,
  password     TEXT,
  isActive     INTEGER NOT NULL DEFAULT 1,
  deletedAt    TEXT
);

CREATE TABLE IF NOT EXISTS logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  publicationId   INTEGER NOT NULL,
  logDate         TEXT NOT NULL,
  downloaded      TEXT NOT NULL,       -- 'Y' | 'N' | 'W'
  timeDownloaded  TEXT,
  reasonWhenNo    TEXT,
  createdAt       TEXT,
  createdBy       TEXT,
  UNIQUE(publicationId, logDate)
);

CREATE TABLE IF NOT EXISTS notes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  publicationId  INTEGER NOT NULL,
  entryDate      TEXT NOT NULL,
  noteDate       TEXT,
  comment        TEXT NOT NULL,
  createdAt      TEXT,
  createdBy      TEXT
);

CREATE INDEX IF NOT EXISTS idx_logs_pub_date ON logs(publicationId, logDate);
CREATE INDEX IF NOT EXISTS idx_notes_pub_entry ON notes(publicationId, entryDate);
