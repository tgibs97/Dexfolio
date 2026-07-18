import type { CatalogCard, CatalogPrice, CatalogSet } from '../shared/types';
import { readEnglishSetCatalog, writeEnglishSetCatalog } from './catalogCache';
import type { Env } from './env';
import { type ExternalApiRequestLogger, withExternalApiLogging } from './externalApiLogs';

const API_ROOT = 'https://api.pokemontcg.io/v2';
const TCGDEX_API_ROOT = 'https://api.tcgdex.net/v2';
const POKETRACE_API_ROOT = 'https://api.poketrace.com/v1';
const EXCHANGE_API_ROOT = 'https://api.frankfurter.dev/v2';
const API_TIMEOUT_MS = 12_000;
// Each job makes at most one upstream request. Twenty jobs leave room under the
// Free-plan limit for one retry per job plus currency conversion/cache calls.
const CATALOG_REFRESH_REQUEST_BUDGET = 20;
const CATALOG_FETCH_CONCURRENCY = 5;
const POKETRACE_MIN_REQUEST_INTERVAL_MS = 2_000;
// One cache read, one cache write, and twenty pages with one retry each stay
// below the Workers Free-plan limit of fifty external subrequests.
const POKETRACE_MAX_CATALOG_PAGES = 20;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

const TCGDEX_LANGUAGES: Record<string, string> = {
  Japanese: 'ja',
  Spanish: 'es',
  French: 'fr',
  German: 'de',
  Italian: 'it',
  Portuguese: 'pt-br',
  'Portuguese (Brazil)': 'pt-br',
  'Portuguese (Portugal)': 'pt-pt',
  Dutch: 'nl',
  Polish: 'pl',
  Russian: 'ru',
  Korean: 'ko',
  Chinese: 'zh-tw',
  'Chinese (Traditional)': 'zh-tw',
  'Chinese (Simplified)': 'zh-cn',
  Indonesian: 'id',
  Thai: 'th',
};

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

interface PokeTraceResponse<T> {
  data: T[];
  pagination?: {
    hasMore?: boolean;
    nextCursor?: string | null;
  };
}

interface PokeTraceItemResponse<T> {
  data: T;
}

interface PokeTraceSet {
  slug: string;
  name: string;
  releaseDate?: string | null;
}

interface PokeTracePriceTier {
  avg?: number | null;
  low?: number | null;
  high?: number | null;
  lastUpdated?: string | null;
}

interface PokeTraceCard {
  id: string;
  name: string;
  cardNumber: string;
  variant?: string | null;
  rarity?: string | null;
  currency?: string | null;
  refs?: {
    tcgplayerId?: string | number | null;
    cardmarketId?: string | number | null;
  };
  marketplaceUrls?: {
    tcgplayer?: string | null;
    cardmarket?: string | null;
    ebay?: string | null;
  };
  prices?: Record<string, Record<string, PokeTracePriceTier | undefined> | undefined>;
  lastUpdated?: string | null;
}

interface TcgdexSet {
  id: string;
  name: string;
}

interface TcgdexCardBrief {
  id: string;
  localId: string | number;
  name: string;
}

interface TcgdexPrice {
  productId?: number;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  marketPrice?: number | null;
}

interface TcgdexCardmarketPricing {
  updated?: string;
  unit?: string;
  idProduct?: number;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  'avg-holo'?: number | null;
  'low-holo'?: number | null;
  'trend-holo'?: number | null;
}

interface TcgdexCard {
  id: string;
  localId: string | number;
  name: string;
  rarity?: string;
  variants?: {
    firstEdition?: boolean;
    holo?: boolean;
    normal?: boolean;
    reverse?: boolean;
  };
  pricing?: {
    tcgplayer?: ({ updated?: string; unit?: string } & Record<string, TcgdexPrice | string | undefined>) | null;
    cardmarket?: TcgdexCardmarketPricing | null;
  };
}

interface ExchangeRate {
  base: string;
  quote: string;
  rate: number;
}

export class CatalogUnavailableError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export interface CatalogRefreshResult {
  cards: CatalogCard[];
  deferredCardIds: string[];
}

interface TcgdexCardRequest {
  catalogId: string;
  languageCode: string;
  id: string;
}

interface TcgdexCardDetail {
  request: TcgdexCardRequest;
  card: TcgdexCard;
}

interface PokeTraceRefreshId {
  catalogId: string;
  id: string;
  source: string | null;
  sourceId: string | null;
}

