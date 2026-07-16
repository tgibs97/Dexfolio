import type {
  BinderResponse,
  CardPriceHistoryResponse,
  CollectionSummary,
  OwnedCard,
  PokemonDetail,
  PokemonSlot,
  PriceChange,
  PriceHistoryPoint,
  PriceHistoryRange,
  SortOption,
} from '../shared/types';

interface SlotRow {
  id: number;
  national_dex_number: number;
  name: string;
  generation: number;
  reference_image_url: string;
  slot_updated_at: string | null;
  card_id: string | null;
  card_name: string | null;
  set_name: string | null;
  set_code: string | null;
  card_number: string | null;
  rarity: string | null;
  printing: string | null;
  language: string | null;
  condition: string | null;
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
  image_key: string | null;
  is_current: number | null;
  added_at: string | null;
  updated_at: string | null;
  replaced_at: string | null;
  retired_reason: OwnedCard['retiredReason'];
}

interface CardRow {
  id: string;
  pokemon_id: number;
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
  image_key: string | null;
  is_current: number;
  added_at: string;
  updated_at: string;
  replaced_at: string | null;
  retired_reason: OwnedCard['retiredReason'];
}

const sortSql: Record<SortOption, string> = {
  'number-asc': 'p.national_dex_number ASC',
  'number-desc': 'p.national_dex_number DESC',
  'name-asc': 'p.name COLLATE NOCASE ASC',
  'name-desc': 'p.name COLLATE NOCASE DESC',
  'added-desc': '(c.added_at IS NULL) ASC, c.added_at DESC, p.national_dex_number ASC',
  'added-asc': '(c.added_at IS NULL) ASC, c.added_at ASC, p.national_dex_number ASC',
  'paid-desc': '(c.purchase_price_cents IS NULL) ASC, c.purchase_price_cents DESC, p.national_dex_number ASC',
  'paid-asc': '(c.purchase_price_cents IS NULL) ASC, c.purchase_price_cents ASC, p.national_dex_number ASC',
  'value-desc': '(c.market_price_cents IS NULL) ASC, c.market_price_cents DESC, p.national_dex_number ASC',
  'value-asc': '(c.market_price_cents IS NULL) ASC, c.market_price_cents ASC, p.national_dex_number ASC',
};

const selectSlots = `
SELECT p.id, p.national_dex_number, p.name, p.generation, p.reference_image_url,
  s.updated_at AS slot_updated_at, c.id AS card_id, c.card_name, c.set_name, c.set_code,
  c.card_number, c.rarity, c.printing, c.language, c.condition, c.acquisition_date,
  c.purchase_price_cents, c.catalog_card_id, c.market_price_cents, c.low_price_cents,
  c.mid_price_cents, c.high_price_cents, c.price_updated_at, c.tcgplayer_url, c.notes, c.image_key, c.is_current, c.added_at, c.updated_at,
  c.replaced_at, c.retired_reason
FROM pokemon p
JOIN collection_slots s ON s.pokemon_id = p.id
LEFT JOIN owned_cards c ON c.id = s.current_card_id`;

function mapCard(row: SlotRow | CardRow): OwnedCard | null {
  const id = 'card_id' in row ? row.card_id : row.id;
  if (!id) return null;
  const pokemonId = 'pokemon_id' in row ? row.pokemon_id : row.id;
  const cardName = row.card_name;
  const setName = row.set_name;
  const cardNumber = row.card_number;
  const printing = row.printing;
  const language = row.language;
  const condition = row.condition;
  const addedAt = row.added_at;
  const updatedAt = row.updated_at;
  if (!cardName || !setName || !cardNumber || !printing || !language || !condition || !addedAt || !updatedAt)
    return null;
  return {
    id,
    pokemonId,
    cardName,
    setName,
    setCode: row.set_code,
    cardNumber,
    rarity: row.rarity,
    printing,
    language,
    condition,
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
    imageUrl: row.image_key ? `/api/images/${row.image_key}` : null,
    isCurrent: Boolean(row.is_current),
    addedAt,
    updatedAt,
    replacedAt: row.replaced_at,
    retiredReason: row.retired_reason,
  };
}

