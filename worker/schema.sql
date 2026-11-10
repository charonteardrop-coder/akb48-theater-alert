CREATE TABLE IF NOT EXISTS subs (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  members    TEXT NOT NULL,  -- JSON配列。"*" は全公演
  applied    TEXT NOT NULL DEFAULT '[]',  -- 応募済みにした枠ID（JSON配列）。締切リマインドから外す
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