type CatalogRefreshJob =
  | { kind: 'english'; catalogIds: string[]; ids: string[] }
  | { kind: 'tcgdex'; catalogIds: string[]; request: TcgdexCardRequest }
  | {
      kind: 'poketrace-source';
      catalogIds: string[];
      source: 'tcg' | 'cm';
      parameter: 'tcgplayer_ids' | 'cardmarket_ids';
      values: PokeTraceRefreshId[];
    }
  | { kind: 'poketrace-item'; catalogIds: string[]; value: PokeTraceRefreshId };

interface CatalogRefreshJobResult {
  cards: CatalogCard[];
  tcgdexDetails: TcgdexCardDetail[];
  failedCardIds: string[];
}

interface CatalogRefreshExecutionResult {
  cards: CatalogCard[];
  failedCardIds: string[];
}

/** Fetch localized set names once; English keeps its familiar PTCGO codes. */
export async function getCatalogSets(env: Env, language = 'English', search = ''): Promise<CatalogSet[]> {
  return withExternalApiLogging(env.DB, (logger) => getCatalogSetsLogged(env, language, search, logger));
}

/** Refresh the durable English set snapshot independently from form traffic. */
export async function refreshEnglishCatalogSets(env: Env): Promise<CatalogSet[]> {
  return withExternalApiLogging(env.DB, (logger) => fetchAndStoreEnglishCatalogSets(env, logger, false));
}

async function getCatalogSetsLogged(
  env: Env,
  language: string,
  search: string,
  logger: ExternalApiRequestLogger,
): Promise<CatalogSet[]> {
  if (language === 'Japanese' && env.POKETRACE_API_KEY) {
    if (!search.trim()) return [];
    const body = await fetchAllPokeTrace<PokeTraceSet>(
      '/sets',
      { game: 'pokemon-japanese', search: search.trim(), limit: '100' },
      env,
      24 * 60 * 60,
      logger,
    );
    return body.data.flatMap(toPokeTraceCatalogSet);
  }
  if (language !== 'English') {
    const languageCode = TCGDEX_LANGUAGES[language];
    if (!languageCode) return [];
    const sets = await fetchTcgdex<TcgdexSet[]>(
      env,
      `/${languageCode}/sets`,
      { 'sort:field': 'releaseDate', 'sort:order': 'DESC' },
      24 * 60 * 60,
      true,
      logger,
    );
    if (!Array.isArray(sets)) throw new CatalogUnavailableError('TCGdex API returned an invalid set list.');
    return sets
      .filter((set) => set.id && set.name)
      .map((set) => ({ id: set.id, name: set.name, code: set.id, releaseDate: null }));
  }

  const cached = env.DB ? await readEnglishSetCatalog(env.DB) : null;
  if (cached) return cached.sets;
  return fetchAndStoreEnglishCatalogSets(env, logger, true);
}

async function fetchAndStoreEnglishCatalogSets(
  env: Env,
  logger: ExternalApiRequestLogger,
  readCache: boolean,
): Promise<CatalogSet[]> {
  const body = await fetchCatalog<TcgSet>(
    '/sets',
    { pageSize: '250', orderBy: '-releaseDate', select: 'id,name,ptcgoCode,releaseDate' },
    env,
    24 * 60 * 60,
    readCache,
    logger,
  );
  const sets = body.data
    .filter((set) => set.id && set.name)
    .map((set) => ({
      id: set.id,
      name: set.name,
      code: set.ptcgoCode || set.id,
      releaseDate: set.releaseDate || null,
    }));
  if (!sets.length) throw new CatalogUnavailableError('Pokémon TCG API returned an empty set list.');
  if (env.DB) await writeEnglishSetCatalog(env.DB, sets);
  return sets;
}

/** Fetch only cards for this binder species in the selected expansion. */
export async function getCatalogCards(
  env: Env,
  setId: string,
  nationalDexNumber: number,
  language = 'English',
  pokemonName = '',
): Promise<CatalogCard[]> {
  return withExternalApiLogging(env.DB, (logger) =>
    getCatalogCardsLogged(env, setId, nationalDexNumber, language, pokemonName, logger),
  );
}

