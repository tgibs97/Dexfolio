PRAGMA foreign_keys = ON;

CREATE TABLE pokemon (
  id INTEGER PRIMARY KEY,
  national_dex_number INTEGER NOT NULL UNIQUE CHECK (national_dex_number > 0),
  name TEXT NOT NULL COLLATE NOCASE,
  generation INTEGER NOT NULL CHECK (generation BETWEEN 1 AND 99),
  reference_image_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX idx_pokemon_name ON pokemon(name);
CREATE INDEX idx_pokemon_generation ON pokemon(generation, national_dex_number);

CREATE TABLE collection_slots (
  pokemon_id INTEGER PRIMARY KEY REFERENCES pokemon(id) ON DELETE RESTRICT,
  current_card_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE owned_cards (
  id TEXT PRIMARY KEY,
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE RESTRICT,
  card_name TEXT NOT NULL,
  set_name TEXT NOT NULL,
  set_code TEXT,
  card_number TEXT NOT NULL,
  rarity TEXT,
  printing TEXT NOT NULL,
  language TEXT NOT NULL,
  condition TEXT NOT NULL,
  acquisition_date TEXT,
  purchase_price_cents INTEGER CHECK (purchase_price_cents IS NULL OR purchase_price_cents >= 0),
  catalog_card_id TEXT,
  market_price_cents INTEGER CHECK (market_price_cents IS NULL OR market_price_cents >= 0),
  low_price_cents INTEGER CHECK (low_price_cents IS NULL OR low_price_cents >= 0),
  mid_price_cents INTEGER CHECK (mid_price_cents IS NULL OR mid_price_cents >= 0),
  high_price_cents INTEGER CHECK (high_price_cents IS NULL OR high_price_cents >= 0),
  price_updated_at TEXT,
  tcgplayer_url TEXT,
  notes TEXT,
  image_key TEXT,
  image_content_type TEXT,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  replaced_at TEXT,
  retired_reason TEXT CHECK (retired_reason IS NULL OR retired_reason IN ('replaced', 'removed', 'restored'))
);

CREATE INDEX idx_owned_cards_pokemon ON owned_cards(pokemon_id, added_at DESC);
CREATE INDEX idx_owned_cards_catalog_card ON owned_cards(catalog_card_id);
CREATE UNIQUE INDEX idx_owned_cards_one_current ON owned_cards(pokemon_id) WHERE is_current = 1;

-- Price history belongs to the catalog card and physical printing so multiple
-- owned copies can share one trustworthy TCGplayer market timeline.
CREATE TABLE catalog_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  catalog_card_id TEXT NOT NULL,
  printing TEXT NOT NULL,
  market_price_cents INTEGER CHECK (market_price_cents IS NULL OR market_price_cents >= 0),
  low_price_cents INTEGER CHECK (low_price_cents IS NULL OR low_price_cents >= 0),
  mid_price_cents INTEGER CHECK (mid_price_cents IS NULL OR mid_price_cents >= 0),
  high_price_cents INTEGER CHECK (high_price_cents IS NULL OR high_price_cents >= 0),
  source_updated_at TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (catalog_card_id, printing, source_updated_at)
);

CREATE INDEX idx_catalog_price_history_lookup
  ON catalog_price_history(catalog_card_id, printing, source_updated_at DESC);

CREATE TRIGGER validate_collection_current_card_insert
BEFORE INSERT ON collection_slots
WHEN NEW.current_card_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM owned_cards
    WHERE id = NEW.current_card_id AND pokemon_id = NEW.pokemon_id AND is_current = 1
  ) THEN RAISE(ABORT, 'Current card must belong to the collection slot') END;
END;

CREATE TRIGGER validate_collection_current_card_update
BEFORE UPDATE OF current_card_id ON collection_slots
WHEN NEW.current_card_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM owned_cards
    WHERE id = NEW.current_card_id AND pokemon_id = NEW.pokemon_id AND is_current = 1
  ) THEN RAISE(ABORT, 'Current card must belong to the collection slot') END;
END;
