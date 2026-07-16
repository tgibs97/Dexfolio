import { type Context, Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { PriceHistoryRange, SortOption } from '../shared/types';
import { clearSession, createSession, credentialsAreValid, getSessionRole, hasAllowedOrigin } from './auth';
import { getCatalogCards, getCatalogCardsByIds, getCatalogSets } from './catalog';
import { exportCollectionArchive, importCollectionArchive, importJsonCollection } from './dataArchive';
import { CollectionBackupError, exportCollectionBackup } from './dataTransfer';
import { getCardPriceHistory, getCardRow, getPokemonDetail, listPokemon } from './db';
import type { Env } from './env';
import { ImageValidationError, storeImage, validateImage } from './images';
import { getPokedexSyncStatus, PokedexUnavailableError, syncPokedex } from './pokedex';
import { cardSchema, formDataToCardInput, loginSchema, priceToCents, snapshotCents } from './validation';

const app = new Hono<{ Bindings: Env }>();
const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://raw.githubusercontent.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
    referrerPolicy: 'no-referrer',
  }),
);

app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !hasAllowedOrigin(c)) {
    return c.json({ error: 'Request origin is not allowed.' }, 403);
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));
app.get('/api/session', async (c) => {
  const role = await getSessionRole(c);
  return c.json({ authenticated: role !== null, role });
});

app.post('/api/session', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON request.' }, 400);
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'A password is required.' }, 400);
  if (!(await credentialsAreValid(parsed.data.password, c.env.ADMIN_PASSWORD))) {
    return c.json({ error: 'The password is incorrect.' }, 401);
  }
  if (!c.env.SESSION_SECRET || c.env.SESSION_SECRET.length < 32) {
    return c.json({ error: 'SESSION_SECRET is not configured securely.' }, 503);
  }
  await createSession(c, 'admin');
  return c.json({ authenticated: true, role: 'admin' as const });
});

app.post('/api/session/guest', async (c) => {
  if (!c.env.SESSION_SECRET || c.env.SESSION_SECRET.length < 32) {
    return c.json({ error: 'SESSION_SECRET is not configured securely.' }, 503);
  }
  await createSession(c, 'guest');
  return c.json({ authenticated: true, role: 'guest' as const });
});

app.delete('/api/session', (c) => {
  clearSession(c);
  return c.json({ authenticated: false, role: null });
});

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health' || c.req.path === '/api/session' || c.req.path === '/api/session/guest') {
    return next();
  }
  const role = await getSessionRole(c);
  if (!role) return c.json({ error: 'Authentication required.' }, 401);
  if (
    role === 'guest' &&
    (c.req.path.startsWith('/api/admin/') || !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method))
  ) {
    return c.json({ error: 'Guest access is view only.' }, 403);
  }
  await next();
});

app.get('/api/pokemon', async (c) => {
  const sortValues: SortOption[] = [
    'number-asc',
    'number-desc',
    'name-asc',
    'name-desc',
    'added-desc',
    'added-asc',
    'paid-desc',
    'paid-asc',
    'value-desc',
    'value-asc',
  ];
  const requestedSort = c.req.query('sort') as SortOption | undefined;
  const generation = Number(c.req.query('generation')) || undefined;
  const status = c.req.query('status');
  return c.json(
    await listPokemon(c.env.DB, {
      q: c.req.query('q')?.trim(),
      status: status === 'collected' || status === 'missing' ? status : undefined,
      generation: generation && generation >= 1 && generation <= 99 ? generation : undefined,
      sort: requestedSort && sortValues.includes(requestedSort) ? requestedSort : 'number-asc',
    }),
  );
});

app.get('/api/catalog/sets', async (c) => {
  try {
    return c.json({ sets: await getCatalogSets(c.env) }, 200, { 'Cache-Control': 'private, max-age=3600' });
  } catch (error) {
    console.error('Set catalog lookup failed', error);
    return c.json({ error: 'Card set suggestions are temporarily unavailable.' }, 502);
  }
});

app.get('/api/catalog/cards', async (c) => {
  const setId = c.req.query('setId')?.trim() || '';
  const pokemonNumber = positiveInteger(c.req.query('pokemonNumber') || '');
  if (!/^[a-zA-Z0-9-]{1,40}$/.test(setId) || !pokemonNumber) {
    return c.json({ error: 'A valid set and Pokédex number are required.' }, 400);
  }
  try {
    return c.json({ cards: await getCatalogCards(c.env, setId, pokemonNumber) }, 200, {
      'Cache-Control': 'private, max-age=3600',
    });
  } catch (error) {
    console.error('Card catalog lookup failed', error);
    return c.json({ error: 'Card suggestions are temporarily unavailable.' }, 502);
  }
});