async function getCatalogCardsLogged(
  env: Env,
  setId: string,
  nationalDexNumber: number,
  language: string,
  pokemonName: string,
  logger: ExternalApiRequestLogger,
): Promise<CatalogCard[]> {
  if (language === 'Japanese' && env.POKETRACE_API_KEY) {
    if (!pokemonName.trim()) return [];
    const body = await fetchAllPokeTrace<PokeTraceCard>(
      '/cards',
      {
        set: setId,
        search: pokemonName.trim(),
        game: 'pokemon-japanese',
        market: 'US',
        product_type: 'single',
        limit: '20',
      },
      env,
      60 * 60,
      logger,
    );
    return body.data.flatMap((card) => toPokeTraceCatalogCard(card));
  }
  if (language !== 'English') {
    const languageCode = TCGDEX_LANGUAGES[language];
    if (!languageCode) return [];
    const cards = await fetchTcgdex<TcgdexCardBrief[]>(
      env,
      `/${languageCode}/cards`,
      { 'set.id': `eq:${setId}`, dexId: `eq:${nationalDexNumber}`, 'sort:field': 'localId' },
      7 * 24 * 60 * 60,
      true,
      logger,
    );
    if (!Array.isArray(cards)) throw new CatalogUnavailableError('TCGdex API returned an invalid card list.');
    const details = await fetchTcgdexCardDetails(
      env,
      cards.map((card) => ({ catalogId: `tcgdex:${languageCode}:${card.id}`, languageCode, id: card.id })),
      60 * 60,
      true,
      false,
      logger,
    );
    const eurUsdRate = await eurUsdRateFor(
      details.map((detail) => detail.card),
      logger,
    );
    return details.flatMap(({ card, request }) => toTcgdexCatalogCard(card, request.languageCode, eurUsdRate));
  }

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
    true,
    logger,
  );
  return body.data.flatMap(toCatalogCard);
}

/** Refresh many owned cards in a few upstream searches while bypassing stale cache entries. */
export async function getCatalogCardsByIds(env: Env, cardIds: string[]): Promise<CatalogCard[]> {
  return (await getCatalogCardRefreshByIds(env, cardIds)).cards;
}

/**
 * Refresh linked catalog cards without exceeding the Free-plan subrequest ceiling.
 * Provider requests share one daily rotating job window so large or mixed-language
 * collections are fully covered over successive runs.
 */
export async function getCatalogCardRefreshByIds(env: Env, cardIds: string[]): Promise<CatalogRefreshResult> {
  return withExternalApiLogging(env.DB, (logger) => getCatalogCardRefreshByIdsLogged(env, cardIds, logger));
}

async function getCatalogCardRefreshByIdsLogged(
  env: Env,
  cardIds: string[],
  logger: ExternalApiRequestLogger,
): Promise<CatalogRefreshResult> {
  const uniqueIds = [...new Set(cardIds)];
  const englishIds = uniqueIds.filter((id) => /^[a-zA-Z0-9.-]{1,80}$/.test(id));
  const foreignIds = uniqueIds.flatMap((id) => {
    const match = /^tcgdex:([a-z]{2}(?:-[a-z]{2})?):([a-zA-Z0-9._-]{1,60})$/.exec(id);
    return match ? [{ catalogId: id, languageCode: match[1], id: match[2] }] : [];
  });
  const pokeTraceIds = uniqueIds.flatMap((id) => {
    const match = /^poketrace:([0-9a-f-]{36})(?::(tcg|cm):(\d+))?$/i.exec(id);
    return match ? [{ catalogId: id, id: match[1], source: match[2] || null, sourceId: match[3] || null }] : [];
  });
  const jobs = catalogRefreshJobs(englishIds, foreignIds, pokeTraceIds);
  const selectedJobs = dailyWindow(jobs, CATALOG_REFRESH_REQUEST_BUDGET);
  const selectedJobSet = new Set(selectedJobs);
  const refresh = await executeCatalogRefreshJobs(env, selectedJobs, logger);
  return {
    cards: refresh.cards,
    deferredCardIds: [
      ...new Set([
        ...jobs.filter((job) => !selectedJobSet.has(job)).flatMap((job) => job.catalogIds),
        ...refresh.failedCardIds,
      ]),
    ],
  };
}

function catalogRefreshJobs(
  englishIds: string[],
  foreignIds: TcgdexCardRequest[],
  pokeTraceIds: PokeTraceRefreshId[],
): CatalogRefreshJob[] {
  const pokeTraceSources = [
    { source: 'tcg' as const, parameter: 'tcgplayer_ids' as const },
    { source: 'cm' as const, parameter: 'cardmarket_ids' as const },
  ];
  return [
    ...chunk(englishIds, 100).map((ids): CatalogRefreshJob => ({ kind: 'english', catalogIds: ids, ids })),
    ...foreignIds.map((request): CatalogRefreshJob => ({ kind: 'tcgdex', catalogIds: [request.catalogId], request })),
    ...pokeTraceSources.flatMap(({ source, parameter }) =>
      chunk(
        pokeTraceIds.filter((value) => value.source === source && value.sourceId),
        20,
      ).map((values): CatalogRefreshJob => ({
        kind: 'poketrace-source',
        catalogIds: values.map((value) => value.catalogId),
        source,
        parameter,
        values,
      })),
    ),
    ...pokeTraceIds
      .filter((value) => !value.sourceId)
      .map((value): CatalogRefreshJob => ({ kind: 'poketrace-item', catalogIds: [value.catalogId], value })),
  ];
}

