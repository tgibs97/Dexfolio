import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import app from '../../worker/index';

const origin = 'http://example.com';

afterEach(() => vi.unstubAllGlobals());

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM catalog_price_history'),
    env.DB.prepare('DELETE FROM owned_cards'),
    env.DB.prepare('DELETE FROM collection_slots'),
    env.DB.prepare('DELETE FROM pokemon'),
    env.DB.prepare(
      "INSERT INTO pokemon (id, national_dex_number, name, generation, reference_image_url) VALUES (1, 1, 'Bulbasaur', 1, 'https://example.com/1.png'), (2, 2, 'Ivysaur', 1, 'https://example.com/2.png')",
    ),
    env.DB.prepare('INSERT INTO collection_slots (pokemon_id) VALUES (1), (2)'),
  ]);
});

async function authenticatedHeaders(): Promise<HeadersInit> {
  const response = await app.fetch(
    new Request(`${origin}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ password: 'correct-horse-battery-staple' }),
    }),
    env,
  );
  expect(response.status).toBe(200);
  return { Cookie: response.headers.get('Set-Cookie')!.split(';')[0], Origin: origin };
}

async function guestHeaders(): Promise<HeadersInit> {
  const response = await app.fetch(
    new Request(`${origin}/api/session/guest`, {
      method: 'POST',
      headers: { Origin: origin },
    }),
    env,
  );
  expect(response.status).toBe(200);
  expect(await response.clone().json()).toEqual({ authenticated: true, role: 'guest' });
  return { Cookie: response.headers.get('Set-Cookie')!.split(';')[0], Origin: origin };
}

function cardForm(name: string, image?: File): FormData {
  const form = new FormData();
  Object.entries({
    cardName: name,
    setName: 'Base Set',
    setCode: 'BS',
    cardNumber: '44/102',
    rarity: 'Common',
    printing: 'Normal',
    language: 'English',
    condition: 'Near mint',
    acquisitionDate: '2026-01-02',
    purchasePrice: '2.50',
    catalogCardId: 'base1-44',
    marketPriceCents: '325',
    lowPriceCents: '250',
    midPriceCents: '350',
    highPriceCents: '499',
    priceUpdatedAt: '2026/07/15',
    tcgplayerUrl: 'https://prices.pokemontcg.io/tcgplayer/base1-44',
    notes: 'Binder copy',
  }).forEach(([key, value]) => form.set(key, value));
  if (image) form.set('image', image);
  return form;
}

async function request(path: string, init: RequestInit, cookieHeaders: HeadersInit) {
  const headers = new Headers(cookieHeaders);
  if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return app.fetch(new Request(`${origin}${path}`, { ...init, headers }), env);
}

describe('collection card workflows', () => {
  it('allows guests to read the binder but blocks writes and Admin endpoints', async () => {
    const headers = await guestHeaders();

    const session = await request('/api/session', {}, headers);
    expect(await session.json()).toEqual({ authenticated: true, role: 'guest' });
    expect((await request('/api/pokemon?sort=number-asc', {}, headers)).status).toBe(200);
    expect((await request('/api/pokemon/1', {}, headers)).status).toBe(200);

    const write = await request('/api/pokemon/1/cards', { method: 'POST', body: cardForm('No access') }, headers);
    expect(write.status).toBe(403);
    expect(await write.json()).toEqual({ error: 'Guest access is view only.' });
    expect((await request('/api/admin/pokedex/status', {}, headers)).status).toBe(403);
    expect((await request('/api/admin/prices/refresh', { method: 'POST' }, headers)).status).toBe(403);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM owned_cards').first<{ count: number }>()).toEqual({
      count: 0,
    });
  });

  it('adds, edits, replaces, restores, and removes a card while retaining history', async () => {
    const headers = await authenticatedHeaders();
    let response = await request('/api/pokemon?sort=number-asc', {}, headers);
    const binder = (await response.json()) as any;
    expect(binder.summary).toMatchObject({ total: 2, collected: 0, percentage: 0 });
    expect(binder.pokemon.map((slot: any) => slot.status)).toEqual(['missing', 'missing']);

    response = await request('/api/pokemon/1/cards', { method: 'POST', body: cardForm('Bulbasaur') }, headers);
    expect(response.status).toBe(201);
    let detail = (await response.json()) as any;
    const firstId = detail.currentCard.id;
    expect(detail.currentCard.cardName).toBe('Bulbasaur');
    expect(detail.currentCard).toMatchObject({
      catalogCardId: 'base1-44',
      marketPriceCents: 325,
      lowPriceCents: 250,
      midPriceCents: 350,
      highPriceCents: 499,
      priceUpdatedAt: '2026/07/15',
      tcgplayerUrl: 'https://prices.pokemontcg.io/tcgplayer/base1-44',
    });
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM catalog_price_history').first<{ count: number }>(),
    ).toEqual({ count: 1 });

    response = await request(
      `/api/cards/${firstId}`,
      { method: 'PATCH', body: cardForm('Bulbasaur — Edited') },
      headers,
    );
    detail = (await response.json()) as any;
    expect(detail.currentCard.cardName).toBe('Bulbasaur — Edited');

    const replacement = cardForm('Bulbasaur EX');
    replacement.set('mode', 'replace');
    response = await request('/api/pokemon/1/cards', { method: 'POST', body: replacement }, headers);
    detail = (await response.json()) as any;
    const replacementId = detail.currentCard.id;
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0]).toMatchObject({ id: firstId, retiredReason: 'replaced', isCurrent: false });

    response = await request(`/api/pokemon/1/cards/${firstId}/restore`, { method: 'POST' }, headers);
    detail = (await response.json()) as any;
    expect(detail.currentCard.id).toBe(firstId);
    expect(detail.history.some((card: any) => card.id === replacementId && card.retiredReason === 'restored')).toBe(
      true,
    );

    response = await request('/api/pokemon/1/card', { method: 'DELETE' }, headers);
    detail = (await response.json()) as any;
    expect(detail.status).toBe('missing');
    expect(detail.currentCard).toBeNull();
    expect(detail.history.some((card: any) => card.id === firstId && card.retiredReason === 'removed')).toBe(true);
  });

  it('rejects disguised uploads and unauthenticated writes', async () => {
    const unauthenticated = await app.fetch(
      new Request(`${origin}/api/pokemon/1/cards`, {
        method: 'POST',
        headers: { Origin: origin },
        body: cardForm('No access'),
      }),
      env,
    );
    expect(unauthenticated.status).toBe(401);
    const headers = await authenticatedHeaders();
    const fake = new File([new TextEncoder().encode('not really an image')], 'card.png', { type: 'image/png' });
    const response = await request(
      '/api/pokemon/1/cards',
      { method: 'POST', body: cardForm('Bad image', fake) },
      headers,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'The file contents do not match its image type.' });
  });

  it('searches by name and exact Pokédex number and filters missing slots', async () => {
    const headers = await authenticatedHeaders();
    const byName = await request('/api/pokemon?q=ivy&status=missing&sort=name-asc', {}, headers);
    expect(((await byName.json()) as any).pokemon.map((slot: any) => slot.name)).toEqual(['Ivysaur']);
    const byNumber = await request('/api/pokemon?q=1&sort=number-asc', {}, headers);
    expect(((await byNumber.json()) as any).pokemon.map((slot: any) => slot.name)).toEqual(['Bulbasaur']);
  });

  it('refreshes saved pricing snapshots from the catalog in bulk', async () => {
    const headers = await authenticatedHeaders();
    await request('/api/pokemon/1/cards', { method: 'POST', body: cardForm('Bulbasaur') }, headers);
    await env.DB.prepare("UPDATE owned_cards SET printing = 'Illustration rare'").run();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [
            {
              id: 'base1-44',
              name: 'Bulbasaur',
              number: '44',
              rarity: 'Common',
              tcgplayer: {
                url: 'https://prices.pokemontcg.io/tcgplayer/base1-44-new',
                updatedAt: '2026/07/16',
                prices: { normal: { low: 3, mid: 4, high: 5, market: 3.75 } },
              },
            },
          ],
        }),
      ),
    );

    const response = await request('/api/admin/prices/refresh', { method: 'POST' }, headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, refreshed: 1, missingCatalogId: 0, missingPricing: 0 });

    const detailResponse = await request('/api/pokemon/1', {}, headers);
    const refreshedDetail = (await detailResponse.json()) as any;
    expect(refreshedDetail.currentCard).toMatchObject({
      printing: 'Normal',
      marketPriceCents: 375,
      lowPriceCents: 300,
      midPriceCents: 400,
      highPriceCents: 500,
      priceUpdatedAt: '2026/07/16',
      tcgplayerUrl: 'https://prices.pokemontcg.io/tcgplayer/base1-44-new',
    });

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO catalog_price_history
        (catalog_card_id, printing, market_price_cents, source_updated_at)
        VALUES ('base1-44', 'Normal', 250, '2026/06/16')`,
      ),
      env.DB.prepare(
        `INSERT INTO catalog_price_history
        (catalog_card_id, printing, market_price_cents, source_updated_at)
        VALUES ('base1-44', 'Normal', 300, '2026/07/09')`,
      ),
    ]);
    const historyResponse = await request(
      `/api/cards/${refreshedDetail.currentCard.id}/price-history?range=all`,
      {},
      headers,
    );
    expect(historyResponse.status).toBe(200);
    expect(await historyResponse.json()).toMatchObject({
      purchasePriceCents: 250,
      currentMarketCents: 375,
      unrealizedGainCents: 125,
      unrealizedGainPercentage: 50,
      change7d: { cents: 75, percentage: 25 },
      change30d: { cents: 125, percentage: 50 },
      history: [
        { marketPriceCents: 250, sourceUpdatedAt: '2026/06/16' },
        { marketPriceCents: 300, sourceUpdatedAt: '2026/07/09' },
        { marketPriceCents: 325, sourceUpdatedAt: '2026/07/15' },
        { marketPriceCents: 375, sourceUpdatedAt: '2026/07/16' },
      ],
    });

    await request('/api/admin/prices/refresh', { method: 'POST' }, headers);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM catalog_price_history').first<{ count: number }>(),
    ).toEqual({ count: 4 });
  });

  it('summarizes current-card spending, value, average, and cost extremes', async () => {
    const headers = await authenticatedHeaders();
    const bulbasaur = cardForm('Bulbasaur ex');
    bulbasaur.set('purchasePrice', '10.00');
    bulbasaur.set('marketPriceCents', '1500');
    const ivysaur = cardForm('Ivysaur');
    ivysaur.set('purchasePrice', '5.00');
    ivysaur.set('marketPriceCents', '800');

    await request('/api/pokemon/1/cards', { method: 'POST', body: bulbasaur }, headers);
    await request('/api/pokemon/2/cards', { method: 'POST', body: ivysaur }, headers);
    const response = await request('/api/pokemon?sort=number-asc', {}, headers);
    const summary = ((await response.json()) as any).summary;

    expect(summary).toMatchObject({
      totalSpentCents: 1500,
      totalValueCents: 2300,
      averageCardValueCents: 1150,
      highestValueCard: { pokemonId: 1, pokemonName: 'Bulbasaur', cardName: 'Bulbasaur ex', cents: 1500 },
      lowestValueCard: { pokemonId: 2, pokemonName: 'Ivysaur', cardName: 'Ivysaur', cents: 800 },
    });
  });

  it('sorts priced cards by amount paid or market value with missing prices last', async () => {
    const headers = await authenticatedHeaders();
    const bulbasaur = cardForm('Bulbasaur');
    bulbasaur.set('purchasePrice', '10.00');
    bulbasaur.set('marketPriceCents', '800');
    const ivysaur = cardForm('Ivysaur');
    ivysaur.set('purchasePrice', '5.00');
    ivysaur.set('marketPriceCents', '1500');
    await request('/api/pokemon/1/cards', { method: 'POST', body: bulbasaur }, headers);
    await request('/api/pokemon/2/cards', { method: 'POST', body: ivysaur }, headers);

    async function names(sort: string) {
      const response = await request(`/api/pokemon?sort=${sort}`, {}, headers);
      return ((await response.json()) as any).pokemon.map((slot: any) => slot.name);
    }

    expect(await names('paid-desc')).toEqual(['Bulbasaur', 'Ivysaur']);
    expect(await names('paid-asc')).toEqual(['Ivysaur', 'Bulbasaur']);
    expect(await names('value-desc')).toEqual(['Ivysaur', 'Bulbasaur']);
    expect(await names('value-asc')).toEqual(['Bulbasaur', 'Ivysaur']);
  });
});
