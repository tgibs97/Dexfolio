import type { PokedexSyncResponse, PokedexSyncStatus, SyncedPokemon } from '../shared/types';
import { type ExternalApiRequestLogger, withExternalApiLogging } from './externalApiLogs';

const API_ROOT = 'https://pokeapi.co/api/v2';
const API_TIMEOUT_MS = 12_000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

interface NamedResource {
  name: string;
  url: string;
}

interface ListResponse {
  count: number;
  results: NamedResource[];
}

interface GenerationResponse {
  id: number;
  pokemon_species: NamedResource[];
}

export class PokedexUnavailableError extends Error {}

/** Compare D1 with PokéAPI without mutating the collection. */
export async function getPokedexSyncStatus(db: D1Database): Promise<PokedexSyncStatus> {
  return withExternalApiLogging(db, (logger) => getPokedexSyncStatusLogged(db, logger));
}

async function getPokedexSyncStatusLogged(
  db: D1Database,
  logger: ExternalApiRequestLogger,
): Promise<PokedexSyncStatus> {
  const [stored, upstream] = await Promise.all([
    storedPokemonCount(db),
    fetchPokeApi<ListResponse>(logger, '/pokemon-species?limit=1&offset=0'),
  ]);
  const upstreamTotal = validCount(upstream.count);
  return {
    stored,
    upstreamTotal,
    available: Math.max(0, upstreamTotal - stored),
    checkedAt: new Date().toISOString(),
  };
}

/** Insert only previously unknown species and create their empty binder slots. */
export async function syncPokedex(db: D1Database): Promise<PokedexSyncResponse> {
  return withExternalApiLogging(db, (logger) => syncPokedexLogged(db, logger));
}

async function syncPokedexLogged(db: D1Database, logger: ExternalApiRequestLogger): Promise<PokedexSyncResponse> {
  const [storedBefore, speciesList] = await Promise.all([
    storedPokemonCount(db),
    fetchPokeApi<ListResponse>(logger, '/pokemon-species?limit=100000&offset=0'),
  ]);
  const upstreamTotal = validCount(speciesList.count);
  if (speciesList.results.length !== upstreamTotal) {
    throw new PokedexUnavailableError('PokéAPI returned an incomplete species list.');
  }

  const existingRows = await db.prepare('SELECT id FROM pokemon').all<{ id: number }>();
  const existingIds = new Set(existingRows.results.map((row) => row.id));
  const newResources = speciesList.results.filter(
    (resource) => !existingIds.has(resourceId(resource.url, 'pokemon-species')),
  );
  if (!newResources.length) return syncResponse(storedBefore, upstreamTotal, [], storedBefore);

  const generations = await fetchPokeApi<ListResponse>(logger, '/generation?limit=100&offset=0');
  if (!Number.isInteger(generations.count) || generations.results.length !== generations.count) {
    throw new PokedexUnavailableError('PokéAPI returned an incomplete generation list.');
  }
  const generationDetails = await Promise.all(
    generations.results.map((resource) => fetchPokeApi<GenerationResponse>(logger, resource.url)),
  );
  const generationBySpecies = new Map<number, number>();
  for (const generation of generationDetails) {
    if (!Number.isInteger(generation.id) || generation.id < 1 || generation.id > 99) continue;
    for (const species of generation.pokemon_species) {
      generationBySpecies.set(resourceId(species.url, 'pokemon-species'), generation.id);
    }
  }

  const records = newResources
    .map((resource): SyncedPokemon => {
      const nationalDexNumber = resourceId(resource.url, 'pokemon-species');
      const generation = generationBySpecies.get(nationalDexNumber);
      if (!generation) throw new PokedexUnavailableError(`PokéAPI omitted generation data for #${nationalDexNumber}.`);
      return { nationalDexNumber, name: displayName(resource.name), generation };
    })
    .sort((left, right) => left.nationalDexNumber - right.nationalDexNumber);

  const insertStatements = chunk(records, 100).map((recordsBatch) => {
    const placeholders = recordsBatch.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const bindings = recordsBatch.flatMap((record) => [
      record.nationalDexNumber,
      record.nationalDexNumber,
      record.name,
      record.generation,
      officialArtworkUrl(record.nationalDexNumber),
    ]);
    return db
      .prepare(
        `INSERT OR IGNORE INTO pokemon
        (id, national_dex_number, name, generation, reference_image_url)
        VALUES ${placeholders}`,
      )
      .bind(...bindings);
  });
  await db.batch([
    ...insertStatements,
    db.prepare('INSERT OR IGNORE INTO collection_slots (pokemon_id) SELECT id FROM pokemon'),
  ]);

  const storedAfter = await storedPokemonCount(db);
  return syncResponse(storedBefore, upstreamTotal, records, storedAfter);
}