app.get('/api/admin/pokedex/status', async (c) => {
  try {
    return c.json(await getPokedexSyncStatus(c.env.DB));
  } catch (error) {
    if (!(error instanceof PokedexUnavailableError)) throw error;
    console.error('Pokédex update check failed', error);
    return c.json({ error: 'The Pokédex could not be checked against PokéAPI.' }, 502);
  }
});

app.post('/api/admin/pokedex/sync', async (c) => {
  try {
    return c.json(await syncPokedex(c.env.DB));
  } catch (error) {
    if (!(error instanceof PokedexUnavailableError)) throw error;
    console.error('Pokédex sync failed', error);
    return c.json({ error: 'New Pokémon could not be synchronized from PokéAPI.' }, 502);
  }
});

app.get('/api/admin/data/export', async (c) => {
  const date = new Date().toISOString().slice(0, 10);
  if (c.req.query('format') === 'json') {
    return c.json(await exportCollectionBackup(c.env.DB), 200, {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="dexfolio-${date}.json"`,
    });
  }
  const archive = await exportCollectionArchive(c.env);
  return new Response(archive.stream, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="dexfolio-${date}.zip"`,
      'Content-Type': 'application/zip',
      'X-Dexfolio-Cards': String(archive.cards),
      'X-Dexfolio-Images': String(archive.images),
    },
  });
});

app.post('/api/admin/data/import', async (c) => {
  const contentLength = Number(c.req.header('content-length'));
  if (contentLength > 50 * 1024 * 1024) return c.json({ error: 'The backup file must be 50 MB or smaller.' }, 413);
  const buffer = await c.req.raw.arrayBuffer();
  if (buffer.byteLength > 50 * 1024 * 1024) {
    return c.json({ error: 'The backup file must be 50 MB or smaller.' }, 413);
  }
  try {
    const bytes = new Uint8Array(buffer);
    const isZip = c.req.header('content-type')?.includes('zip') || (bytes[0] === 0x50 && bytes[1] === 0x4b);
    if (isZip) return c.json(await importCollectionArchive(c.env, buffer));
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return c.json({ error: 'The selected file is not valid JSON or a Dexfolio ZIP backup.' }, 400);
    }
    return c.json(await importJsonCollection(c.env, body));
  } catch (error) {
    if (error instanceof CollectionBackupError) return c.json({ error: error.message }, 422);
    throw error;
  }
});

