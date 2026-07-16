export type CollectionStatus = 'collected' | 'missing';
export type SortOption =
  | 'number-asc'
  | 'number-desc'
  | 'name-asc'
  | 'name-desc'
  | 'added-desc'
  | 'added-asc'
  | 'paid-desc'
  | 'paid-asc'
  | 'value-desc'
  | 'value-asc';

export interface OwnedCard {
  id: string;
  pokemonId: number;
  cardName: string;
  setName: string;
  setCode: string | null;
  cardNumber: string;
  rarity: string | null;
  printing: string;
  language: string;
  condition: string;
  acquisitionDate: string | null;
  purchasePriceCents: number | null;
  catalogCardId: string | null;
  marketPriceCents: number | null;
  lowPriceCents: number | null;
  midPriceCents: number | null;
  highPriceCents: number | null;
  priceUpdatedAt: string | null;
  tcgplayerUrl: string | null;
  notes: string | null;
  imageUrl: string | null;
  isCurrent: boolean;
  addedAt: string;
  updatedAt: string;
  replacedAt: string | null;
  retiredReason: 'replaced' | 'removed' | 'restored' | null;
}

export interface PokemonSlot {
  id: number;
  nationalDexNumber: number;
  name: string;
  generation: number;
  referenceImageUrl: string;
  status: CollectionStatus;
  currentCard: OwnedCard | null;
  updatedAt: string | null;
}

export interface GenerationProgress {
  generation: number;
  collected: number;
  total: number;
  percentage: number;
}

export interface CardValueSummary {
  id: string;
  pokemonId: number;
  pokemonName: string;
  cardName: string;
  cents: number;
}

export interface CollectionSummary {
  collected: number;
  total: number;
  percentage: number;
  generations: GenerationProgress[];
  totalSpentCents: number;
  totalValueCents: number;
  averageCardValueCents: number | null;
  highestValueCard: CardValueSummary | null;
  lowestValueCard: CardValueSummary | null;
}

export interface BinderResponse {
  pokemon: PokemonSlot[];
  summary: CollectionSummary;
}

export interface PokemonDetail extends PokemonSlot {
  history: OwnedCard[];
}

export type SessionRole = 'admin' | 'guest';

export interface SessionResponse {
  authenticated: boolean;
  role: SessionRole | null;
}

export interface ApiError {
  error: string;
  fieldErrors?: Record<string, string[]>;
}

export interface CardInput {
  cardName: string;
  setName: string;
  setCode?: string;
  cardNumber: string;
  rarity?: string;
  printing: string;
  language: string;
  condition: string;
  acquisitionDate?: string;
  purchasePrice?: string;
  catalogCardId?: string;
  marketPriceCents?: string;
  lowPriceCents?: string;
  midPriceCents?: string;
  highPriceCents?: string;
  priceUpdatedAt?: string;
  tcgplayerUrl?: string;
  notes?: string;
}

/** Lightweight Pokémon TCG catalog records used only for form suggestions. */
export interface CatalogSet {
  id: string;
  name: string;
  code: string;
  releaseDate: string | null;
}

export interface CatalogCard {
  id: string;
  name: string;
  number: string;
  rarity: string | null;
  availablePrintings: string[];
  suggestedPrinting: string | null;
  prices: CatalogPrice[];
  pricesUpdatedAt: string | null;
  tcgplayerUrl: string | null;
}

/** A TCGplayer price snapshot for one physical printing of a catalog card. */
export interface CatalogPrice {
  printing: string;
  lowCents: number | null;
  midCents: number | null;
  highCents: number | null;
  marketCents: number | null;
}

export interface CatalogSetsResponse {
  sets: CatalogSet[];
}

export interface CatalogCardsResponse {
  cards: CatalogCard[];
}

export interface PriceRefreshResponse {
  total: number;
  refreshed: number;
  missingCatalogId: number;
  missingPricing: number;
  refreshedAt: string;
}

export interface PokedexSyncStatus {
  stored: number;
  upstreamTotal: number;
  available: number;
  checkedAt: string;
}

export interface SyncedPokemon {
  nationalDexNumber: number;
  name: string;
  generation: number;
}

export interface PokedexSyncResponse extends PokedexSyncStatus {
  added: number;
  addedPokemon: SyncedPokemon[];
  syncedAt: string;
}

export type PriceHistoryRange = '30d' | '90d' | '1y' | 'all';

export interface PriceHistoryPoint {
  marketPriceCents: number | null;
  lowPriceCents: number | null;
  midPriceCents: number | null;
  highPriceCents: number | null;
  sourceUpdatedAt: string;
  capturedAt: string;
}

export interface PriceChange {
  cents: number;
  percentage: number | null;
}

export interface CardPriceHistoryResponse {
  cardId: string;
  catalogCardId: string | null;
  printing: string;
  purchasePriceCents: number | null;
  currentMarketCents: number | null;
  unrealizedGainCents: number | null;
  unrealizedGainPercentage: number | null;
  change7d: PriceChange | null;
  change30d: PriceChange | null;
  history: PriceHistoryPoint[];
}