async function executeCatalogRefreshJobs(
  env: Env,
  jobs: CatalogRefreshJob[],
  logger: ExternalApiRequestLogger,
): Promise<CatalogRefreshExecutionResult> {
  const results: CatalogRefreshJobResult[] = [];
  const concurrentJobs = jobs.filter((job) => !isPokeTraceJob(job));
  const pokeTraceJobs = jobs.filter(isPokeTraceJob);
  for (const group of chunk(concurrentJobs, CATALOG_FETCH_CONCURRENCY)) {
    results.push(...(await Promise.all(group.map((job) => executeCatalogRefreshJobSafely(env, job, logger)))));
  }
  for (const [index, job] of pokeTraceJobs.entries()) {
    if (index > 0) await scheduler.wait(POKETRACE_MIN_REQUEST_INTERVAL_MS);
    results.push(await executeCatalogRefreshJobSafely(env, job, logger));
  }
  const tcgdexDetails = results.flatMap((result) => result.tcgdexDetails);
  const eurUsdRate = await eurUsdRateFor(
    tcgdexDetails.map((detail) => detail.card),
    logger,
  );
  return {
    cards: [
      ...results.flatMap((result) => result.cards),
      ...tcgdexDetails.flatMap(({ card, request }) => toTcgdexCatalogCard(card, request.languageCode, eurUsdRate)),
    ],
    failedCardIds: results.flatMap((result) => result.failedCardIds),
  };
}

function isPokeTraceJob(
  job: CatalogRefreshJob,
): job is Extract<CatalogRefreshJob, { kind: 'poketrace-source' | 'poketrace-item' }> {
  return job.kind === 'poketrace-source' || job.kind === 'poketrace-item';
}

async function executeCatalogRefreshJobSafely(
  env: Env,
  job: CatalogRefreshJob,
  logger: ExternalApiRequestLogger,
): Promise<CatalogRefreshJobResult> {
  try {
    return await executeCatalogRefreshJob(env, job, logger);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'Catalog refresh job failed',
        provider: job.kind,
        cardCount: job.catalogIds.length,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { cards: [], tcgdexDetails: [], failedCardIds: job.catalogIds };
  }
}

async function executeCatalogRefreshJob(
  env: Env,
  job: CatalogRefreshJob,
  logger: ExternalApiRequestLogger,
): Promise<CatalogRefreshJobResult> {
  if (job.kind === 'english') {
    const response = await fetchCatalog<TcgCard>(
      '/cards',
      {
        q: `(${job.ids.map((id) => `id:"${id}"`).join(' OR ')})`,
        pageSize: '250',
        select: 'id,name,number,rarity,tcgplayer',
      },
      env,
      0,
      false,
      logger,
    );
    return { cards: response.data.flatMap(toCatalogCard), tcgdexDetails: [], failedCardIds: [] };
  }
  if (job.kind === 'tcgdex') {
    return {
      cards: [],
      tcgdexDetails: await fetchTcgdexCardDetails(env, [job.request], 0, false, true, logger),
      failedCardIds: [],
    };
  }
  if (job.kind === 'poketrace-source') {
    const body = await fetchPokeTrace<PokeTraceCard>(
      '/cards',
      { [job.parameter]: job.values.map((value) => value.sourceId).join(','), limit: '20' },
      env,
      0,
      false,
      logger,
    );
    const cards = body.data.flatMap((card) => {
      const sourceId = numericIdentifier(job.source === 'tcg' ? card.refs?.tcgplayerId : card.refs?.cardmarketId);
      const requested = job.values.find((value) => value.sourceId === sourceId);
      return toPokeTraceCatalogCard(card, requested?.catalogId);
    });
    return { cards, tcgdexDetails: [], failedCardIds: [] };
  }
  try {
    const body = await fetchPokeTraceItem<PokeTraceCard>(`/cards/${encodeURIComponent(job.value.id)}`, env, logger);
    return {
      cards: toPokeTraceCatalogCard(body.data, job.value.catalogId),
      tcgdexDetails: [],
      failedCardIds: [],
    };
  } catch (error) {
    if (error instanceof CatalogUnavailableError && error.status === 404) {
      return { cards: [], tcgdexDetails: [], failedCardIds: [] };
    }
    throw error;
  }
}

