import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../worker/index';

const origin = 'http://example.com';

afterEach(() => vi.unstubAllGlobals());

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM external_api_logs'),
    env.DB.prepare("UPDATE app_settings SET value = '1' WHERE key = 'external_api_logging_enabled'"),
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
  return { Cookie: response.headers.get('Set-Cookie')!.split(';')[0], Origin: origin };
}

function request(path: string, init: RequestInit, headers: HeadersInit) {
  return app.fetch(new Request(`${origin}${path}`, { ...init, headers }), env);
}

function resource(type: string, id: number, name: string) {
  return { name, url: `https://pokeapi.co/api/v2/${type}/${id}/` };
}

describe('Pokédex synchronization', () => {
  it('logs external requests and honors the admin logging switch', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 1 ? new Response(null, { status: 503 }) : Response.json({ count: 2, results: [] });
      }),
    );
    const headers = await authenticatedHeaders();

    expect((await request('/api/admin/pokedex/status', {}, headers)).status).toBe(200);
    const activityResponse = await request('/api/admin/external-api-logs', {}, headers);
    expect(activityResponse.status).toBe(200);
    expect(await activityResponse.json()).toMatchObject({
      enabled: true,
      total: 2,
      logs: [
        {
          provider: 'PokéAPI',
          method: 'GET',
          statusCode: 200,
          success: true,
        },
        {
          provider: 'PokéAPI',
          method: 'GET',
          statusCode: 503,
          success: false,
        },
      ],
      nextBeforeId: null,
    });

    const disableResponse = await request(
      '/api/admin/external-api-logging',
      { method: 'PUT', body: JSON.stringify({ enabled: false }) },
      headers,
    );
    expect(await disableResponse.json()).toEqual({ enabled: false });
    expect((await request('/api/admin/pokedex/status', {}, headers)).status).toBe(200);
    expect(await (await request('/api/admin/external-api-logs', {}, headers)).json()).toMatchObject({
      enabled: false,
      total: 2,
    });
  });

  it('checks for and explicitly inserts only new species with binder slots', async () => {
    const species = [
      resource('pokemon-species', 1, 'changed-bulbasaur'),
      resource('pokemon-species', 2, 'ivysaur'),
      resource('pokemon-species', 3, 'venusaur'),
      resource('pokemon-species', 4, 'charmander'),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v2/pokemon-species') {
          return Response.json({
            count: species.length,
            results: url.searchParams.get('limit') === '1' ? [species[0]] : species,
          });
        }
        if (url.pathname === '/api/v2/generation') {
          return Response.json({ count: 1, results: [resource('generation', 1, 'generation-i')] });
        }
        if (url.pathname === '/api/v2/generation/1/') {
          return Response.json({ id: 1, pokemon_species: species });
        }
        return new Response(null, { status: 404 });
      }),
    );
    const headers = await authenticatedHeaders();

    const statusResponse = await request('/api/admin/pokedex/status', {}, headers);
    expect(await statusResponse.json()).toMatchObject({ stored: 2, upstreamTotal: 4, available: 2 });

    const syncResponse = await request('/api/admin/pokedex/sync', { method: 'POST' }, headers);
    expect(syncResponse.status).toBe(200);
    expect(await syncResponse.json()).toMatchObject({
      stored: 4,
      upstreamTotal: 4,
      available: 0,
      added: 2,
      addedPokemon: [
        { nationalDexNumber: 3, name: 'Venusaur', generation: 1 },
        { nationalDexNumber: 4, name: 'Charmander', generation: 1 },
      ],
    });
    expect(await env.DB.prepare('SELECT name FROM pokemon WHERE id = 1').first()).toEqual({ name: 'Bulbasaur' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM collection_slots').first()).toEqual({ count: 4 });

    const repeatedResponse = await request('/api/admin/pokedex/sync', { method: 'POST' }, headers);
    expect(await repeatedResponse.json()).toMatchObject({ stored: 4, available: 0, added: 0, addedPokemon: [] });
  });

  it('requires authentication before checking the upstream catalog', async () => {
    const response = await app.fetch(new Request(`${origin}/api/admin/pokedex/status`), env);
    expect(response.status).toBe(401);
  });
});
