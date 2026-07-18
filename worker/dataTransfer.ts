import { z } from 'zod';
import { isSupportedMarketplaceUrl } from './marketplace';
import type {
  CollectionArchiveManifest,
  CollectionBackup,
  CollectionBackupCard,
  CollectionBackupPriceHistory,
  CollectionImportResponse,
} from '../shared/types';

const nullableText = (maximum: number) => z.string().max(maximum).nullable();
const nullableCents = z.number().int().min(0).max(10_000_000_000).nullable();
const timestamp = z.string().min(1).max(64);

const backupCardSchema = z
  .object({
    id: z.string().min(1).max(100),
    pokemonNationalDexNumber: z.number().int().positive().max(100_000),
    cardName: z.string().min(1).max(120),
    setName: z.string().min(1).max(120),
    setCode: nullableText(24),
    cardNumber: z.string().min(1).max(40),
    rarity: nullableText(80),
    printing: z.string().min(1).max(80),
    language: z.string().min(1).max(40),
    condition: z.string().min(1).max(40),
    acquisitionDate: nullableText(10).refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value)),
    purchasePriceCents: nullableCents,
    catalogCardId: nullableText(80),
    marketPriceCents: nullableCents,
    lowPriceCents: nullableCents,
    midPriceCents: nullableCents,
    highPriceCents: nullableCents,
    priceUpdatedAt: nullableText(40),
    tcgplayerUrl: nullableText(500).refine((value) => !value || isSupportedMarketplaceUrl(value)),
    notes: nullableText(4000),
    isCurrent: z.boolean(),
    addedAt: timestamp,
    updatedAt: timestamp,
    replacedAt: timestamp.nullable(),
    retiredReason: z.enum(['replaced', 'removed', 'restored']).nullable(),
    hadImage: z.boolean(),
  })
  .strict();

const priceHistorySchema = z
  .object({
    catalogCardId: z.string().min(1).max(80),
    printing: z.string().min(1).max(80),
    marketPriceCents: nullableCents,
    lowPriceCents: nullableCents,
    midPriceCents: nullableCents,
    highPriceCents: nullableCents,
    sourceUpdatedAt: timestamp,
    capturedAt: timestamp,
  })
  .strict();

