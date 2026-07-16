import type { CatalogCard, CatalogPrice, CatalogSet } from '../shared/types';
import type { Env } from './env';

const API_ROOT = 'https://api.pokemontcg.io/v2';
const API_TIMEOUT_MS = 12_000;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

interface TcgApiResponse<T> {
  data: T[];
}

interface TcgSet {
  id: string;
  name: string;
  ptcgoCode?: string;
  releaseDate?: string;
}

interface TcgCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  tcgplayer?: {
    url?: string;
    updatedAt?: string;
    prices?: Record<string, TcgPrice | undefined>;
  };
}

interface TcgPrice {
  low?: number | null;
  mid?: number | null;
  high?: number | null;
  market?: number | null;
}

export class CatalogUnavailableError extends Error {}

/** Fetch all English set names once, ordered newest-first for useful suggestions. */
export async function getCatalogSets(env: Env): Promise<CatalogSet[]> {
  const body = await fetchCatalog<TcgSet>(
    '/sets',
    { pageSize: '250', orderBy: '-releaseDate', select: 'id,name,ptcgoCode,releaseDate' },
    env,
    24 * 60 * 60,
  );
  return body.data
    .filter((set) => set.id && set.name)
    .map((set) => ({
      id: set.id,
      name: set.name,
      code: set.ptcgoCode || set.id,
      releaseDate: set.releaseDate || null,
    }));
}

/** Fetch only cards for this binder species in the selected expansion. */
export async function getCatalogCards(env: Env, setId: string, nationalDexNumber: number): Promise<CatalogCard[]> {
  const body = await fetchCatalog<TcgCard>(
    '/cards',
    {
      // `!` asks the catalog index for one exact numeric value. A one-item
      // range returns the same cards but is substantially slower upstream.
      q: `set.id:${setId} !nationalPokedexNumbers:${nationalDexNumber}`,
      pageSize: '250',
      orderBy: 'number,name',
      select: 'id,name,number,rarity,tcgplayer',
    },
    env,
    7 * 24 * 60 * 60,
  );
  return body.data.flatMap(toCatalogCard);
}

/** Refresh many owned cards in a few upstream searches while bypassing stale cache entries. */
export async function getCatalogCardsByIds(env: Env, cardIds: string[]): Promise<CatalogCard[]> {
  const uniqueIds = [...new Set(cardIds)].filter((id) => /^[a-zA-Z0-9-]{1,80}$/.test(id));
  const batches = chunk(uniqueIds, 100);
  const responses = await Promise.all(
    batches.map((ids) =>
      fetchCatalog<TcgCard>(
        '/cards',
        {
          q: `(${ids.map((id) => `id:"${id}"`).join(' OR ')})`,
          pageSize: '250',
          select: 'id,name,number,rarity,tcgplayer',
        },
        env,
        0,
        false,
      ),
    ),
  );
  return responses.flatMap((response) => response.data.flatMap(toCatalogCard));
}

function toCatalogCard(card: TcgCard): CatalogCard[] {
  if (!card.id || !card.name || !card.number) return [];
  const prices = inferPrices(card);
  const availablePrintings = inferPrintings(prices);
  return [
    {
      id: card.id,
      name: card.name,
      number: card.number,
      rarity: card.rarity || null,
      availablePrintings,
      suggestedPrinting: availablePrintings.length === 1 ? availablePrintings[0] : null,
      prices,
      pricesUpdatedAt: card.tcgplayer?.updatedAt || null,
      tcgplayerUrl: card.tcgplayer?.url || null,
    },
  ];
}

/** Use TCGplayer's printing names independently from the card's rarity. */
function inferPrintings(prices: CatalogPrice[]): string[] {
  const printingOrder = ['Normal', 'Holofoil', 'Reverse Holofoil', '1st Edition Normal', '1st Edition Holofoil'];
  return [...new Set(prices.map((price) => price.printing))].sort(
    (left, right) => printingOrder.indexOf(left) - printingOrder.indexOf(right),
  );
}

/** Keep only the dollar values the collection UI displays, converted to cents. */
function inferPrices(card: TcgCard): CatalogPrice[] {
  const printingMap: Record<string, string> = {
    normal: 'Normal',
    holofoil: 'Holofoil',
    reverseHolofoil: 'Reverse Holofoil',
    '1stEditionNormal': '1st Edition Normal',
    '1stEditionHolofoil': '1st Edition Holofoil',
  };
  const prices = Object.entries(card.tcgplayer?.prices ?? {}).flatMap(([printing, values]) => {
    const mappedPrinting = printingMap[printing];
    if (!mappedPrinting || !values) return [];
    return [
      {
        printing: mappedPrinting,
        lowCents: dollarsToCents(values.low),
        midCents: dollarsToCents(values.mid),
        highCents: dollarsToCents(values.high),
        marketCents: dollarsToCents(values.market),
      },
    ];
  });
  return prices;
}

function dollarsToCents(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
}

/**
 * Server-side proxy keeps the optional API key out of browser code. Cache API
 * storage avoids spending an upstream request for repeated form suggestions.
 */
async function fetchCatalog<T>(
  path: string,
  parameters: Record<string, string>,
  env: Env,
  cacheSeconds: number,
  readCache = true,
): Promise<TcgApiResponse<T>> {
  const url = new URL(`${API_ROOT}${path}`);
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
  const cacheKey = new Request(url.toString());
  const defaultCache = (caches as CacheStorage & { default: Cache }).default;

  if (readCache) {
    try {
      const cached = await defaultCache.match(cacheKey);
      if (cached) return (await cached.json()) as TcgApiResponse<T>;
    } catch {
      // Local runtimes may not persist Cache API data; upstream lookup still works.
    }
  }

  const headers = new Headers({ Accept: 'application/json' });
  if (env.POKEMON_TCG_API_KEY) headers.set('X-Api-Key', env.POKEMON_TCG_API_KEY);
  const response = await fetchWithRetry(url, headers);

  const body = (await response.json()) as TcgApiResponse<T>;
  if (!Array.isArray(body.data)) throw new CatalogUnavailableError('Pokémon TCG API returned an invalid response.');

  try {
    if (!cacheSeconds) return body;
    await defaultCache.put(
      cacheKey,
      new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${cacheSeconds}` },
      }),
    );
  } catch {
    // Caching is an optimization, not a requirement for completing the form.
  }
  return body;
}

function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );
}

/** Keep a slow or transient upstream failure from consuming a full Worker request. */
async function fetchWithRetry(url: URL, headers: Headers): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    } catch (error) {
      if (attempt === 0) continue;
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      throw new CatalogUnavailableError(
        timedOut ? 'Pokémon TCG API request timed out.' : 'Pokémon TCG API request failed.',
      );
    }

    if (response.ok) return response;
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === 1) {
      throw new CatalogUnavailableError(`Pokémon TCG API returned ${response.status}.`);
    }
  }

  throw new CatalogUnavailableError('Pokémon TCG API request failed.');
}
