import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCatalogCards, getCatalogCardsByIds, getCatalogSets } from '../../worker/catalog';
import type { Env } from '../../worker/env';

afterEach(() => vi.unstubAllGlobals());

function stubCatalog(responseData: unknown[]) {
  const fetchMock = vi.fn(async () => Response.json({ data: responseData }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('caches', { default: { match: vi.fn(async () => null), put: vi.fn(async () => undefined) } });
  return fetchMock;
}

describe('Pokémon TCG catalog proxy', () => {
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
});
