import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('catalog API compatibility', () => {
  it('bypasses old caches and normalizes card records from the previous schema', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return Response.json({
        cards: [{ id: 'base1-44', name: 'Bulbasaur', number: '44', rarity: 'Common' }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await api.catalogCards('base1', 1);

    expect(requestedUrl).toContain('catalogVersion=6');
    expect(response.cards[0]).toMatchObject({
      availablePrintings: [],
      suggestedPrinting: null,
      prices: [],
      pricesUpdatedAt: null,
      tcgplayerUrl: null,
    });
  });
});
