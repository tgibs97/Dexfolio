import type { CatalogSet } from '../shared/types';

const ENGLISH_SET_CACHE_KEY = 'pokemon-tcg:english-sets:v1';

interface CatalogCacheRow {
  payload: string;
  refreshed_at: string;
}

export interface EnglishSetCatalogCache {
  sets: CatalogSet[];
  refreshedAt: string;
}

/** Read the durable English set snapshot. Invalid rows are treated as a cache miss. */
export async function readEnglishSetCatalog(db: D1Database): Promise<EnglishSetCatalogCache | null> {
  const row = await db
    .prepare('SELECT payload, refreshed_at FROM catalog_cache WHERE cache_key = ? LIMIT 1')
    .bind(ENGLISH_SET_CACHE_KEY)
    .first<CatalogCacheRow>();
  if (!row) return null;
  try {
    const value: unknown = JSON.parse(row.payload);
    if (!isCatalogSetArray(value)) return null;
    return { sets: value, refreshedAt: row.refreshed_at };
  } catch {
    return null;
  }
}

/** Replace the complete snapshot only after a successful provider response. */
export async function writeEnglishSetCatalog(
  db: D1Database,
  sets: CatalogSet[],
  refreshedAt = new Date().toISOString(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO catalog_cache (cache_key, payload, refreshed_at) VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, refreshed_at = excluded.refreshed_at`,
    )
    .bind(ENGLISH_SET_CACHE_KEY, JSON.stringify(sets), refreshedAt)
    .run();
}

function isCatalogSetArray(value: unknown): value is CatalogSet[] {
  return (
    Array.isArray(value) &&
    value.every(
      (set) =>
        isRecord(set) &&
        typeof set.id === 'string' &&
        typeof set.name === 'string' &&
        typeof set.code === 'string' &&
        (typeof set.releaseDate === 'string' || set.releaseDate === null),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
