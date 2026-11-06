-- Technamooz AI v2.0.0 — structured provider error observability
-- Secrets and prompt contents are intentionally excluded.
CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  status INTEGER DEFAULT 0,
  code TEXT,
  message TEXT NOT NULL,
  duration_ms INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_provider ON error_logs(provider, created_at DESC);
