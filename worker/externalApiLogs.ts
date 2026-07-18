import type { ExternalApiActivityResponse, ExternalApiLogEntry } from '../shared/types';

const LOGGING_SETTING_KEY = 'external_api_logging_enabled';
const PAGE_SIZE = 50;
const MAX_LOGS_PER_INSERT = 12;

interface PendingExternalApiLog {
  provider: string;
  method: string;
  url: string;
  statusCode: number | null;
  success: boolean;
  durationMs: number;
  errorMessage: string | null;
  requestedAt: string;
}

export interface ExternalApiRequestLogger {
  record(entry: PendingExternalApiLog): void;
  flush(): Promise<void>;
}

interface ExternalApiLogRow {
  id: number;
  provider: string;
  method: string;
  url: string;
  status_code: number | null;
  success: number;
  duration_ms: number;
  error_message: string | null;
  requested_at: string;
}

/** Buffer logs within one request and flush them in small multi-row D1 statements. */
export function createExternalApiRequestLogger(db: D1Database | undefined): ExternalApiRequestLogger {
  const entries: PendingExternalApiLog[] = [];
  return {
    record(entry) {
      if (db) entries.push(entry);
    },
    async flush() {
      if (!db || !entries.length) return;
      const pending = entries.splice(0);
      try {
        for (const group of chunk(pending, MAX_LOGS_PER_INSERT)) {
          const selects = group
            .map(
              () =>
                `SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE COALESCE(
                  (SELECT value FROM app_settings WHERE key = '${LOGGING_SETTING_KEY}'), '1'
                ) = '1'`,
            )
            .join(' UNION ALL ');
          await db
            .prepare(
              `INSERT INTO external_api_logs
                (provider, method, url, status_code, success, duration_ms, error_message, requested_at)
              ${selects}`,
            )
            .bind(...group.flatMap(logBindings))
            .run();
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            message: 'External API request log write failed',
            entryCount: pending.length,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
  };
}

export async function withExternalApiLogging<T>(
  db: D1Database | undefined,
  operation: (logger: ExternalApiRequestLogger) => Promise<T>,
): Promise<T> {
  const logger = createExternalApiRequestLogger(db);
  try {
    return await operation(logger);
  } finally {
    await logger.flush();
  }
}

export async function getExternalApiActivity(
  db: D1Database,
  beforeId: number | null,
): Promise<ExternalApiActivityResponse> {
  const where = beforeId ? 'WHERE id < ?' : '';
  const statement = db
    .prepare(
      `SELECT id, provider, method, url, status_code, success, duration_ms, error_message, requested_at
      FROM external_api_logs ${where}
      ORDER BY id DESC
      LIMIT ?`,
    )
    .bind(...(beforeId ? [beforeId, PAGE_SIZE + 1] : [PAGE_SIZE + 1]));
  const [setting, count, rows] = await Promise.all([
    db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(LOGGING_SETTING_KEY).first<{ value: string }>(),
    db.prepare('SELECT COUNT(*) AS count FROM external_api_logs').first<{ count: number }>(),
    statement.all<ExternalApiLogRow>(),
  ]);
  const hasMore = rows.results.length > PAGE_SIZE;
  const visibleRows = rows.results.slice(0, PAGE_SIZE);
  return {
    enabled: setting?.value !== '0',
    total: count?.count ?? 0,
    logs: visibleRows.map(mapExternalApiLog),
    nextBeforeId: hasMore ? (visibleRows.at(-1)?.id ?? null) : null,
  };
}

export async function setExternalApiLogging(db: D1Database, enabled: boolean): Promise<{ enabled: boolean }> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(LOGGING_SETTING_KEY, enabled ? '1' : '0')
    .run();
  return { enabled };
}

function sanitizeExternalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|secret|password|authorization/i.test(key)) url.searchParams.set(key, '[redacted]');
    }
    return url.toString().slice(0, 2048);
  } catch {
    return '[invalid URL]';
  }
}

function logBindings(entry: PendingExternalApiLog): unknown[] {
  return [
    entry.provider.slice(0, 100),
    entry.method.slice(0, 12),
    sanitizeExternalUrl(entry.url),
    entry.statusCode,
    entry.success ? 1 : 0,
    Math.max(0, Math.round(entry.durationMs)),
    entry.errorMessage?.slice(0, 500) ?? null,
    entry.requestedAt,
  ];
}

function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );
}

function mapExternalApiLog(row: ExternalApiLogRow): ExternalApiLogEntry {
  return {
    id: row.id,
    provider: row.provider,
    method: row.method,
    url: row.url,
    statusCode: row.status_code,
    success: Boolean(row.success),
    durationMs: row.duration_ms,
    errorMessage: row.error_message,
    requestedAt: row.requested_at,
  };
}
