import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCatalogCardRefreshByIds,
  getCatalogCards,
  getCatalogCardsByIds,
  getCatalogSets,
  refreshEnglishCatalogSets,
} from '../../worker/catalog';
import type { Env } from '../../worker/env';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM catalog_cache').run();
});

function stubCatalog(responseData: unknown[]) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
    Response.json({ data: responseData }),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });
  return fetchMock;
}

describe('Pokémon catalog providers', () => {
  it('maps set codes and falls back to the stable set ID', async () => {
    stubCatalog([
      { id: 'base1', name: 'Base', ptcgoCode: 'BS', releaseDate: '1999/01/09' },
      { id: 'custom1', name: 'Custom' },
    ]);
    expect(await getCatalogSets({} as Env)).toEqual([
      { id: 'base1', name: 'Base', code: 'BS', releaseDate: '1999/01/09' },
      { id: 'custom1', name: 'Custom', code: 'custom1', releaseDate: null },
    ]);
  });

  it('authenticates the English set request and serves the durable snapshot during an outage', async () => {
    const fetchMock = stubCatalog([
      { id: 'base1', name: 'Base', ptcgoCode: 'BS', releaseDate: '1999/01/09' },
      { id: 'sv10', name: 'Destined Rivals', releaseDate: '2025/05/30' },
    ]);

    const initial = await getCatalogSets(env);
    expect(initial).toHaveLength(2);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Api-Key')).toBe('pokemon-tcg-test-key');
    expect(
      await env.DB.prepare('SELECT refreshed_at FROM catalog_cache WHERE cache_key = ?')
        .bind('pokemon-tcg:english-sets:v1')
        .first(),
    ).toEqual({ refreshed_at: expect.any(String) });

    vi.stubGlobal('scheduler', { wait: vi.fn(async () => undefined) });
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    await expect(refreshEnglishCatalogSets(env)).rejects.toThrow('Pokémon TCG API returned 429.');
    await expect(getCatalogSets(env)).resolves.toEqual(initial);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('finds Japanese sets by their regional code through PokeTrace', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({
        data: [{ slug: 'sv4a-shiny-treasure-ex', name: 'SV4a: Shiny Treasure ex', releaseDate: null }],
        pagination: { hasMore: false, nextCursor: null },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });

    expect(await getCatalogSets({ POKETRACE_API_KEY: 'test-key' } as Env, 'Japanese', 'SV4a')).toEqual([
      { id: 'sv4a-shiny-treasure-ex', name: 'Shiny Treasure ex', code: 'SV4a', releaseDate: null },
    ]);
    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/v1/sets');
    expect(url.searchParams.get('search')).toBe('SV4a');
    expect(url.searchParams.get('game')).toBe('pokemon-japanese');
    expect(new Headers(init?.headers).get('X-API-Key')).toBe('test-key');
  });

  it('requests cards for one set and exact National Pokédex number', async () => {
    const fetchMock = stubCatalog([{ id: 'base1-44', name: 'Bulbasaur', number: '44', rarity: 'Common' }]);
    expect(await getCatalogCards({} as Env, 'base1', 1)).toEqual([
      {
        id: 'base1-44',
        name: 'Bulbasaur',
        number: '44',
        rarity: 'Common',
        availablePrintings: [],
        suggestedPrinting: null,
        prices: [],
        pricesUpdatedAt: null,
        tcgplayerUrl: null,
      },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/v2/cards');
    expect(url.searchParams.get('q')).toBe('set.id:base1 !nationalPokedexNumbers:1');
    expect(url.searchParams.get('select')).toContain('tcgplayer');
  });

  it('uses TCGplayer printing names independently from card rarity', async () => {
    stubCatalog([
      {
        id: 'sv3pt5-166',
        name: 'Bulbasaur',
        number: '166',
        rarity: 'Illustration Rare',
        tcgplayer: {
          url: 'https://prices.pokemontcg.io/tcgplayer/sv3pt5-166',
          updatedAt: '2026/07/15',
          prices: { normal: { market: 10 }, holofoil: { low: 20.01, market: 24.5 } },
        },
      },
      {
        id: 'sv3pt5-1',
        name: 'Bulbasaur',
        number: '1',
        rarity: 'Common',
        tcgplayer: {
          updatedAt: '2026/07/15',
          prices: { normal: { low: 1.01, mid: 2.02, high: 3.03, market: 1.5 }, reverseHolofoil: {} },
        },
      },
    ]);

    const cards = await getCatalogCards({} as Env, 'sv3pt5', 1);
    expect(cards.map((card) => card.availablePrintings)).toEqual([
      ['Normal', 'Holofoil'],
      ['Normal', 'Reverse Holofoil'],
    ]);
    expect(cards.map((card) => card.suggestedPrinting)).toEqual([null, null]);
    expect(cards[0].prices).toEqual([
      { printing: 'Normal', lowCents: null, midCents: null, highCents: null, marketCents: 1000 },
      { printing: 'Holofoil', lowCents: 2001, midCents: null, highCents: null, marketCents: 2450 },
    ]);
    expect(cards[1].prices[0]).toEqual({
      printing: 'Normal',
      lowCents: 101,
      midCents: 202,
      highCents: 303,
      marketCents: 150,
    });
    expect(cards[0].pricesUpdatedAt).toBe('2026/07/15');
    expect(cards[0].tcgplayerUrl).toBe('https://prices.pokemontcg.io/tcgplayer/sv3pt5-166');
  });

  it('maps the exact SV4a Alakazam printing and TCGplayer price from PokeTrace', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      Response.json({
        data: [
          {
            id: '019bffb5-343d-71aa-b29c-09106357b176',
            name: 'Alakazam ex (Japanese)',
            cardNumber: '326/190',
            variant: 'Holofoil',
            rarity: 'Shiny Secret Rare',
            currency: 'USD',
            refs: { tcgplayerId: '567726', cardmarketId: null },
            marketplaceUrls: { tcgplayer: 'https://www.tcgplayer.com/product/567726' },
            prices: {
              tcgplayer: {
                NEAR_MINT: {
                  avg: 1.93,
                  low: 1.93,
                  high: 1.93,
                  lastUpdated: '2026-07-14T00:00:00.000Z',
                },
              },
            },
            lastUpdated: '2026-07-13T22:40:27.864Z',
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });

    const cards = await getCatalogCards(
      { POKETRACE_API_KEY: 'test-key' } as Env,
      'sv4a-shiny-treasure-ex',
      65,
      'Japanese',
      'Alakazam',
    );

    expect(cards).toEqual([
      {
        id: 'poketrace:019bffb5-343d-71aa-b29c-09106357b176:tcg:567726',
        name: 'Alakazam ex',
        number: '326',
        rarity: 'Shiny Secret Rare',
        availablePrintings: ['Holofoil'],
        suggestedPrinting: 'Holofoil',
        prices: [{ printing: 'Holofoil', lowCents: 193, midCents: null, highCents: 193, marketCents: 193 }],
        pricesUpdatedAt: '2026-07-14T00:00:00.000Z',
        tcgplayerUrl: 'https://www.tcgplayer.com/product/567726',
      },
    ]);
    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/v1/cards');
    expect(url.searchParams.get('set')).toBe('sv4a-shiny-treasure-ex');
    expect(url.searchParams.get('search')).toBe('Alakazam');
    expect(new Headers(init?.headers).get('X-API-Key')).toBe('test-key');
  });

  it('follows every PokeTrace catalog cursor with Free-plan pacing', async () => {
    const waitMock = vi.fn(async () => undefined);
    vi.stubGlobal('scheduler', { wait: waitMock });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const cursor = new URL(String(input)).searchParams.get('cursor');
      return cursor
        ? Response.json({
            data: [
              {
                id: '019bffb5-343d-71aa-b29c-09106357b176',
                name: 'Alakazam ex (Japanese)',
                cardNumber: '326/190',
                variant: 'Holofoil',
              },
            ],
            pagination: { hasMore: false, nextCursor: null },
          })
        : Response.json({
            data: [
              {
                id: '019bffb5-343c-76dd-8c13-0fe167871117',
                name: 'Alakazam ex (Japanese)',
                cardNumber: '075/190',
                variant: 'Holofoil',
              },
            ],
            pagination: { hasMore: true, nextCursor: 'page-2' },
          });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });

    const cards = await getCatalogCards(
      { POKETRACE_API_KEY: 'test-key' } as Env,
      'sv4a-shiny-treasure-ex',
      65,
      'Japanese',
      'Alakazam',
    );

    expect(cards.map((card) => card.number)).toEqual(['075', '326']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('cursor')).toBe('page-2');
    expect(waitMock).toHaveBeenCalledOnce();
    expect(waitMock).toHaveBeenCalledWith(2_000);
  });

  it('retries a temporary upstream gateway error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 504 }))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });

    await expect(getCatalogCards({} as Env, 'base1', 1)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('groups catalog IDs into one fresh pricing search', async () => {
    const fetchMock = stubCatalog([
      {
        id: 'base1-44',
        name: 'Bulbasaur',
        number: '44',
        rarity: 'Common',
        tcgplayer: { updatedAt: '2026/07/16', prices: { normal: { market: 3.25 } } },
      },
    ]);

    const cards = await getCatalogCardsByIds({} as Env, ['base1-44', 'sv3pt5-1', 'base1-44']);

    expect(cards[0].prices[0].marketCents).toBe(325);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get('q')).toBe('(id:"base1-44" OR id:"sv3pt5-1")');
  });

  it('refreshes PokeTrace cards in a TCGplayer ID batch', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          {
            id: '019bffb5-343d-71aa-b29c-09106357b176',
            name: 'Alakazam ex (Japanese)',
            cardNumber: '326/190',
            variant: 'Holofoil',
            refs: { tcgplayerId: '567726' },
            prices: {
              tcgplayer: {
                NEAR_MINT: { avg: 2.05, low: 1.9, high: 2.2, lastUpdated: '2026-07-17T12:00:00Z' },
              },
            },
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });

    const catalogId = 'poketrace:019bffb5-343d-71aa-b29c-09106357b176:tcg:567726';
    const cards = await getCatalogCardsByIds({ POKETRACE_API_KEY: 'test-key' } as Env, [catalogId]);

    expect(cards[0]).toMatchObject({
      id: catalogId,
      pricesUpdatedAt: '2026-07-17T12:00:00Z',
      prices: [{ printing: 'Holofoil', marketCents: 205 }],
    });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/v1/cards');
    expect(url.searchParams.get('tcgplayer_ids')).toBe('567726');
  });

  it('uses an eBay marketplace URL when it is the only PokeTrace fallback', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [
          {
            id: '019bffb5-343d-71aa-b29c-09106357b176',
            name: 'Alakazam ex (Japanese)',
            cardNumber: '326/190',
            marketplaceUrls: { ebay: 'https://www.ebay.com/itm/123456789' },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });

    const cards = await getCatalogCards(
      { POKETRACE_API_KEY: 'test-key' } as Env,
      'sv4a-shiny-treasure-ex',
      65,
      'Japanese',
      'Alakazam',
    );

    expect(cards[0].tcgplayerUrl).toBe('https://www.ebay.com/itm/123456789');
  });

  it('rotates large TCGdex refreshes through a bounded daily window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00Z'));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const id = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) || '');
      return Response.json({ id, localId: id.split('-').at(-1), name: `Card ${id}` });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });
    const ids = Array.from({ length: 45 }, (_, index) => `tcgdex:ja:test-${index + 1}`);

    const firstDay = await getCatalogCardRefreshByIds({} as Env, ids);
    expect(firstDay.cards.length).toBeGreaterThan(0);
    expect(firstDay.cards.length).toBeLessThanOrEqual(20);
    expect(firstDay.cards.length + firstDay.deferredCardIds.length).toBe(45);
    expect(fetchMock).toHaveBeenCalledTimes(firstDay.cards.length);

    fetchMock.mockClear();
    vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
    const secondDay = await getCatalogCardRefreshByIds({} as Env, ids);
    expect(secondDay.cards.length).toBeLessThanOrEqual(20);
    expect(secondDay.cards.map((card) => card.id)).not.toEqual(firstDay.cards.map((card) => card.id));
    expect(fetchMock).toHaveBeenCalledTimes(secondDay.cards.length);
  });

  it('shares one refresh request budget across every catalog provider', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00Z'));
    vi.stubGlobal('scheduler', { wait: vi.fn(async () => undefined) });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const id = decodeURIComponent(url.pathname.split('/').at(-1) || '');
      if (url.hostname === 'api.pokemontcg.io') return Response.json({ data: [] });
      if (url.hostname === 'api.poketrace.com') {
        return Response.json({ data: { id, name: `Card ${id}`, cardNumber: '1' } });
      }
      return Response.json({ id, localId: id.split('-').at(-1), name: `Card ${id}` });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });
    const englishIds = Array.from({ length: 2_500 }, (_, index) => `base1-${index + 1}`);
    const tcgdexIds = Array.from({ length: 25 }, (_, index) => `tcgdex:fr:test-${index + 1}`);
    const pokeTraceIds = Array.from(
      { length: 25 },
      (_, index) => `poketrace:00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    );

    const result = await getCatalogCardRefreshByIds({ POKETRACE_API_KEY: 'test-key' } as Env, [
      ...englishIds,
      ...tcgdexIds,
      ...pokeTraceIds,
    ]);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(20);
    expect(result.deferredCardIds.length).toBeGreaterThan(0);
  });

  it('paces PokeTrace refresh jobs and defers only the job that still fails', async () => {
    const waitMock = vi.fn(async () => undefined);
    vi.stubGlobal('scheduler', { wait: waitMock });
    const ids = [
      'poketrace:00000000-0000-0000-0000-000000000001',
      'poketrace:00000000-0000-0000-0000-000000000002',
      'poketrace:00000000-0000-0000-0000-000000000003',
    ];
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const id = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) || '');
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await Promise.resolve();
      activeRequests -= 1;
      if (id.endsWith('2')) return new Response(null, { status: 503 });
      return Response.json({ data: { id, name: `Card ${id}`, cardNumber: '1' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await getCatalogCardRefreshByIds({ POKETRACE_API_KEY: 'test-key' } as Env, ids);

    expect(result.cards.map((card) => card.id)).toEqual([ids[0], ids[2]]);
    expect(result.deferredCardIds).toEqual([ids[1]]);
    expect(maximumActiveRequests).toBe(1);
    expect(waitMock).toHaveBeenCalledTimes(2);
    expect(waitMock).toHaveBeenNthCalledWith(1, 2_000);
    expect(waitMock).toHaveBeenNthCalledWith(2, 2_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Catalog refresh job failed'));
  });

  it('skips a stale TCGdex card without failing the rest of its refresh batch', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const id = decodeURIComponent(new URL(String(input)).pathname.split('/').at(-1) || '');
      if (id === 'missing-card') return new Response(null, { status: 404 });
      return Response.json({ id, localId: '1', name: 'Available card' });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });

    const result = await getCatalogCardRefreshByIds({}, ['tcgdex:fr:missing-card', 'tcgdex:fr:available-card']);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].id).toBe('tcgdex:fr:available-card');
    expect(result.deferredCardIds).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