async function fetchTcgdexCardDetails(
  env: Env,
  requests: TcgdexCardRequest[],
  cacheSeconds: number,
  readCache = true,
  ignoreNotFound = false,
  logger: ExternalApiRequestLogger | undefined = undefined,
): Promise<TcgdexCardDetail[]> {
  const details: TcgdexCardDetail[] = [];
  for (const group of chunk(requests, CATALOG_FETCH_CONCURRENCY)) {
    const results = await Promise.all(
      group.map(async (request): Promise<TcgdexCardDetail | null> => {
        try {
          const card = await fetchTcgdex<TcgdexCard>(
            env,
            `/${request.languageCode}/cards/${encodeURIComponent(request.id)}`,
            {},
            cacheSeconds,
            readCache,
            logger,
          );
          return { request, card };
        } catch (error) {
          if (ignoreNotFound && error instanceof CatalogUnavailableError && error.status === 404) return null;
          throw error;
        }
      }),
    );
    details.push(...results.filter((result): result is TcgdexCardDetail => result !== null));
  }
  return details;
}

function dailyWindow<T>(values: T[], size: number, now = Date.now()): T[] {
  if (values.length <= size) return values;
  const windowCount = Math.ceil(values.length / size);
  const day = Math.floor(now / 86_400_000);
  const start = (day % windowCount) * size;
  return values.slice(start, start + size);
}

function toPokeTraceCatalogSet(set: PokeTraceSet): CatalogSet[] {
  if (!set.slug || !set.name) return [];
  const name = set.name.trim();
  const codedName = /^([a-z0-9.-]{1,24}):\s*(.+)$/i.exec(name);
  const leadingCode = /^([a-z]{1,5}(?:\d+[a-z]?)?(?:-[a-z])?)\s+/i.exec(name);
  const inferredCode = leadingCode?.[1] && /[\d-]/.test(leadingCode[1]) ? leadingCode[1] : null;
  return [
    {
      id: set.slug,
      name: codedName?.[2]?.trim() || name,
      code: codedName?.[1] || inferredCode || set.slug,
      releaseDate: set.releaseDate || null,
    },
  ];
}

function toPokeTraceCatalogCard(card: PokeTraceCard, idOverride?: string): CatalogCard[] {
  if (!card.id || !card.name || !card.cardNumber) return [];
  const printing = pokeTracePrinting(card.variant);
  const tier = preferredPokeTracePrice(card.prices);
  const price = tier
    ? {
        printing,
        lowCents: dollarsToCents(tier.low),
        midCents: null,
        highCents: dollarsToCents(tier.high),
        marketCents: dollarsToCents(tier.avg),
      }
    : null;
  return [
    {
      id: idOverride || pokeTraceCatalogId(card),
      name: card.name.replace(/\s+\((?:English|Japanese|Chinese|Thai|Indonesian)\)$/i, ''),
      number: localCardNumber(card.cardNumber),
      rarity: card.rarity || null,
      availablePrintings: [printing],
      suggestedPrinting: printing,
      prices: price ? [price] : [],
      pricesUpdatedAt: tier?.lastUpdated || card.lastUpdated || null,
      tcgplayerUrl:
        card.marketplaceUrls?.tcgplayer || card.marketplaceUrls?.cardmarket || card.marketplaceUrls?.ebay || null,
    },
  ];
}

function pokeTraceCatalogId(card: PokeTraceCard): string {
  const tcgplayerId = numericIdentifier(card.refs?.tcgplayerId);
  if (tcgplayerId) return `poketrace:${card.id}:tcg:${tcgplayerId}`;
  const cardmarketId = numericIdentifier(card.refs?.cardmarketId);
  return cardmarketId ? `poketrace:${card.id}:cm:${cardmarketId}` : `poketrace:${card.id}`;
}

function numericIdentifier(value: string | number | null | undefined): string | null {
  const normalized = value === null || value === undefined ? '' : String(value);
  return /^\d+$/.test(normalized) ? normalized : null;
}

function localCardNumber(value: string): string {
  const numberedTotal = /^(.+)\/\d+$/.exec(value.trim());
  return numberedTotal?.[1] || value.trim();
}

function pokeTracePrinting(value: string | null | undefined): string {
  const printings: Record<string, string> = {
    Normal: 'Normal',
    Holofoil: 'Holofoil',
    Reverse_Holofoil: 'Reverse Holofoil',
    '1st_Edition': '1st Edition Normal',
    '1st_Edition_Holofoil': '1st Edition Holofoil',
    Unlimited: 'Unlimited',
    Unlimited_Holofoil: 'Unlimited Holofoil',
  };
  return (value && printings[value]) || 'Normal';
}

