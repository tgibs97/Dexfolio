import type {
  ApiError,
  BinderResponse,
  CardPriceHistoryResponse,
  CardInput,
  CatalogCard,
  CatalogCardsResponse,
  CatalogSetsResponse,
  CollectionImportResponse,
  PokemonDetail,
  PokedexSyncResponse,
  PokedexSyncStatus,
  PriceRefreshResponse,
  PriceHistoryRange,
  SessionResponse,
  SortOption,
} from '../shared/types';

// Bump this when the lightweight catalog response shape changes so browsers do
// not reuse an older private HTTP-cache entry with missing fields.
const CATALOG_SCHEMA_VERSION = '6';

/**
 * Error shape exposed to components. `fieldErrors` lets a form put server-side
 * validation feedback next to the exact input that needs attention.
 */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

/**
 * Shared fetch wrapper for all Worker requests. It sends the signed session
 * cookie and turns non-success responses into one predictable error type.
 */
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  if (!response.ok) await throwResponseError(response);
  return response.json() as Promise<T>;
}

async function downloadRequest(url: string): Promise<BackupDownload> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) await throwResponseError(response);
  const disposition = response.headers.get('Content-Disposition') || '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || 'dexfolio-backup.zip';
  return {
    blob: await response.blob(),
    filename,
    cards: Number(response.headers.get('X-Dexfolio-Cards')) || 0,
    images: Number(response.headers.get('X-Dexfolio-Images')) || 0,
  };
}

async function throwResponseError(response: Response): Promise<never> {
  let body: ApiError = { error: `Request failed (${response.status})` };
  try {
    body = (await response.json()) as ApiError;
  } catch {
    /* Keep the status fallback. */
  }
  throw new ApiRequestError(body.error, response.status, body.fieldErrors);
}

interface BackupDownload {
  blob: Blob;
  filename: string;
  cards: number;
  images: number;
}

// Keeping endpoint details here prevents UI components from duplicating URLs
// and HTTP configuration.
export const api = {
  session: () => request<SessionResponse>('/api/session'),
  login: (password: string) =>
    request<SessionResponse>('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),
  guest: () => request<SessionResponse>('/api/session/guest', { method: 'POST' }),
  logout: () => request<SessionResponse>('/api/session', { method: 'DELETE' }),
  binder: (filters: { q: string; status: string; generation: string; sort: SortOption }, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    if (filters.q) query.set('q', filters.q);
    if (filters.status !== 'all') query.set('status', filters.status);
    if (filters.generation !== 'all') query.set('generation', filters.generation);
    query.set('sort', filters.sort);
    return request<BinderResponse>(`/api/pokemon?${query}`, { signal });
  },
  detail: (pokemonId: number) => request<PokemonDetail>(`/api/pokemon/${pokemonId}`),
  priceHistory: (cardId: string, range: PriceHistoryRange, signal?: AbortSignal) =>
    request<CardPriceHistoryResponse>(`/api/cards/${encodeURIComponent(cardId)}/price-history?range=${range}`, {
      signal,
    }),
  catalogSets: (signal?: AbortSignal) => request<CatalogSetsResponse>('/api/catalog/sets', { signal }),
  catalogCards: (setId: string, pokemonNumber: number, signal?: AbortSignal) => {
    const query = new URLSearchParams({
      setId,
      pokemonNumber: String(pokemonNumber),
      catalogVersion: CATALOG_SCHEMA_VERSION,
    });
    return request<CatalogCardsResponse>(`/api/catalog/cards?${query}`, { signal }).then(({ cards }) => ({
      // Normalizing makes an already-cached pre-v3 response safe during a
      // rolling update or when a service worker/browser retains old JSON.
      cards: cards.map((card) => {
        const legacy = card as CatalogCard & { availableVariants?: string[]; suggestedVariant?: string | null };
        return {
          ...card,
          availablePrintings: Array.isArray(card.availablePrintings)
            ? card.availablePrintings
            : Array.isArray(legacy.availableVariants)
              ? legacy.availableVariants
              : [],
          suggestedPrinting:
            typeof card.suggestedPrinting === 'string'
              ? card.suggestedPrinting
              : typeof legacy.suggestedVariant === 'string'
                ? legacy.suggestedVariant
                : null,
          prices: Array.isArray(card.prices) ? card.prices : [],
          pricesUpdatedAt: typeof card.pricesUpdatedAt === 'string' ? card.pricesUpdatedAt : null,
          tcgplayerUrl: typeof card.tcgplayerUrl === 'string' ? card.tcgplayerUrl : null,
        };
      }),
    }));
  },
  saveCard: (pokemonId: number, input: CardInput, image: File | null, mode: 'add' | 'replace') => {
    const form = toFormData(input, image);
    form.set('mode', mode);
    return request<PokemonDetail>(`/api/pokemon/${pokemonId}/cards`, { method: 'POST', body: form });
  },
  editCard: (cardId: string, input: CardInput, image: File | null) =>
    request<PokemonDetail>(`/api/cards/${cardId}`, { method: 'PATCH', body: toFormData(input, image) }),
  restoreCard: (pokemonId: number, cardId: string) =>
    request<PokemonDetail>(`/api/pokemon/${pokemonId}/cards/${cardId}/restore`, { method: 'POST' }),
  removeCard: (pokemonId: number) => request<PokemonDetail>(`/api/pokemon/${pokemonId}/card`, { method: 'DELETE' }),
  pokedexSyncStatus: () => request<PokedexSyncStatus>('/api/admin/pokedex/status'),
  syncPokedex: () => request<PokedexSyncResponse>('/api/admin/pokedex/sync', { method: 'POST' }),
  refreshPrices: () => request<PriceRefreshResponse>('/api/admin/prices/refresh', { method: 'POST' }),
  exportData: () => downloadRequest('/api/admin/data/export'),
  importData: (file: File) =>
    request<CollectionImportResponse>('/api/admin/data/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file,
    }),
};

// Card writes use multipart form data because they may contain an image file.
function toFormData(input: CardInput, image: File | null): FormData {
  const form = new FormData();
  Object.entries(input).forEach(([key, value]) => form.set(key, value ?? ''));
  if (image) form.set('image', image);
  return form;
}