function mapSlot(row: SlotRow): PokemonSlot {
  return {
    id: row.id,
    nationalDexNumber: row.national_dex_number,
    name: row.name,
    generation: row.generation,
    referenceImageUrl: row.reference_image_url,
    status: row.card_id ? 'collected' : 'missing',
    currentCard: mapCard(row),
    updatedAt: row.slot_updated_at,
  };
}

async function getSummary(db: D1Database): Promise<CollectionSummary> {
  const [results, financials, highestValue, lowestValue] = await Promise.all([
    db
      .prepare(
        `SELECT p.generation, COUNT(*) AS total, COUNT(s.current_card_id) AS collected
    FROM pokemon p JOIN collection_slots s ON s.pokemon_id = p.id GROUP BY p.generation ORDER BY p.generation`,
      )
      .all<{ generation: number; total: number; collected: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(c.purchase_price_cents), 0) AS total_spent_cents,
        COALESCE(SUM(c.market_price_cents), 0) AS total_value_cents,
        ROUND(AVG(c.market_price_cents)) AS average_card_value_cents
        FROM collection_slots s JOIN owned_cards c ON c.id = s.current_card_id`,
      )
      .first<{
        total_spent_cents: number;
        total_value_cents: number;
        average_card_value_cents: number | null;
      }>(),
    getValueExtreme(db, 'DESC'),
    getValueExtreme(db, 'ASC'),
  ]);
  const generations = results.results.map((row) => ({
    ...row,
    percentage: row.total ? Math.round((row.collected / row.total) * 1000) / 10 : 0,
  }));
  const total = generations.reduce((sum, row) => sum + row.total, 0);
  const collected = generations.reduce((sum, row) => sum + row.collected, 0);
  return {
    total,
    collected,
    percentage: total ? Math.round((collected / total) * 1000) / 10 : 0,
    generations,
    totalSpentCents: financials?.total_spent_cents ?? 0,
    totalValueCents: financials?.total_value_cents ?? 0,
    averageCardValueCents: financials?.average_card_value_cents ?? null,
    highestValueCard: highestValue,
    lowestValueCard: lowestValue,
  };
}

async function getValueExtreme(
  db: D1Database,
  direction: 'ASC' | 'DESC',
): Promise<CollectionSummary['highestValueCard']> {
  const row = await db
    .prepare(
      `SELECT c.id, p.id AS pokemon_id, p.name AS pokemon_name, c.card_name, c.market_price_cents
      FROM collection_slots s
      JOIN owned_cards c ON c.id = s.current_card_id
      JOIN pokemon p ON p.id = s.pokemon_id
      WHERE c.market_price_cents IS NOT NULL
      ORDER BY c.market_price_cents ${direction}, c.added_at ASC, c.id ASC LIMIT 1`,
    )
    .first<{ id: string; pokemon_id: number; pokemon_name: string; card_name: string; market_price_cents: number }>();
  return row
    ? {
        id: row.id,
        pokemonId: row.pokemon_id,
        pokemonName: row.pokemon_name,
        cardName: row.card_name,
        cents: row.market_price_cents,
      }
    : null;
}

export async function listPokemon(
  db: D1Database,
  params: { q?: string; status?: string; generation?: number; sort: SortOption },
): Promise<BinderResponse> {
  const where: string[] = [];
  const bindings: unknown[] = [];
  if (params.q) {
    const number = Number(params.q);
    if (Number.isInteger(number) && String(number) === params.q.trim()) {
      where.push('p.national_dex_number = ?');
      bindings.push(number);
    } else {
      where.push("p.name LIKE ? ESCAPE '\\'");
      bindings.push(`%${params.q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`);
    }
  }
  if (params.status === 'collected') where.push('s.current_card_id IS NOT NULL');
  if (params.status === 'missing') where.push('s.current_card_id IS NULL');
  if (params.generation) {
    where.push('p.generation = ?');
    bindings.push(params.generation);
  }
  const query = `${selectSlots} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sortSql[params.sort]}`;
  const [rows, summary] = await Promise.all([
    db
      .prepare(query)
      .bind(...bindings)
      .all<SlotRow>(),
    getSummary(db),
  ]);
  return { pokemon: rows.results.map(mapSlot), summary };
}

export async function getPokemonDetail(db: D1Database, id: number): Promise<PokemonDetail | null> {
  const row = await db.prepare(`${selectSlots} WHERE p.id = ?`).bind(id).first<SlotRow>();
  if (!row) return null;
  const history = await db
    .prepare(
      'SELECT * FROM owned_cards WHERE pokemon_id = ? AND is_current = 0 ORDER BY COALESCE(replaced_at, updated_at) DESC',
    )
    .bind(id)
    .all<CardRow>();
  return { ...mapSlot(row), history: history.results.map(mapCard).filter((card): card is OwnedCard => card !== null) };
}

export async function getCardRow(db: D1Database, id: string): Promise<CardRow | null> {
  return db.prepare('SELECT * FROM owned_cards WHERE id = ?').bind(id).first<CardRow>();
}

/** Returns one owned card's TCGplayer timeline and purchase-to-market gain. */
export async function getCardPriceHistory(
  db: D1Database,
  id: string,
  range: PriceHistoryRange,
): Promise<CardPriceHistoryResponse | null> {
  const card = await getCardRow(db, id);
  if (!card) return null;

  let history: PriceHistoryPoint[] = [];
  if (card.catalog_card_id) {
    const rows = await db
      .prepare(
        `SELECT market_price_cents, low_price_cents, mid_price_cents, high_price_cents,
        source_updated_at, captured_at
        FROM catalog_price_history
        WHERE catalog_card_id = ? AND printing = ?
        ORDER BY source_updated_at ASC, captured_at ASC`,
      )
      .bind(card.catalog_card_id, card.printing)
      .all<{
        market_price_cents: number | null;
        low_price_cents: number | null;
        mid_price_cents: number | null;
        high_price_cents: number | null;
        source_updated_at: string;
        captured_at: string;
      }>();
    history = rows.results
      .map((row) => ({
        marketPriceCents: row.market_price_cents,
        lowPriceCents: row.low_price_cents,
        midPriceCents: row.mid_price_cents,
        highPriceCents: row.high_price_cents,
        sourceUpdatedAt: row.source_updated_at,
        capturedAt: row.captured_at,
      }))
      .sort((left, right) => pointTimestamp(left) - pointTimestamp(right));
  }

  const currentMarketCents = card.market_price_cents;
  const purchasePriceCents = card.purchase_price_cents;
  const unrealizedGainCents =
    currentMarketCents === null || purchasePriceCents === null ? null : currentMarketCents - purchasePriceCents;
  const latestTimestamp = history.length ? pointTimestamp(history[history.length - 1]) : Date.now();
  const rangeDays = { '30d': 30, '90d': 90, '1y': 365, all: null }[range];
  const visibleHistory =
    rangeDays === null
      ? history
      : history.filter((point) => pointTimestamp(point) >= latestTimestamp - rangeDays * 86_400_000);

  return {
    cardId: card.id,
    catalogCardId: card.catalog_card_id,
    printing: card.printing,
    purchasePriceCents,
    currentMarketCents,
    unrealizedGainCents,
    unrealizedGainPercentage:
      unrealizedGainCents === null || !purchasePriceCents
        ? null
        : Math.round((unrealizedGainCents / purchasePriceCents) * 10_000) / 100,
    change7d: priceChange(history, currentMarketCents, latestTimestamp, 7),
    change30d: priceChange(history, currentMarketCents, latestTimestamp, 30),
    history: visibleHistory,
  };
}

function pointTimestamp(point: PriceHistoryPoint): number {
  const source = Date.parse(point.sourceUpdatedAt.replaceAll('/', '-'));
  if (Number.isFinite(source)) return source;
  const captured = Date.parse(point.capturedAt);
  return Number.isFinite(captured) ? captured : 0;
}

function priceChange(
  history: PriceHistoryPoint[],
  currentMarketCents: number | null,
  latestTimestamp: number,
  days: number,
): PriceChange | null {
  if (currentMarketCents === null) return null;
  const target = latestTimestamp - days * 86_400_000;
  const baseline = history
    .filter((point) => point.marketPriceCents !== null && pointTimestamp(point) <= target)
    .at(-1)?.marketPriceCents;
  if (baseline === null || baseline === undefined) return null;
  const cents = currentMarketCents - baseline;
  return {
    cents,
    percentage: baseline ? Math.round((cents / baseline) * 10_000) / 100 : null,
  };
}