function preferredPokeTracePrice(prices: PokeTraceCard['prices']): PokeTracePriceTier | null {
  return (
    prices?.tcgplayer?.NEAR_MINT ||
    prices?.cardmarket?.AGGREGATED ||
    prices?.cardmarket_unsold?.NEAR_MINT ||
    prices?.ebay?.NEAR_MINT ||
    null
  );
}

function toTcgdexCatalogCard(card: TcgdexCard, languageCode: string, eurUsdRate: number | null): CatalogCard[] {
  if (!card.id || !card.name || card.localId === undefined || card.localId === null) return [];
  const tcgplayer = card.pricing?.tcgplayer;
  const tcgplayerPrices = tcgplayer ? inferTcgdexTcgplayerPrices(tcgplayer) : [];
  const prices = tcgplayerPrices.length
    ? tcgplayerPrices
    : inferCardmarketPrices(card.pricing?.cardmarket, card.variants, eurUsdRate);
  const availablePrintings = inferTcgdexPrintings(card.variants, prices);
  const firstProductId = tcgplayerPrices.length ? tcgplayerProductId(tcgplayer) : null;
  const cardmarketProductId = card.pricing?.cardmarket?.idProduct;
  return [
    {
      id: `tcgdex:${languageCode}:${card.id}`,
      name: card.name,
      number: String(card.localId),
      rarity: card.rarity || null,
      availablePrintings,
      suggestedPrinting: availablePrintings.length === 1 ? availablePrintings[0] : null,
      prices,
      pricesUpdatedAt:
        (tcgplayerPrices.length && typeof tcgplayer?.updated === 'string' ? tcgplayer.updated : null) ||
        card.pricing?.cardmarket?.updated ||
        null,
      tcgplayerUrl: firstProductId
        ? `https://www.tcgplayer.com/product/${firstProductId}`
        : cardmarketProductId
          ? `https://www.cardmarket.com/en/Pokemon/Products/Singles?idProduct=${cardmarketProductId}`
          : null,
    },
  ];
}

function inferTcgdexTcgplayerPrices(pricing: NonNullable<TcgdexCard['pricing']>['tcgplayer']): CatalogPrice[] {
  if (!pricing) return [];
  const printingMap: Record<string, string> = {
    normal: 'Normal',
    holofoil: 'Holofoil',
    'reverse-holofoil': 'Reverse Holofoil',
    '1st-edition': '1st Edition Normal',
    '1st-edition-holofoil': '1st Edition Holofoil',
    unlimited: 'Unlimited',
    'unlimited-holofoil': 'Unlimited Holofoil',
  };
  return Object.entries(pricing).flatMap(([key, value]) => {
    const printing = printingMap[key];
    if (!printing || !value || typeof value !== 'object') return [];
    return [
      {
        printing,
        lowCents: dollarsToCents(value.lowPrice),
        midCents: dollarsToCents(value.midPrice),
        highCents: dollarsToCents(value.highPrice),
        marketCents: dollarsToCents(value.marketPrice),
      },
    ];
  });
}

function inferCardmarketPrices(
  pricing: TcgdexCardmarketPricing | null | undefined,
  variants: TcgdexCard['variants'],
  eurUsdRate: number | null,
): CatalogPrice[] {
  if (!pricing || !eurUsdRate) return [];
  const normal = {
    printing: 'Normal',
    lowCents: convertedCents(pricing.low, eurUsdRate),
    midCents: convertedCents(pricing.avg, eurUsdRate),
    highCents: null,
    marketCents: convertedCents(pricing.trend, eurUsdRate),
  };
  const holo = {
    lowCents: convertedCents(pricing['low-holo'], eurUsdRate),
    midCents: convertedCents(pricing['avg-holo'], eurUsdRate),
    highCents: null,
    marketCents: convertedCents(pricing['trend-holo'], eurUsdRate),
  };
  const prices: CatalogPrice[] = [];
  if (variants?.normal || Object.values(normal).some((value) => typeof value === 'number')) prices.push(normal);
  if (variants?.holo) prices.push({ printing: 'Holofoil', ...holo });
  if (variants?.reverse) prices.push({ printing: 'Reverse Holofoil', ...holo });
  return prices;
}

function inferTcgdexPrintings(variants: TcgdexCard['variants'], prices: CatalogPrice[]): string[] {
  const printings = [
    ...(variants?.normal ? ['Normal'] : []),
    ...(variants?.holo ? ['Holofoil'] : []),
    ...(variants?.reverse ? ['Reverse Holofoil'] : []),
    ...(variants?.firstEdition && variants.normal ? ['1st Edition Normal'] : []),
    ...(variants?.firstEdition && variants.holo ? ['1st Edition Holofoil'] : []),
    ...(variants?.firstEdition && !variants.normal && !variants.holo ? ['1st Edition Normal'] : []),
    ...prices.map((price) => price.printing),
  ];
  return [...new Set(printings)];
}