app.post('/api/admin/prices/refresh', async (c) => {
  const rows = await c.env.DB.prepare('SELECT id, catalog_card_id, printing FROM owned_cards ORDER BY added_at').all<{
    id: string;
    catalog_card_id: string | null;
    printing: string;
  }>();
  const linked = rows.results.filter((row): row is { id: string; catalog_card_id: string; printing: string } =>
    Boolean(row.catalog_card_id),
  );
  if (!linked.length) {
    return c.json({
      total: rows.results.length,
      refreshed: 0,
      missingCatalogId: rows.results.length,
      missingPricing: 0,
      refreshedAt: new Date().toISOString(),
    });
  }

  try {
    const catalogCards = await getCatalogCardsByIds(
      c.env,
      linked.map((row) => row.catalog_card_id),
    );
    const catalogById = new Map(catalogCards.map((card) => [card.id, card]));
    const statements: D1PreparedStatement[] = [];
    let refreshed = 0;
    let missingPricing = 0;
    for (const owned of linked) {
      const catalog = catalogById.get(owned.catalog_card_id);
      const price =
        catalog?.prices.find((candidate) => candidate.printing === owned.printing) ||
        (catalog?.prices.length === 1 ? catalog.prices[0] : undefined);
      if (!catalog || !price) {
        missingPricing += 1;
        continue;
      }
      const historyStatement = priceHistoryStatement(c.env.DB, {
        catalogCardId: catalog.id,
        printing: price.printing,
        marketPriceCents: price.marketCents,
        lowPriceCents: price.lowCents,
        midPriceCents: price.midCents,
        highPriceCents: price.highCents,
        sourceUpdatedAt: catalog.pricesUpdatedAt,
      });
      if (historyStatement) statements.push(historyStatement);
      statements.push(
        c.env.DB.prepare(
          `UPDATE owned_cards SET printing = ?, market_price_cents = ?, low_price_cents = ?, mid_price_cents = ?,
          high_price_cents = ?, price_updated_at = ?, tcgplayer_url = ? WHERE id = ?`,
        ).bind(
          price.printing,
          price.marketCents,
          price.lowCents,
          price.midCents,
          price.highCents,
          catalog.pricesUpdatedAt,
          catalog.tcgplayerUrl,
          owned.id,
        ),
      );
      refreshed += 1;
    }
    for (const batch of chunk(statements, 100)) await c.env.DB.batch(batch);
    return c.json({
      total: rows.results.length,
      refreshed,
      missingCatalogId: rows.results.length - linked.length,
      missingPricing,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Bulk pricing refresh failed', error);
    return c.json({ error: 'Pricing could not be refreshed from the card catalog.' }, 502);
  }
});

app.get('/api/pokemon/:id', async (c) => {
  const id = positiveInteger(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid Pokémon ID.' }, 400);
  const detail = await getPokemonDetail(c.env.DB, id);
  return detail ? c.json(detail) : c.json({ error: 'Pokémon not found.' }, 404);
});

app.get('/api/cards/:id/price-history', async (c) => {
  const requestedRange = c.req.query('range') || '90d';
  const ranges: PriceHistoryRange[] = ['30d', '90d', '1y', 'all'];
  if (!ranges.includes(requestedRange as PriceHistoryRange)) {
    return c.json({ error: 'Use a valid price history range.' }, 400);
  }
  const history = await getCardPriceHistory(c.env.DB, c.req.param('id'), requestedRange as PriceHistoryRange);
  return history ? c.json(history) : c.json({ error: 'Card not found.' }, 404);
});

app.post('/api/pokemon/:id/cards', async (c) => {
  const pokemonId = positiveInteger(c.req.param('id'));
  if (!pokemonId) return c.json({ error: 'Invalid Pokémon ID.' }, 400);
  const detail = await getPokemonDetail(c.env.DB, pokemonId);
  if (!detail) return c.json({ error: 'Pokémon not found.' }, 404);

  const form = await safeFormData(c.req.raw);
  if (!form) return c.json({ error: 'Use multipart form data.' }, 400);
  const parsed = cardSchema.safeParse(formDataToCardInput(form));
  if (!parsed.success) return validationResponse(c, parsed.error.flatten().fieldErrors);
  const replace = form.get('mode') === 'replace';
  if (detail.currentCard && !replace)
    return c.json({ error: 'This slot already has a card. Use Replace Card instead.' }, 409);

  let image;
  try {
    image = await validateImage(form.get('image'));
  } catch (error) {
    return imageErrorResponse(c, error);
  }
  const cardId = crypto.randomUUID();
  let imageKey: string | null = null;
  try {
    if (image) imageKey = await storeImage(c.env, pokemonId, image);
    const data = parsed.data;
    const marketPriceCents = snapshotCents(data.marketPriceCents);
    const lowPriceCents = snapshotCents(data.lowPriceCents);
    const midPriceCents = snapshotCents(data.midPriceCents);
    const highPriceCents = snapshotCents(data.highPriceCents);
    const statements: D1PreparedStatement[] = [];
    if (detail.currentCard) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE owned_cards SET is_current = 0, replaced_at = ${nowSql}, retired_reason = 'replaced', updated_at = ${nowSql} WHERE id = ?`,
        ).bind(detail.currentCard.id),
      );
    }
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO owned_cards (
      id, pokemon_id, card_name, set_name, set_code, card_number, rarity, printing, language, condition,
      acquisition_date, purchase_price_cents, catalog_card_id, market_price_cents, low_price_cents,
      mid_price_cents, high_price_cents, price_updated_at, tcgplayer_url, notes, image_key, image_content_type, is_current
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ).bind(
        cardId,
        pokemonId,
        data.cardName,
        data.setName,
        emptyToNull(data.setCode),
        data.cardNumber,
        emptyToNull(data.rarity),
        data.printing,
        data.language,
        data.condition,
        emptyToNull(data.acquisitionDate),
        priceToCents(data.purchasePrice),
        emptyToNull(data.catalogCardId),
        marketPriceCents,
        lowPriceCents,
        midPriceCents,
        highPriceCents,
        emptyToNull(data.priceUpdatedAt),
        emptyToNull(data.tcgplayerUrl),
        emptyToNull(data.notes),
        imageKey,
        image?.contentType ?? null,
      ),
    );
    const historyStatement = priceHistoryStatement(c.env.DB, {
      catalogCardId: emptyToNull(data.catalogCardId),
      printing: data.printing,
      marketPriceCents,
      lowPriceCents,
      midPriceCents,
      highPriceCents,
      sourceUpdatedAt: emptyToNull(data.priceUpdatedAt),
    });
    if (historyStatement) statements.push(historyStatement);
    statements.push(
      c.env.DB.prepare(
        `UPDATE collection_slots SET current_card_id = ?, updated_at = ${nowSql} WHERE pokemon_id = ?`,
      ).bind(cardId, pokemonId),
    );
    await c.env.DB.batch(statements);
  } catch (error) {
    if (imageKey) await c.env.CARD_IMAGES.delete(imageKey);
    console.error('Failed to save card', error);
    return c.json({ error: 'The card could not be saved.' }, 500);
  }
  return c.json(await getPokemonDetail(c.env.DB, pokemonId), 201);
});

app.patch('/api/cards/:id', async (c) => {
  const cardId = c.req.param('id');
  const existing = await getCardRow(c.env.DB, cardId);
  if (!existing) return c.json({ error: 'Card not found.' }, 404);
  const form = await safeFormData(c.req.raw);
  if (!form) return c.json({ error: 'Use multipart form data.' }, 400);
  const parsed = cardSchema.safeParse(formDataToCardInput(form));
  if (!parsed.success) return validationResponse(c, parsed.error.flatten().fieldErrors);
  let image;
  try {
    image = await validateImage(form.get('image'));
  } catch (error) {
    return imageErrorResponse(c, error);
  }
  let imageKey = existing.image_key;
  let newImageKey: string | null = null;
  try {
    if (image) {
      newImageKey = await storeImage(c.env, existing.pokemon_id, image);
      imageKey = newImageKey;
    }
    const data = parsed.data;
    const marketPriceCents = snapshotCents(data.marketPriceCents);
    const lowPriceCents = snapshotCents(data.lowPriceCents);
    const midPriceCents = snapshotCents(data.midPriceCents);
    const highPriceCents = snapshotCents(data.highPriceCents);
    const updateStatement = c.env.DB.prepare(
      `UPDATE owned_cards SET card_name = ?, set_name = ?, set_code = ?, card_number = ?, rarity = ?,
      printing = ?, language = ?, condition = ?, acquisition_date = ?, purchase_price_cents = ?, notes = ?,
      catalog_card_id = ?, market_price_cents = ?, low_price_cents = ?, mid_price_cents = ?, high_price_cents = ?,
      price_updated_at = ?, tcgplayer_url = ?, image_key = ?, image_content_type = COALESCE(?, image_content_type), updated_at = ${nowSql} WHERE id = ?`,
    ).bind(
      data.cardName,
      data.setName,
      emptyToNull(data.setCode),
      data.cardNumber,
      emptyToNull(data.rarity),
      data.printing,
      data.language,
      data.condition,
      emptyToNull(data.acquisitionDate),
      priceToCents(data.purchasePrice),
      emptyToNull(data.notes),
      emptyToNull(data.catalogCardId),
      marketPriceCents,
      lowPriceCents,
      midPriceCents,
      highPriceCents,
      emptyToNull(data.priceUpdatedAt),
      emptyToNull(data.tcgplayerUrl),
      imageKey,
      image?.contentType ?? null,
      cardId,
    );
    const historyStatement = priceHistoryStatement(c.env.DB, {
      catalogCardId: emptyToNull(data.catalogCardId),
      printing: data.printing,
      marketPriceCents,
      lowPriceCents,
      midPriceCents,
      highPriceCents,
      sourceUpdatedAt: emptyToNull(data.priceUpdatedAt),
    });
    await c.env.DB.batch(historyStatement ? [updateStatement, historyStatement] : [updateStatement]);
    if (newImageKey && existing.image_key) await c.env.CARD_IMAGES.delete(existing.image_key);
  } catch (error) {
    if (newImageKey) await c.env.CARD_IMAGES.delete(newImageKey);
    console.error('Failed to update card', error);
    return c.json({ error: 'The card could not be updated.' }, 500);
  }
  return c.json(await getPokemonDetail(c.env.DB, existing.pokemon_id));
});

app.post('/api/pokemon/:pokemonId/cards/:cardId/restore', async (c) => {
  const pokemonId = positiveInteger(c.req.param('pokemonId'));
  if (!pokemonId) return c.json({ error: 'Invalid Pokémon ID.' }, 400);
  const [detail, target] = await Promise.all([
    getPokemonDetail(c.env.DB, pokemonId),
    getCardRow(c.env.DB, c.req.param('cardId')),
  ]);
  if (!detail) return c.json({ error: 'Pokémon not found.' }, 404);
  if (!target || target.pokemon_id !== pokemonId) return c.json({ error: 'Previous card not found.' }, 404);
  if (target.is_current) return c.json({ error: 'That card is already current.' }, 409);
  const statements: D1PreparedStatement[] = [];
  if (detail.currentCard)
    statements.push(
      c.env.DB.prepare(
        `UPDATE owned_cards SET is_current = 0, replaced_at = ${nowSql}, retired_reason = 'restored', updated_at = ${nowSql} WHERE id = ?`,
      ).bind(detail.currentCard.id),
    );
  statements.push(
    c.env.DB.prepare(
      `UPDATE owned_cards SET is_current = 1, replaced_at = NULL, retired_reason = NULL, updated_at = ${nowSql} WHERE id = ?`,
    ).bind(target.id),
  );
  statements.push(
    c.env.DB.prepare(
      `UPDATE collection_slots SET current_card_id = ?, updated_at = ${nowSql} WHERE pokemon_id = ?`,
    ).bind(target.id, pokemonId),
  );
  await c.env.DB.batch(statements);
  return c.json(await getPokemonDetail(c.env.DB, pokemonId));
});

app.delete('/api/pokemon/:id/card', async (c) => {
  const pokemonId = positiveInteger(c.req.param('id'));
  if (!pokemonId) return c.json({ error: 'Invalid Pokémon ID.' }, 400);
  const detail = await getPokemonDetail(c.env.DB, pokemonId);
  if (!detail) return c.json({ error: 'Pokémon not found.' }, 404);
  if (!detail.currentCard) return c.json({ error: 'This slot is already missing.' }, 409);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE owned_cards SET is_current = 0, replaced_at = ${nowSql}, retired_reason = 'removed', updated_at = ${nowSql} WHERE id = ?`,
    ).bind(detail.currentCard.id),
    c.env.DB.prepare(
      `UPDATE collection_slots SET current_card_id = NULL, updated_at = ${nowSql} WHERE pokemon_id = ?`,
    ).bind(pokemonId),
  ]);
  return c.json(await getPokemonDetail(c.env.DB, pokemonId));
});

app.get('/api/images/*', async (c) => {
  const key = c.req.path.slice('/api/images/'.length);
  if (!key.startsWith('cards/')) return c.json({ error: 'Image not found.' }, 404);
  const object = await c.env.CARD_IMAGES.get(key);
  if (!object) return c.json({ error: 'Image not found.' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
});

app.onError((error, c) => {
  console.error('Unhandled request error', error);
  return c.json({ error: 'An unexpected error occurred.' }, 500);
});

function positiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function emptyToNull(value?: string): string | null {
  return value?.trim() ? value.trim() : null;
}

function chunk<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );
}

/** Builds a deduplicated snapshot write when catalog pricing is available. */
function priceHistoryStatement(
  db: D1Database,
  snapshot: {
    catalogCardId: string | null;
    printing: string;
    marketPriceCents: number | null;
    lowPriceCents: number | null;
    midPriceCents: number | null;
    highPriceCents: number | null;
    sourceUpdatedAt: string | null;
  },
): D1PreparedStatement | null {
  const hasPrice = [
    snapshot.marketPriceCents,
    snapshot.lowPriceCents,
    snapshot.midPriceCents,
    snapshot.highPriceCents,
  ].some((price) => price !== null);
  if (!snapshot.catalogCardId || !snapshot.sourceUpdatedAt || !hasPrice) return null;
  return db
    .prepare(
      `INSERT OR IGNORE INTO catalog_price_history (
      catalog_card_id, printing, market_price_cents, low_price_cents, mid_price_cents, high_price_cents,
      source_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      snapshot.catalogCardId,
      snapshot.printing,
      snapshot.marketPriceCents,
      snapshot.lowPriceCents,
      snapshot.midPriceCents,
      snapshot.highPriceCents,
      snapshot.sourceUpdatedAt,
    );
}

async function safeFormData(request: Request): Promise<FormData | null> {
  if (!request.headers.get('content-type')?.includes('multipart/form-data')) return null;
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function validationResponse(c: Context<{ Bindings: Env }>, fieldErrors: Record<string, string[] | undefined>) {
  return c.json({ error: 'Check the highlighted fields.', fieldErrors }, 422);
}

function imageErrorResponse(c: Context<{ Bindings: Env }>, error: unknown) {
  if (error instanceof ImageValidationError)
    return c.json({ error: error.message, fieldErrors: { image: [error.message] } }, 422);
  throw error;
}

export default app;
