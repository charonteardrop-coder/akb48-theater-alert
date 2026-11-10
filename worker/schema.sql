CREATE TABLE IF NOT EXISTS subs (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  members    TEXT NOT NULL,  -- JSON配列。"*" は全公演
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