function syncResponse(
  storedBefore: number,
  upstreamTotal: number,
  records: SyncedPokemon[],
  storedAfter: number,
): PokedexSyncResponse {
  const now = new Date().toISOString();
  const added = Math.max(0, storedAfter - storedBefore);
  return {
    stored: storedAfter,
    upstreamTotal,
    available: Math.max(0, upstreamTotal - storedAfter),
    checkedAt: now,
    added,
    addedPokemon: records.slice(0, added),
    syncedAt: now,
  };
}

async function storedPokemonCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM pokemon').first<{ count: number }>();
  return row?.count ?? 0;
}

function validCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new PokedexUnavailableError('PokéAPI returned an invalid count.');
  return value;
}

function resourceId(urlValue: string, resource: string): number {
  const url = validatedPokeApiUrl(urlValue);
  const match = url.pathname.match(new RegExp(`/${resource}/(\\d+)/?$`));
  const id = Number(match?.[1]);
  if (!Number.isInteger(id) || id < 1) throw new PokedexUnavailableError('PokéAPI returned an invalid resource URL.');
  return id;
}

function validatedPokeApiUrl(value: string): URL {
  const url = /^https:\/\//i.test(value) ? new URL(value) : new URL(value.replace(/^\//, ''), `${API_ROOT}/`);
  if (url.protocol !== 'https:' || url.hostname !== 'pokeapi.co' || !url.pathname.startsWith('/api/v2/')) {
    throw new PokedexUnavailableError('PokéAPI returned an unsafe resource URL.');
  }
  return url;
}

function officialArtworkUrl(number: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${number}.png`;
}

function displayName(identifier: string): string {
  const specialNames: Record<string, string> = {
    farfetchd: "Farfetch'd",
    'mr-mime': 'Mr. Mime',
    'mime-jr': 'Mime Jr.',
    'type-null': 'Type: Null',
    flabebe: 'Flabébé',
    sirfetchd: "Sirfetch'd",
    'mr-rime': 'Mr. Rime',
  };
  return (
    specialNames[identifier] ??
    identifier
      .split('-')
      .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
      .join('-')
  );
}

async function fetchPokeApi<T>(logger: ExternalApiRequestLogger, resource: string): Promise<T> {
  const url = validatedPokeApiUrl(resource);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (error) {
      logger.record({
        provider: 'PokéAPI',
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
      throw new PokedexUnavailableError(timedOut ? 'PokéAPI request timed out.' : 'PokéAPI request failed.');
    }
    logger.record({
      provider: 'PokéAPI',
      method: 'GET',
      url: url.toString(),
      statusCode: response.status,
      success: response.ok,
      durationMs: Date.now() - startedAt,
      errorMessage: response.ok ? null : `HTTP ${response.status}`,
      requestedAt: new Date(startedAt).toISOString(),
    });
    if (response.ok) return (await response.json()) as T;
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === 1) {
      throw new PokedexUnavailableError(`PokéAPI returned ${response.status}.`);
    }
  }
  throw new PokedexUnavailableError('PokéAPI request failed.');
}

function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );
}