function tcgplayerProductId(pricing: NonNullable<TcgdexCard['pricing']>['tcgplayer']): number | null {
  if (!pricing) return null;
  for (const value of Object.values(pricing)) {
    if (value && typeof value === 'object' && typeof value.productId === 'number') return value.productId;
  }
  return null;
}

function convertedCents(value: number | null | undefined, rate: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * rate * 100) : null;
}

async function eurUsdRateFor(cards: TcgdexCard[], logger: ExternalApiRequestLogger): Promise<number | null> {
  const needsConversion = cards.some(
    (card) =>
      inferTcgdexTcgplayerPrices(card.pricing?.tcgplayer).length === 0 && card.pricing?.cardmarket?.unit === 'EUR',
  );
  if (!needsConversion) return null;
  try {
    const result = await fetchJson<ExchangeRate>(new URL(`${EXCHANGE_API_ROOT}/rate/EUR/USD`), 24 * 60 * 60, logger);
    return result.base === 'EUR' && result.quote === 'USD' && Number.isFinite(result.rate) ? result.rate : null;
  } catch {
    return null;
  }
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
  logger?: ExternalApiRequestLogger,
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
  if (env.POKEMON_TCG_API_KEY?.trim()) headers.set('X-Api-Key', env.POKEMON_TCG_API_KEY.trim());
  const response = await fetchWithRetry(url, headers, 'Pokémon TCG API', logger);

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

async function fetchTcgdex<T>(
  env: Env,
  path: string,
  parameters: Record<string, string>,
  cacheSeconds: number,
  readCache = true,
  logger?: ExternalApiRequestLogger,
): Promise<T> {
  const url = new URL(`${TCGDEX_API_ROOT}${path}`);
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
  return fetchJson<T>(url, cacheSeconds, logger, readCache, 'TCGdex API');
}

/** Fetch every cursor page while caching the complete catalog query as one response. */
async function fetchAllPokeTrace<T>(
  path: string,
  parameters: Record<string, string>,
  env: Env,
  cacheSeconds: number,
  logger?: ExternalApiRequestLogger,
): Promise<PokeTraceResponse<T>> {
  if (!env.POKETRACE_API_KEY) throw new CatalogUnavailableError('PokeTrace API key is not configured.');
  const baseUrl = new URL(`${POKETRACE_API_ROOT}${path}`);
  Object.entries(parameters).forEach(([key, value]) => baseUrl.searchParams.set(key, value));
  const cacheKey = new Request(baseUrl.toString());
  const defaultCache = (caches as CacheStorage & { default: Cache }).default;
  try {
    const cached = await defaultCache.match(cacheKey);
    if (cached) return (await cached.json()) as PokeTraceResponse<T>;
  } catch {
    // Cache API support is optional in local runtimes.
  }

  const headers = new Headers({ Accept: 'application/json', 'X-API-Key': env.POKETRACE_API_KEY });
  const data: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let pageIndex = 0; pageIndex < POKETRACE_MAX_CATALOG_PAGES; pageIndex += 1) {
    if (pageIndex > 0) await scheduler.wait(POKETRACE_MIN_REQUEST_INTERVAL_MS);
    const url = new URL(baseUrl);
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetchWithRetry(url, headers, 'PokeTrace API', logger);
    const body = (await response.json()) as PokeTraceResponse<T>;
    if (!body || !Array.isArray(body.data)) {
      throw new CatalogUnavailableError('PokeTrace API returned an invalid response.');
    }
    data.push(...body.data);
    if (!body.pagination?.hasMore) {
      const result = { data, pagination: { hasMore: false, nextCursor: null } } satisfies PokeTraceResponse<T>;
      try {
        if (cacheSeconds) {
          await defaultCache.put(
            cacheKey,
            new Response(JSON.stringify(result), {
              headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${cacheSeconds}` },
            }),
          );
        }
      } catch {
        // Caching is an optimization, not a requirement.
      }
      return result;
    }
    const nextCursor = body.pagination.nextCursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new CatalogUnavailableError('PokeTrace API returned invalid pagination data.');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new CatalogUnavailableError('PokeTrace catalog response exceeded the safe pagination limit.');
}

async function fetchPokeTrace<T>(
  path: string,
  parameters: Record<string, string>,
  env: Env,
  cacheSeconds: number,
  readCache = true,
  logger?: ExternalApiRequestLogger,
): Promise<PokeTraceResponse<T>> {
  if (!env.POKETRACE_API_KEY) throw new CatalogUnavailableError('PokeTrace API key is not configured.');
  const url = new URL(`${POKETRACE_API_ROOT}${path}`);
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
  const cacheKey = new Request(url.toString());
  const defaultCache = (caches as CacheStorage & { default: Cache }).default;
  if (readCache) {
    try {
      const cached = await defaultCache.match(cacheKey);
      if (cached) return (await cached.json()) as PokeTraceResponse<T>;
    } catch {
      // Cache API support is optional in local runtimes.
    }
  }

  const headers = new Headers({ Accept: 'application/json', 'X-API-Key': env.POKETRACE_API_KEY });
  const response = await fetchWithRetry(url, headers, 'PokeTrace API', logger);
  const body = (await response.json()) as PokeTraceResponse<T>;
  if (!body || !Array.isArray(body.data))
    throw new CatalogUnavailableError('PokeTrace API returned an invalid response.');
  try {
    if (cacheSeconds) {
      await defaultCache.put(
        cacheKey,
        new Response(JSON.stringify(body), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${cacheSeconds}` },
        }),
      );
    }
  } catch {
    // Caching is an optimization, not a requirement.
  }
  return body;
}

async function fetchPokeTraceItem<T>(
  path: string,
  env: Env,
  logger?: ExternalApiRequestLogger,
): Promise<PokeTraceItemResponse<T>> {
  if (!env.POKETRACE_API_KEY) throw new CatalogUnavailableError('PokeTrace API key is not configured.');
  const url = new URL(`${POKETRACE_API_ROOT}${path}`);
  const headers = new Headers({ Accept: 'application/json', 'X-API-Key': env.POKETRACE_API_KEY });
  const response = await fetchWithRetry(url, headers, 'PokeTrace API', logger);
  const body = (await response.json()) as PokeTraceItemResponse<T>;
  if (!body || body.data === null || body.data === undefined) {
    throw new CatalogUnavailableError('PokeTrace API returned an invalid response.');
  }
  return body;
}

async function fetchJson<T>(
  url: URL,
  cacheSeconds: number,
  logger?: ExternalApiRequestLogger,
  readCache = true,
  provider = 'Exchange-rate API',
): Promise<T> {
  const cacheKey = new Request(url.toString());
  const defaultCache = (caches as CacheStorage & { default: Cache }).default;
  if (readCache) {
    try {
      const cached = await defaultCache.match(cacheKey);
      if (cached) return (await cached.json()) as T;
    } catch {
      // Cache API support is optional in local runtimes.
    }
  }

  const response = await fetchWithRetry(url, new Headers({ Accept: 'application/json' }), provider, logger);
  const body = (await response.json()) as T;
  try {
    if (cacheSeconds) {
      await defaultCache.put(
        cacheKey,
        new Response(JSON.stringify(body), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${cacheSeconds}` },
        }),
      );
    }
  } catch {
    // Caching is an optimization, not a requirement.
  }
  return body;
}

function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );
}

/** Keep a slow or transient upstream failure from consuming a full Worker request. */
async function fetchWithRetry(
  url: URL,
  headers: Headers,
  provider: string,
  logger?: ExternalApiRequestLogger,
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    } catch (error) {
      logger?.record({
        provider,
        method: 'GET',
        url: url.toString(),
        statusCode: null,
        success: false,
        durationMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : String(error),
        requestedAt: new Date(startedAt).toISOString(),
      });
      if (attempt === 0) continue;
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      throw new CatalogUnavailableError(timedOut ? `${provider} request timed out.` : `${provider} request failed.`);
    }

    logger?.record({
      provider,
      method: 'GET',
      url: url.toString(),
      statusCode: response.status,
      success: response.ok,
      durationMs: Date.now() - startedAt,
      errorMessage: response.ok ? null : `HTTP ${response.status}`,
      requestedAt: new Date(startedAt).toISOString(),
    });

    if (response.ok) return response;
    if (response.status === 429 && attempt === 0) {
      const requestedDelay = Number(response.headers.get('Retry-After'));
      const delaySeconds = Number.isFinite(requestedDelay) ? Math.min(Math.max(requestedDelay, 0), 3) : 2;
      await scheduler.wait(delaySeconds * 1000);
      continue;
    }
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === 1) {
      throw new CatalogUnavailableError(`${provider} returned ${response.status}.`, response.status);
    }
  }

  throw new CatalogUnavailableError(`${provider} request failed.`);
}