const collectionArchiveSchema = z
  .object({
    format: z.literal('dexfolio-collection'),
    version: z.literal(2),
    exportedAt: timestamp,
    cards: z.array(backupCardSchema).max(10_000),
    priceHistory: z.array(priceHistorySchema).max(50_000),
    images: z
      .array(
        z
          .object({
            cardId: z.string().min(1).max(100),
            path: z.string().min(1).max(500),
            contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();

export class CollectionBackupError extends Error {}

export async function exportCollectionBackup(db: D1Database): Promise<CollectionBackup> {
  const [cards, priceHistory] = await Promise.all([
    db
      .prepare(
        `SELECT c.id, p.national_dex_number, c.card_name, c.set_name, c.set_code, c.card_number, c.rarity,
        c.printing, c.language, c.condition, c.acquisition_date, c.purchase_price_cents, c.catalog_card_id,
        c.market_price_cents, c.low_price_cents, c.mid_price_cents, c.high_price_cents, c.price_updated_at,
        c.tcgplayer_url, c.notes, c.is_current, c.added_at, c.updated_at, c.replaced_at, c.retired_reason,
        CASE WHEN c.image_key IS NULL THEN 0 ELSE 1 END AS had_image
        FROM owned_cards c JOIN pokemon p ON p.id = c.pokemon_id
        ORDER BY p.national_dex_number, c.added_at, c.id`,
      )
      .all<BackupCardRow>(),
    db
      .prepare(
        `SELECT catalog_card_id, printing, market_price_cents, low_price_cents, mid_price_cents,
        high_price_cents, source_updated_at, captured_at
        FROM catalog_price_history ORDER BY catalog_card_id, printing, source_updated_at`,
      )
      .all<BackupPriceRow>(),
  ]);

  return {
    format: 'dexfolio-collection',
    version: 1,
    exportedAt: new Date().toISOString(),
    cards: cards.results.map(mapBackupCard),
    priceHistory: priceHistory.results.map(mapPriceHistory),
  };
}

export async function importCollectionBackup(
  db: D1Database,
  value: unknown,
  importedImages = new Map<string, ImportedImage>(),
): Promise<CollectionImportResponse> {
  const backup = await validateCollectionBackup(db, value);

  const statements: D1PreparedStatement[] = [
    db.prepare(
      "UPDATE collection_slots SET current_card_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    ),
    db.prepare('DELETE FROM owned_cards'),
    db.prepare('DELETE FROM catalog_price_history'),
  ];
  for (const cards of chunk(backup.cards, 250)) statements.push(insertCardsStatement(db, cards, importedImages));
  const currentCards = backup.cards.filter((card) => card.isCurrent);
  if (currentCards.length) statements.push(updateCurrentSlotsStatement(db, currentCards));
  for (const prices of chunk(backup.priceHistory, 500)) statements.push(insertPricesStatement(db, prices));
  await db.batch(statements);

  return {
    cardsImported: backup.cards.length,
    currentCards: currentCards.length,
    priceHistoryImported: backup.priceHistory.length,
    imagesImported: importedImages.size,
    skippedImages: backup.cards.filter((card) => card.hadImage && !importedImages.has(card.id)).length,
    importedAt: new Date().toISOString(),
  };
}

export async function validateCollectionBackup(db: D1Database, value: unknown): Promise<CollectionArchiveManifest> {
  const parsed = collectionArchiveSchema.safeParse(value);
  if (!parsed.success) throw new CollectionBackupError('Use a valid Dexfolio ZIP backup.');
  const backup = parsed.data;
  const pokemon = await db.prepare('SELECT national_dex_number FROM pokemon').all<{ national_dex_number: number }>();
  const storedNumbers = new Set(pokemon.results.map((row) => row.national_dex_number));
  const cardIds = new Set<string>();
  const currentNumbers = new Set<number>();
  for (const card of backup.cards) {
    if (cardIds.has(card.id)) throw new CollectionBackupError('The backup contains duplicate card IDs.');
    cardIds.add(card.id);
    if (!storedNumbers.has(card.pokemonNationalDexNumber)) {
      throw new CollectionBackupError(
        `Pokédex #${card.pokemonNationalDexNumber} is not stored. Update the Pokédex before importing.`,
      );
    }
    if (card.isCurrent) {
      if (currentNumbers.has(card.pokemonNationalDexNumber)) {
        throw new CollectionBackupError('The backup contains more than one current card for a Pokémon.');
      }
      if (card.replacedAt || card.retiredReason) {
        throw new CollectionBackupError('A current card cannot be marked as retired.');
      }
      currentNumbers.add(card.pokemonNationalDexNumber);
    }
  }
  const priceKeys = new Set<string>();
  for (const price of backup.priceHistory) {
    const key = `${price.catalogCardId}\u0000${price.printing}\u0000${price.sourceUpdatedAt}`;
    if (priceKeys.has(key)) throw new CollectionBackupError('The backup contains duplicate price snapshots.');
    priceKeys.add(key);
  }
  const imageCards = new Set<string>();
  const imagePaths = new Set<string>();
  for (const image of backup.images) {
    if (!cardIds.has(image.cardId)) {
      throw new CollectionBackupError('The backup contains an image for an unknown card.');
    }
    if (imageCards.has(image.cardId) || imagePaths.has(image.path)) {
      throw new CollectionBackupError('The backup contains duplicate image entries.');
    }
    imageCards.add(image.cardId);
    imagePaths.add(image.path);
  }
  return backup;
}

function insertCardsStatement(
  db: D1Database,
  cards: CollectionBackupCard[],
  importedImages: Map<string, ImportedImage>,
): D1PreparedStatement {
  const records = cards.map((card) => ({
    ...card,
    imageKey: importedImages.get(card.id)?.key ?? null,
    imageContentType: importedImages.get(card.id)?.contentType ?? null,
  }));
  return db
    .prepare(
      `INSERT INTO owned_cards (
        id, pokemon_id, card_name, set_name, set_code, card_number, rarity, printing, language, condition,
        acquisition_date, purchase_price_cents, catalog_card_id, market_price_cents, low_price_cents,
        mid_price_cents, high_price_cents, price_updated_at, tcgplayer_url, notes, image_key, image_content_type,
        is_current, added_at, updated_at, replaced_at, retired_reason
      )
      SELECT json_extract(card.value, '$.id'), p.id, json_extract(card.value, '$.cardName'),
        json_extract(card.value, '$.setName'), json_extract(card.value, '$.setCode'),
        json_extract(card.value, '$.cardNumber'), json_extract(card.value, '$.rarity'),
        json_extract(card.value, '$.printing'), json_extract(card.value, '$.language'),
        json_extract(card.value, '$.condition'), json_extract(card.value, '$.acquisitionDate'),
        json_extract(card.value, '$.purchasePriceCents'), json_extract(card.value, '$.catalogCardId'),
        json_extract(card.value, '$.marketPriceCents'), json_extract(card.value, '$.lowPriceCents'),
        json_extract(card.value, '$.midPriceCents'), json_extract(card.value, '$.highPriceCents'),
        json_extract(card.value, '$.priceUpdatedAt'), json_extract(card.value, '$.tcgplayerUrl'),
        json_extract(card.value, '$.notes'), json_extract(card.value, '$.imageKey'),
        json_extract(card.value, '$.imageContentType'), json_extract(card.value, '$.isCurrent'),
        json_extract(card.value, '$.addedAt'), json_extract(card.value, '$.updatedAt'),
        json_extract(card.value, '$.replacedAt'), json_extract(card.value, '$.retiredReason')
      FROM json_each(?) card
      JOIN pokemon p ON p.national_dex_number = json_extract(card.value, '$.pokemonNationalDexNumber')`,
    )
    .bind(JSON.stringify(records));
}

function updateCurrentSlotsStatement(db: D1Database, cards: CollectionBackupCard[]): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE collection_slots
      SET current_card_id = (
        SELECT json_extract(card.value, '$.id') FROM json_each(?) card
        JOIN pokemon p ON p.national_dex_number = json_extract(card.value, '$.pokemonNationalDexNumber')
        WHERE p.id = collection_slots.pokemon_id
      ), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE pokemon_id IN (
        SELECT p.id FROM json_each(?) card
        JOIN pokemon p ON p.national_dex_number = json_extract(card.value, '$.pokemonNationalDexNumber')
      )`,
    )
    .bind(JSON.stringify(cards), JSON.stringify(cards));
}

function insertPricesStatement(db: D1Database, prices: CollectionBackupPriceHistory[]): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO catalog_price_history (
        catalog_card_id, printing, market_price_cents, low_price_cents, mid_price_cents, high_price_cents,
        source_updated_at, captured_at
      )
      SELECT json_extract(price.value, '$.catalogCardId'), json_extract(price.value, '$.printing'),
        json_extract(price.value, '$.marketPriceCents'), json_extract(price.value, '$.lowPriceCents'),
        json_extract(price.value, '$.midPriceCents'), json_extract(price.value, '$.highPriceCents'),
        json_extract(price.value, '$.sourceUpdatedAt'), json_extract(price.value, '$.capturedAt')
      FROM json_each(?) price`,
    )
    .bind(JSON.stringify(prices));
}

function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );
}

interface BackupCardRow {
  id: string;
  national_dex_number: number;
  card_name: string;
  set_name: string;
  set_code: string | null;
  card_number: string;
  rarity: string | null;
  printing: string;
  language: string;
  condition: string;
  acquisition_date: string | null;
  purchase_price_cents: number | null;
  catalog_card_id: string | null;
  market_price_cents: number | null;
  low_price_cents: number | null;
  mid_price_cents: number | null;
  high_price_cents: number | null;
  price_updated_at: string | null;
  tcgplayer_url: string | null;
  notes: string | null;
  is_current: number;
  added_at: string;
  updated_at: string;
  replaced_at: string | null;
  retired_reason: CollectionBackupCard['retiredReason'];
  had_image: number;
}

interface BackupPriceRow {
  catalog_card_id: string;
  printing: string;
  market_price_cents: number | null;
  low_price_cents: number | null;
  mid_price_cents: number | null;
  high_price_cents: number | null;
  source_updated_at: string;
  captured_at: string;
}

export interface ImportedImage {
  key: string;
  contentType: CollectionArchiveManifest['images'][number]['contentType'];
}

function mapBackupCard(row: BackupCardRow): CollectionBackupCard {
  return {
    id: row.id,
    pokemonNationalDexNumber: row.national_dex_number,
    cardName: row.card_name,
    setName: row.set_name,
    setCode: row.set_code,
    cardNumber: row.card_number,
    rarity: row.rarity,
    printing: row.printing,
    language: row.language,
    condition: row.condition,
    acquisitionDate: row.acquisition_date,
    purchasePriceCents: row.purchase_price_cents,
    catalogCardId: row.catalog_card_id,
    marketPriceCents: row.market_price_cents,
    lowPriceCents: row.low_price_cents,
    midPriceCents: row.mid_price_cents,
    highPriceCents: row.high_price_cents,
    priceUpdatedAt: row.price_updated_at,
    tcgplayerUrl: row.tcgplayer_url,
    notes: row.notes,
    isCurrent: Boolean(row.is_current),
    addedAt: row.added_at,
    updatedAt: row.updated_at,
    replacedAt: row.replaced_at,
    retiredReason: row.retired_reason,
    hadImage: Boolean(row.had_image),
  };
}

function mapPriceHistory(row: BackupPriceRow): CollectionBackupPriceHistory {
  return {
    catalogCardId: row.catalog_card_id,
    printing: row.printing,
    marketPriceCents: row.market_price_cents,
    lowPriceCents: row.low_price_cents,
    midPriceCents: row.mid_price_cents,
    highPriceCents: row.high_price_cents,
    sourceUpdatedAt: row.source_updated_at,
    capturedAt: row.captured_at,
  };
}
