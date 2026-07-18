import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('catalog API compatibility', () => {
  it('sends the guest password when requesting view-only access', async () => {
    let requestBody = '';
    let contentType = '';
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body);
      contentType = new Headers(init?.headers).get('Content-Type') || '';
      return Response.json({ authenticated: true, role: 'guest' });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.guest('guest password')).resolves.toEqual({ authenticated: true, role: 'guest' });
    expect(contentType).toBe('application/json');
    expect(JSON.parse(requestBody)).toEqual({ password: 'guest password' });
  });

  it('bypasses old caches and normalizes card records from the previous schema', async () => {
    let requestedUrl = '';
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return Response.json({
        cards: [{ id: 'base1-44', name: 'Bulbasaur', number: '44', rarity: 'Common' }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await api.catalogCards('base1', 1, 'Bulbasaur');

    expect(requestedUrl).toContain('catalogVersion=8');
    expect(requestedUrl).toContain('language=English');
    expect(requestedUrl).toContain('pokemonName=Bulbasaur');
    expect(response.cards[0]).toMatchObject({
      availablePrintings: [],
      suggestedPrinting: null,
      prices: [],
      pricesUpdatedAt: null,
      tcgplayerUrl: null,
    });
  });
});
