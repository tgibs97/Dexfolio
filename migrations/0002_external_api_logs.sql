CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO app_settings (key, value) VALUES ('external_api_logging_enabled', '1');

CREATE TABLE external_api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  status_code INTEGER,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  error_message TEXT,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_external_api_logs_requested_at ON external_api_logs(requested_at DESC, id DESC);
