CREATE TABLE catalog_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);
