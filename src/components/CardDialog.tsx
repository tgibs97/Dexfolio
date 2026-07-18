import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import type {
  CardInput,
  CardPriceHistoryResponse,
  CatalogCard,
  CatalogSet,
  OwnedCard,
  PokemonDetail,
  PriceHistoryPoint,
  PriceHistoryRange,
} from '../../shared/types';
import { api, ApiRequestError } from '../api';
import { findCardMatch, findSetByName, searchCatalogCards, searchCatalogSets } from '../catalog';

// One dialog hosts several related screens so card operations feel like a
// single workflow and the selected binder slot never changes.
type Mode = 'detail' | 'add' | 'edit' | 'replace';
const CARD_PRINTINGS = [
  'Normal',
  'Holofoil',
  'Reverse Holofoil',
  '1st Edition Normal',
  '1st Edition Holofoil',
  'Other',
];

/** Loads a complete slot, then coordinates details, forms, and card history. */
export function CardDialog({
  pokemonId,
  onClose,
  onChanged,
  notify,
  readOnly = false,
}: {
  pokemonId: number;
  onClose: () => void;
  onChanged: () => void;
  notify: (message: string, kind?: 'success' | 'error') => void;
  readOnly?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<PokemonDetail | null>(null);
  const [mode, setMode] = useState<Mode>('detail');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Native <dialog> supplies focus trapping, Escape handling, and a backdrop.
  // The detail endpoint also returns previous cards, unlike the binder summary.
  useEffect(() => {
    dialogRef.current?.showModal();
    api
      .detail(pokemonId)
      .then((value) => {
        setDetail(value);
        setMode(value.currentCard || readOnly ? 'detail' : 'add');
      })
      .catch(() => notify('Could not load this binder slot.', 'error'))
      .finally(() => setLoading(false));
  }, [pokemonId, notify, readOnly]);

  async function remove() {
    // Removal archives the current card instead of deleting it permanently.
    if (
      !detail?.currentCard ||
      !window.confirm(
        `Remove ${detail.currentCard.cardName} from ${detail.name}'s current slot? It will remain in history.`,
      )
    )
      return;
    setBusy(true);
    try {
      const updated = await api.removeCard(detail.id);
      setDetail(updated);
      setMode('add');
      onChanged();
      notify('Card removed. The slot is missing again.');
    } catch (error) {
      notify(messageFor(error, 'Could not remove the card.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function restore(card: OwnedCard) {
    // Restoring a historical card archives whichever card is current now.
    if (!detail || !window.confirm(`Restore ${card.cardName} as the current card for ${detail.name}?`)) return;
    setBusy(true);
    try {
      const updated = await api.restoreCard(detail.id, card.id);
      setDetail(updated);
      onChanged();
      notify('Previous card restored.');
    } catch (error) {
      notify(messageFor(error, 'Could not restore the card.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function saved(updated: PokemonDetail, action: string) {
    // Use the mutation response immediately, then refresh the binder behind it.
    setDetail(updated);
    setMode('detail');
    onChanged();
    notify(action);
  }

  return (
    <dialog
      ref={dialogRef}
      className="card-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="dialog-shell">
        <button className="dialog-close" onClick={() => dialogRef.current?.close()} aria-label="Close">
          ×
        </button>
        {loading && (
          <div className="dialog-loading">
            <span className="spinner" />
            <p>Opening binder pocket…</p>
          </div>
        )}
        {!loading && detail && (
          <>
            <header className="dialog-header">
              <div>
                <p className="eyebrow">
                  #{String(detail.nationalDexNumber).padStart(4, '0')} · Generation {detail.generation}
                </p>
                <h2>{detail.name}</h2>
              </div>
              {mode !== 'detail' && detail.currentCard && (
                <button className="text-button" onClick={() => setMode('detail')}>
                  Cancel
                </button>
              )}
            </header>
            {mode === 'detail' && detail.currentCard && (
              <CardDetails
                detail={detail}
                busy={busy}
                onEdit={() => setMode('edit')}
                onReplace={() => setMode('replace')}
                onRemove={remove}
                onRestore={restore}
                readOnly={readOnly}
              />
            )}
            {mode === 'detail' && !detail.currentCard && readOnly && <GuestMissingCard detail={detail} />}
            {!readOnly && (mode === 'add' || mode === 'replace' || mode === 'edit') && (
              <CardForm
                detail={detail}
                mode={mode}
                onSaved={(updated) =>
                  saved(
                    updated,
                    mode === 'edit'
                      ? 'Card details updated.'
                      : mode === 'replace'
                        ? 'Card replaced and the previous card moved to history.'
                        : 'Card added to your binder.',
                  )
                }
              />
            )}
          </>
        )}
      </div>
    </dialog>
  );
}

/** Read-only view of the current card and the restorable pocket archive. */
function CardDetails({
  detail,
  busy,
  onEdit,
  onReplace,
  onRemove,
  onRestore,
  readOnly,
}: {
  detail: PokemonDetail;
  busy: boolean;
  onEdit: () => void;
  onReplace: () => void;
  onRemove: () => void;
  onRestore: (card: OwnedCard) => void;
  readOnly: boolean;
}) {
  const card = detail.currentCard!;
  return (
    <div className="detail-content">
      <div className="card-photo-stage">
        <img
          src={card.imageUrl || detail.referenceImageUrl}
          alt={card.imageUrl ? `Photo of ${card.cardName}` : `${detail.name} official artwork`}
        />
      </div>
      <div className="card-information">
        <div className="current-label">
          <span /> Current binder card
        </div>
        <h3>{card.cardName}</h3>
        <p className="card-set">
          {card.setName}
          {card.setCode ? ` (${card.setCode})` : ''} · {card.cardNumber}
        </p>
        <dl>
          <Info label="Rarity" value={card.rarity} />
          <Info label="Printing" value={card.printing} />
          <Info label="Language" value={card.language} />
          <Info label="Condition" value={card.condition} />
          <Info label="Acquired" value={formatDate(card.acquisitionDate)} />
          <Info
            label="Purchase price"
            value={card.purchasePriceCents === null ? null : `$${(card.purchasePriceCents / 100).toFixed(2)}`}
          />
          <Info
            label="Market value"
            value={
              card.marketPriceCents !== null && card.tcgplayerUrl ? (
                <a className="market-link" href={card.tcgplayerUrl} target="_blank" rel="noreferrer">
                  {formatMoney(card.marketPriceCents)}
                </a>
              ) : (
                formatMoney(card.marketPriceCents)
              )
            }
          />
          <Info label="Low / Mid / High" value={formatPriceRange(card)} />
          <Info label="Price data updated" value={formatDate(card.priceUpdatedAt)} />
          <Info label="Added" value={formatDateTime(card.addedAt)} />
          <Info label="Last updated" value={formatDateTime(card.updatedAt)} />
        </dl>
        {card.notes && (
          <div className="notes">
            <strong>Notes</strong>
            <p>{card.notes}</p>
          </div>
        )}
        {readOnly ? (
          <p className="guest-read-only-note">Guest view · Card changes are disabled.</p>
        ) : (
          <div className="action-row">
            <button className="primary" onClick={onEdit} disabled={busy}>
              Edit card
            </button>
            <button className="secondary" onClick={onReplace} disabled={busy}>
              Replace card
            </button>
            <button className="danger-link" onClick={onRemove} disabled={busy}>
              Remove
            </button>
          </div>
        )}
      </div>
      <PriceHistoryPanel card={card} />
      <section className="history-section">
        <div>
          <p className="eyebrow">Pocket archive</p>
          <h3>Previous cards</h3>
        </div>
        {!detail.history.length ? (
          <p className="muted history-empty">Replaced and removed cards will appear here.</p>
        ) : (
          <div className="history-list">
            {detail.history.map((previous) => (
              <article key={previous.id}>
                <img src={previous.imageUrl || detail.referenceImageUrl} alt="" />
                <div>
                  <strong>{previous.cardName}</strong>
                  <span>
                    {previous.setName} · {previous.cardNumber}
                  </span>
                  <small>{historyLabel(previous)}</small>
                  {previous.marketPriceCents !== null && <small>Market {formatMoney(previous.marketPriceCents)}</small>}
                </div>
                {!readOnly && (
                  <button className="secondary small" disabled={busy} onClick={() => onRestore(previous)}>
                    Restore
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function GuestMissingCard({ detail }: { detail: PokemonDetail }) {
  return (
    <div className="detail-content guest-missing-card">
      <div className="card-photo-stage">
        <img src={detail.referenceImageUrl} alt={`${detail.name} official artwork`} />
      </div>
      <div className="card-information">
        <div className="current-label missing">
          <span /> Missing binder card
        </div>
        <h3>Not collected yet</h3>
        <p className="muted">There is not currently a card in {detail.name}'s binder slot.</p>
        <p className="guest-read-only-note">Guest view · Card changes are disabled.</p>
      </div>
    </div>
  );
}

/** Loads stored marketplace snapshots and visualizes one card's market movement. */
function PriceHistoryPanel({ card }: { card: OwnedCard }) {
  const [range, setRange] = useState<PriceHistoryRange>('90d');
  const [result, setResult] = useState<{
    key: string;
    history: CardPriceHistoryResponse | null;
    unavailable: boolean;
  } | null>(null);
  const requestKey = `${card.id}:${range}`;

  useEffect(() => {
    if (!card.catalogCardId) return;
    const controller = new AbortController();
    api
      .priceHistory(card.id, range, controller.signal)
      .then((history) => setResult({ key: requestKey, history, unavailable: false }))
      .catch((error) => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          setResult({ key: requestKey, history: null, unavailable: true });
        }
      });
    return () => controller.abort();
  }, [card.catalogCardId, card.id, range, requestKey]);

  const loading = Boolean(card.catalogCardId) && result?.key !== requestKey;
  const history = result?.key === requestKey ? result.history : null;
  const unavailable = result?.key === requestKey && result.unavailable;

  const localGain =
    card.marketPriceCents === null || card.purchasePriceCents === null
      ? null
      : card.marketPriceCents - card.purchasePriceCents;
  const gain = history?.unrealizedGainCents ?? localGain;
  const gainPercentage =
    history?.unrealizedGainPercentage ??
    (gain === null || !card.purchasePriceCents ? null : Math.round((gain / card.purchasePriceCents) * 10_000) / 100);
  const marketPointCount = history?.history.filter((point) => point.marketPriceCents !== null).length ?? 0;

  return (
    <section className="price-history-panel" aria-labelledby={`price-history-${card.id}`}>
      <div className="price-history-heading">
        <div>
          <p className="eyebrow">Market tracking</p>
          <h3 id={`price-history-${card.id}`}>Price history</h3>
        </div>
        <div className="range-switch" aria-label="Price history range">
          {(
            [
              ['30d', '30D'],
              ['90d', '90D'],
              ['1y', '1Y'],
              ['all', 'All'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={range === value ? 'active' : ''}
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="price-summary">
        <PriceMetric label="Current market" value={formatMoney(card.marketPriceCents)} />
        <PriceMetric label="Paid" value={formatMoney(card.purchasePriceCents)} />
        <PriceMetric
          label="Gain/Loss"
          value={gain === null ? null : `${formatSignedMoney(gain)}${formatSignedPercentage(gainPercentage)}`}
          trend={gain}
        />
        <PriceMetric label="7-day change" value={formatChange(history?.change7d)} trend={history?.change7d?.cents} />
        <PriceMetric label="30-day change" value={formatChange(history?.change30d)} trend={history?.change30d?.cents} />
      </div>

      {!card.catalogCardId ? (
        <p className="price-history-empty">Select a catalog card while editing to begin tracking its market history.</p>
      ) : loading ? (
        <div className="price-history-loading">
          <span className="spinner" /> Loading price history…
        </div>
      ) : unavailable ? (
        <p className="price-history-empty" role="alert">
          Price history could not be loaded right now.
        </p>
      ) : marketPointCount === 0 ? (
        <p className="price-history-empty">
          No market snapshot is available yet. Run a pricing refresh after linking this card to the catalog.
        </p>
      ) : marketPointCount < 2 ? (
        <p className="price-history-empty">
          One snapshot is saved. The chart and market changes will appear after another marketplace price update.
        </p>
      ) : (
        <MarketPriceChart history={history?.history ?? []} />
      )}
    </section>
  );
}

function PriceMetric({ label, value, trend }: { label: string; value: string | null; trend?: number | null }) {
  return (
    <div>
      <span>{label}</span>
      <strong className={trend === undefined || trend === null ? '' : trendClass(trend)}>{value || '—'}</strong>
    </div>
  );
}

/** Dependency-free SVG chart keeps the dialog bundle small and scales cleanly. */
function MarketPriceChart({ history }: { history: PriceHistoryPoint[] }) {
  const values = history
    .filter((point): point is PriceHistoryPoint & { marketPriceCents: number } => point.marketPriceCents !== null)
    .map((point) => ({ ...point, timestamp: pricePointTimestamp(point) }));
  if (values.length < 2) return null;

  const width = 760;
  const height = 230;
  const padding = { top: 18, right: 22, bottom: 34, left: 62 };
  const markets = values.map((point) => point.marketPriceCents);
  const rawMin = Math.min(...markets);
  const rawMax = Math.max(...markets);
  const margin = rawMin === rawMax ? Math.max(50, rawMin * 0.05) : (rawMax - rawMin) * 0.12;
  const min = Math.max(0, rawMin - margin);
  const max = rawMax + margin;
  const firstTime = values[0].timestamp;
  const lastTime = values[values.length - 1].timestamp;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (timestamp: number, index: number) =>
    padding.left +
    (lastTime === firstTime
      ? index / Math.max(values.length - 1, 1)
      : (timestamp - firstTime) / (lastTime - firstTime)) *
      plotWidth;
  const y = (market: number) => padding.top + ((max - market) / Math.max(max - min, 1)) * plotHeight;
  const coordinates = values.map((point, index) => `${x(point.timestamp, index)},${y(point.marketPriceCents)}`);

  return (
    <div className="price-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Market price history chart">
        {[0, 0.5, 1].map((ratio) => {
          const gridY = padding.top + plotHeight * ratio;
          const value = max - (max - min) * ratio;
          return (
            <g key={ratio}>
              <line className="price-chart-grid" x1={padding.left} x2={width - padding.right} y1={gridY} y2={gridY} />
              <text className="price-chart-label" x={padding.left - 9} y={gridY + 4} textAnchor="end">
                {formatMoney(Math.round(value))}
              </text>
            </g>
          );
        })}
        <polyline className="price-chart-line" points={coordinates.join(' ')} />
        {values.map((point, index) => (
          <circle
            key={`${point.sourceUpdatedAt}-${index}`}
            className="price-chart-point"
            cx={x(point.timestamp, index)}
            cy={y(point.marketPriceCents)}
            r="4"
          >
            <title>
              {formatDate(point.sourceUpdatedAt)}: {formatMoney(point.marketPriceCents)}
            </title>
          </circle>
        ))}
        <text className="price-chart-label" x={padding.left} y={height - 8} textAnchor="start">
          {formatDate(values[0].sourceUpdatedAt)}
        </text>
        <text className="price-chart-label" x={width - padding.right} y={height - 8} textAnchor="end">
          {formatDate(values[values.length - 1].sourceUpdatedAt)}
        </text>
      </svg>
    </div>
  );
}

/** Shared form for adding, editing, and replacing to keep validation consistent. */
export function CardForm({
  detail,
  mode,
  onSaved,
}: {
  detail: PokemonDetail;
  mode: Exclude<Mode, 'detail'>;
  onSaved: (detail: PokemonDetail) => void;
}) {
  const editing = mode === 'edit' ? detail.currentCard : null;
  const [input, setInput] = useState<CardInput>(() => cardToInput(editing));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(editing?.imageUrl ?? null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [catalogSets, setCatalogSets] = useState<CatalogSet[]>([]);
  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [setsLoading, setSetsLoading] = useState(true);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const inputRef = useRef(input);

  // The async catalog callbacks need the latest form values without refetching.
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  const setLookupQuery =
    input.language === 'Japanese' && /[^\p{ASCII}]/u.test(input.setName) && input.setCode
      ? input.setCode
      : input.language === 'Japanese'
        ? input.setName
        : '';

  // Set metadata is shared across species and cached by the Worker.
  useEffect(() => {
    // A selected set already has the metadata needed to load cards. Avoid a
    // delayed follow-up search that can re-arm the loading state for the same ID.
    if (selectedSetId) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => {
        if (input.language === 'Japanese' && setLookupQuery.trim().length < 2) {
          setCatalogSets([]);
          setSetsLoading(false);
          return;
        }
        setSetsLoading(true);
        api
          .catalogSets(input.language, setLookupQuery, controller.signal)
          .then(({ sets }) => {
            setCatalogSets(sets);
            setCatalogUnavailable(false);
            const nameMatch = findSetByName(sets, inputRef.current.setName);
            const match = nameMatch || findSetByName(sets, inputRef.current.setCode || '');
            if (match) {
              setSelectedSetId(match.id);
              setCardsLoading(true);
              setInput((current) => ({
                ...current,
                setName: nameMatch ? current.setName : match.name,
                setCode: match.code,
              }));
            }
          })
          .catch((reason) => {
            if (!(reason instanceof DOMException && reason.name === 'AbortError')) setCatalogUnavailable(true);
          })
          .finally(() => {
            if (!controller.signal.aborted) setSetsLoading(false);
          });
      },
      input.language === 'Japanese' && setLookupQuery.trim().length >= 2 ? 350 : 0,
    );
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [input.language, selectedSetId, setLookupQuery]);

  // Once a set is selected, ask for cards featuring this binder slot's species.
  useEffect(() => {
    if (!selectedSetId) return;
    const controller = new AbortController();
    api
      .catalogCards(selectedSetId, detail.nationalDexNumber, detail.name, input.language, controller.signal)
      .then(({ cards }) => {
        setCatalogCards(cards);
        setCatalogUnavailable(false);
        setInput((current) => {
          const match = findCardMatch(cards, current.cardName, current.cardNumber);
          if (!match) return current;
          const printing = catalogPrinting(match, current.printing);
          if (current.rarity && printing === current.printing) return current;
          return {
            ...current,
            cardName: match.name,
            cardNumber: match.number,
            rarity: match.rarity || current.rarity,
            printing,
          };
        });
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setCatalogUnavailable(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCardsLoading(false);
      });
    return () => controller.abort();
  }, [selectedSetId, detail.nationalDexNumber, detail.name, catalogRetry, mode, input.language]);

  // Object URLs hold browser memory, so release each generated preview on cleanup.
  useEffect(
    () => () => {
      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const update = (key: keyof CardInput, value: string) => setInput((current) => ({ ...current, [key]: value }));

  function changeLanguage(_key: keyof CardInput, value: string) {
    setSetsLoading(true);
    setCatalogUnavailable(false);
    setCatalogSets([]);
    setCatalogCards([]);
    setSelectedSetId(null);
    setCardsLoading(false);
    setInput((current) => ({ ...clearCatalogSnapshot(current), language: value }));
  }

  function changeSetName(_key: keyof CardInput, value: string) {
    const match = findSetByName(catalogSets, value);
    const setChanged = match?.id !== selectedSetId;
    if (setChanged) {
      setCatalogCards([]);
      setCardsLoading(Boolean(match));
    }
    setInput((current) => ({
      ...(setChanged ? clearCatalogSnapshot(current) : current),
      setName: value,
      setCode: match ? match.code : selectedSetId ? '' : current.setCode,
    }));
    setSelectedSetId(match?.id ?? null);
  }

  function selectSet(set: CatalogSet) {
    setInput((current) => ({
      ...(set.id === selectedSetId ? current : clearCatalogSnapshot(current)),
      setName: set.name,
      setCode: set.code,
    }));
    // Typing a complete set code can select and load the set before the user
    // clicks its suggestion. Keep those results when the ID is unchanged.
    if (set.id === selectedSetId) return;
    setCatalogCards([]);
    setCardsLoading(true);
    setSelectedSetId(set.id);
  }

  function changeCardName(_key: keyof CardInput, value: string) {
    const match = findCardMatch(catalogCards, value, input.cardNumber);
    setInput((current) => ({
      ...(match ? current : clearCatalogSnapshot(current)),
      cardName: value,
      ...(match
        ? {
            cardNumber: match.number,
            rarity: match.rarity || current.rarity,
            printing: catalogPrinting(match, current.printing),
          }
        : {}),
    }));
  }

  function changeCardNumber(_key: keyof CardInput, value: string) {
    const match = findCardMatch(catalogCards, input.cardName, value);
    setInput((current) => ({
      ...(match ? current : clearCatalogSnapshot(current)),
      cardNumber: value,
      ...(match
        ? {
            cardName: match.name,
            rarity: match.rarity || current.rarity,
            printing: catalogPrinting(match, current.printing),
          }
        : {}),
    }));
  }

  function selectCard(card: CatalogCard) {
    setInput((current) => ({
      ...clearCatalogSnapshot(current),
      cardName: card.name,
      cardNumber: card.number,
      rarity: card.rarity || current.rarity,
      printing: catalogPrinting(card, current.printing),
      catalogCardId: card.id,
    }));
  }

  async function selectFile(selected: File | null) {
    // Optimize large camera photos before previewing and eventually uploading them.
    setError('');
    if (!selected) {
      setFile(null);
      setPreview(editing?.imageUrl ?? null);
      return;
    }
    try {
      const optimized = await optimizeImage(selected);
      if (optimized.size > 8 * 1024 * 1024) throw new Error('Image must be 8 MB or smaller.');
      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
      setFile(optimized);
      setPreview(URL.createObjectURL(optimized));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read the image.');
    }
  }

  async function submit(event: FormEvent) {
    // The mode selects the endpoint, while all modes share the same CardInput shape.
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setErrors({});
    try {
      const catalogInput = matchedCatalogCard ? withCatalogSnapshot(input, matchedCatalogCard) : input;
      const updated =
        mode === 'edit' && editing
          ? await api.editCard(editing.id, catalogInput, file)
          : await api.saveCard(detail.id, catalogInput, file, mode === 'replace' ? 'replace' : 'add');
      onSaved(updated);
    } catch (reason) {
      if (reason instanceof ApiRequestError) {
        setError(reason.message);
        setErrors(reason.fieldErrors ?? {});
      } else setError('The card could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  const matchedCatalogCard =
    catalogCards.find((card) => card.id === input.catalogCardId) ||
    findCardMatch(catalogCards, input.cardName, input.cardNumber);
  const catalogPrintingOptions = matchedCatalogCard?.availablePrintings ?? [];
  const printingOptions = catalogPrintingOptions.length
    ? [
        ...catalogPrintingOptions,
        ...(input.printing && !catalogPrintingOptions.includes(input.printing) ? [input.printing] : []),
      ]
    : CARD_PRINTINGS;

  return (
    <form className="card-form" onSubmit={submit} noValidate>
      <div className="form-intro">
        <div className="form-pokemon">
          <img src={detail.referenceImageUrl} alt="" />
          <div>
            <span>Binder slot</span>
            <strong>
              #{String(detail.nationalDexNumber).padStart(4, '0')} {detail.name}
            </strong>
          </div>
        </div>
        <div>
          <p className="eyebrow">
            {mode === 'edit' ? 'Update details' : mode === 'replace' ? 'Upgrade this pocket' : 'Fill this pocket'}
          </p>
          <h3>{mode === 'edit' ? 'Edit card' : mode === 'replace' ? 'Replace card' : 'Add your card'}</h3>
        </div>
      </div>
      {mode === 'replace' && <p className="notice">The current card will be safely moved into the pocket archive.</p>}
      <div className="form-grid">
        <AutocompleteField
          label="Set name"
          name="setName"
          required
          value={input.setName}
          errors={errors}
          onChange={changeSetName}
          suggestions={searchCatalogSets(catalogSets, input.setName).map((set) => ({
            id: set.id,
            value: set.name,
            description: `${set.code}${set.releaseDate ? ` · ${set.releaseDate}` : ''}`,
            source: set,
          }))}
          onSelect={(suggestion) => selectSet(suggestion.source as CatalogSet)}
          emptyMessage={
            input.setName.trim() && !setsLoading
              ? 'No catalog set matches. Try another name or enter it manually.'
              : undefined
          }
          hint={setsLoading ? 'Loading set suggestions…' : 'Choose a suggestion to fill the set code.'}
        />
        <Field label="Set code" name="setCode" value={input.setCode || ''} errors={errors} onChange={update} />
        <AutocompleteField
          label="Card name"
          name="cardName"
          required
          value={input.cardName}
          errors={errors}
          onChange={changeCardName}
          suggestions={searchCatalogCards(catalogCards, input.cardName, 'name').map((card) => ({
            id: card.id,
            value: card.name,
            description: `#${card.number}${card.rarity ? ` · ${card.rarity}` : ''}${catalogVariantLabel(card)}`,
            source: card,
          }))}
          onSelect={(suggestion) => selectCard(suggestion.source as CatalogCard)}
          emptyMessage={
            selectedSetId && input.cardName.trim() && !cardsLoading
              ? 'No matching card was found in this set for this Pokémon.'
              : undefined
          }
          hint={
            cardsLoading
              ? 'Finding cards for this Pokémon…'
              : selectedSetId
                ? `${catalogCards.length} matching card${catalogCards.length === 1 ? '' : 's'} found.`
                : 'Select a set for card suggestions.'
          }
        />
        <AutocompleteField
          label="Card number"
          name="cardNumber"
          required
          value={input.cardNumber}
          errors={errors}
          onChange={changeCardNumber}
          suggestions={searchCatalogCards(catalogCards, input.cardNumber, 'number').map((card) => ({
            id: card.id,
            value: card.number,
            description: `${card.name}${card.rarity ? ` · ${card.rarity}` : ''}${catalogVariantLabel(card)}`,
            source: card,
          }))}
          onSelect={(suggestion) => selectCard(suggestion.source as CatalogCard)}
          emptyMessage={
            selectedSetId && input.cardNumber.trim() && !cardsLoading
              ? 'No matching card number was found in this set for this Pokémon.'
              : undefined
          }
        />
        <Field label="Rarity" name="rarity" value={input.rarity || ''} errors={errors} onChange={update} />
        <SelectField
          label="Printing"
          name="printing"
          value={input.printing}
          options={printingOptions}
          placeholder={input.printing ? undefined : 'Select a printing'}
          onChange={update}
          errors={errors}
        />
        <SelectField
          label="Language"
          name="language"
          value={input.language}
          options={[
            'English',
            'Japanese',
            'Spanish',
            'French',
            'German',
            'Italian',
            'Portuguese',
            'Portuguese (Brazil)',
            'Portuguese (Portugal)',
            'Dutch',
            'Polish',
            'Russian',
            'Korean',
            'Chinese',
            'Chinese (Traditional)',
            'Chinese (Simplified)',
            'Indonesian',
            'Thai',
            'Other',
          ]}
          onChange={changeLanguage}
          errors={errors}
        />
        <SelectField
          label="Condition"
          name="condition"
          value={input.condition}
          options={['Mint', 'Near mint', 'Lightly played', 'Moderately played', 'Heavily played', 'Damaged']}
          onChange={update}
          errors={errors}
        />
        <Field
          label="Acquisition date"
          name="acquisitionDate"
          type="date"
          value={input.acquisitionDate || ''}
          errors={errors}
          onChange={update}
        />
        <Field
          label="Purchase price"
          name="purchasePrice"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={input.purchasePrice || ''}
          errors={errors}
          onChange={update}
          prefix="$"
        />
        <label className="wide">
          <span>Notes</span>
          <textarea
            rows={4}
            maxLength={4000}
            value={input.notes || ''}
            onChange={(event) => update('notes', event.target.value)}
          />
          {fieldError(errors, 'notes')}
        </label>
        <label className="image-upload wide">
          <span>
            Card photo <small>JPEG, PNG, WebP or GIF · max 8 MB</small>
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            capture="environment"
            onChange={(event) => void selectFile(event.target.files?.[0] ?? null)}
          />
          <div className="upload-zone">
            {preview ? (
              <img src={preview} alt="Selected card preview" />
            ) : (
              <div className="upload-placeholder">
                <strong>Choose or take a photo</strong>
                <span>Large photos are optimized before upload.</span>
              </div>
            )}
          </div>
          {fieldError(errors, 'image')}
        </label>
      </div>
      {catalogUnavailable && (
        <p className="catalog-note">
          Catalog suggestions are unavailable right now. You can still enter every field manually.
          {selectedSetId && (
            <button
              type="button"
              className="catalog-retry"
              disabled={cardsLoading}
              onClick={() => {
                setCardsLoading(true);
                setCatalogUnavailable(false);
                setCatalogRetry((current) => current + 1);
              }}
            >
              Try again
            </button>
          )}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="primary" disabled={submitting}>
          {submitting
            ? 'Saving…'
            : mode === 'replace'
              ? 'Replace card'
              : mode === 'edit'
                ? 'Save changes'
                : 'Add to binder'}
        </button>
      </div>
    </form>
  );
}

/** Reusable text/number/date field with accessible server-validation feedback. */
function Field({
  label,
  name,
  value,
  onChange,
  errors,
  prefix,
  hint,
  ...inputProps
}: {
  label: string;
  name: keyof CardInput;
  value: string;
  onChange: (name: keyof CardInput, value: string) => void;
  errors: Record<string, string[]>;
  prefix?: string;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'name' | 'value' | 'onChange'>) {
  return (
    <label>
      <span>
        {label}
        {inputProps.required && ' *'}
      </span>
      <div className={prefix ? 'input-prefix' : ''}>
        {prefix && <i>{prefix}</i>}
        <input
          name={name}
          value={value}
          onChange={(event) => onChange(name, event.target.value)}
          aria-invalid={Boolean(errors[name])}
          {...inputProps}
        />
      </div>
      {hint && <small className="field-hint">{hint}</small>}
      {fieldError(errors, name)}
    </label>
  );
}

type AutocompleteSuggestion = {
  id: string;
  value: string;
  description?: string;
  source: CatalogSet | CatalogCard;
};

/**
 * A consistent autocomplete menu that does not depend on each browser's
 * optional datalist UI. Focus stays in the input while arrow keys move through
 * the list, so selecting an item can populate the related form fields.
 */
function AutocompleteField({
  label,
  name,
  value,
  onChange,
  onSelect,
  suggestions,
  errors,
  hint,
  emptyMessage,
  required,
}: {
  label: string;
  name: keyof CardInput;
  value: string;
  onChange: (name: keyof CardInput, value: string) => void;
  onSelect: (suggestion: AutocompleteSuggestion) => void;
  suggestions: AutocompleteSuggestion[];
  errors: Record<string, string[]>;
  hint?: string;
  emptyMessage?: string;
  required?: boolean;
}) {
  const inputId = useId();
  const listId = `${inputId}-suggestions`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const showMenu = open && (suggestions.length > 0 || Boolean(emptyMessage));

  function choose(suggestion: AutocompleteSuggestion) {
    onSelect(suggestion);
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div className="autocomplete-field">
      <label htmlFor={inputId}>
        <span>
          {label}
          {required && ' *'}
        </span>
      </label>
      <div className="autocomplete-control">
        <input
          id={inputId}
          name={name}
          value={value}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showMenu}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-invalid={Boolean(errors[name])}
          onFocus={() => {
            setOpen(true);
            setActiveIndex(-1);
          }}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            onChange(name, event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && suggestions.length) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => (current >= suggestions.length - 1 ? 0 : current + 1));
            } else if (event.key === 'ArrowUp' && suggestions.length) {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
            } else if (event.key === 'Enter' && showMenu && activeIndex >= 0 && suggestions[activeIndex]) {
              event.preventDefault();
              choose(suggestions[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
        />
        {showMenu && (
          <div id={listId} className="autocomplete-menu" role="listbox" aria-label={`${label} suggestions`}>
            {suggestions.map((suggestion, index) => (
              <div
                id={`${listId}-${index}`}
                key={suggestion.id}
                className={`autocomplete-option${activeIndex === index ? ' active' : ''}`}
                role="option"
                aria-selected={activeIndex === index}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(suggestion)}
              >
                <strong>{suggestion.value}</strong>
                {suggestion.description && <small>{suggestion.description}</small>}
              </div>
            ))}
            {!suggestions.length && emptyMessage && <p className="autocomplete-empty">{emptyMessage}</p>}
          </div>
        )}
      </div>
      {hint && <small className="field-hint">{hint}</small>}
      {fieldError(errors, name)}
    </div>
  );
}

/** Reusable select field matching the behavior and error display of Field. */
function SelectField({
  label,
  name,
  value,
  options,
  placeholder,
  onChange,
  errors,
}: {
  label: string;
  name: keyof CardInput;
  value: string;
  options: string[];
  placeholder?: string;
  onChange: (name: keyof CardInput, value: string) => void;
  errors: Record<string, string[]>;
}) {
  return (
    <label>
      <span>{label} *</span>
      <select
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
        aria-invalid={Boolean(errors[name])}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      {fieldError(errors, name)}
    </label>
  );
}
function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  );
}
// Small presentation helpers keep the main JSX focused on the workflow.
function fieldError(errors: Record<string, string[]>, name: string) {
  return errors[name]?.[0] ? <small className="field-error">{errors[name][0]}</small> : null;
}
/** Preserve a valid choice, autofill a single choice, or require a choice when ambiguous. */
function catalogPrinting(card: CatalogCard, currentPrinting: string): string {
  if (card.suggestedPrinting) return card.suggestedPrinting;
  const availablePrintings = card.availablePrintings ?? [];
  if (!availablePrintings.length || availablePrintings.includes(currentPrinting)) return currentPrinting;
  return '';
}

/** Distinguish catalog records that share a set, name, and card number. */
function catalogVariantLabel(card: CatalogCard): string {
  const printings = card.availablePrintings ?? [];
  return printings.length === 1 ? ` · ${printings[0]}` : '';
}

/** Attach the selected printing's latest marketplace snapshot to the owned card. */
function withCatalogSnapshot(input: CardInput, card: CatalogCard): CardInput {
  const price = (card.prices ?? []).find((candidate) => candidate.printing === input.printing);
  return {
    ...clearCatalogSnapshot(input),
    catalogCardId: card.id,
    marketPriceCents: centsValue(price?.marketCents),
    lowPriceCents: centsValue(price?.lowCents),
    midPriceCents: centsValue(price?.midCents),
    highPriceCents: centsValue(price?.highCents),
    priceUpdatedAt: card.pricesUpdatedAt || '',
    tcgplayerUrl: card.tcgplayerUrl || '',
  };
}

function clearCatalogSnapshot(input: CardInput): CardInput {
  return {
    ...input,
    catalogCardId: '',
    marketPriceCents: '',
    lowPriceCents: '',
    midPriceCents: '',
    highPriceCents: '',
    priceUpdatedAt: '',
    tcgplayerUrl: '',
  };
}

function centsValue(value?: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}
function messageFor(error: unknown, fallback: string) {
  return error instanceof ApiRequestError ? error.message : fallback;
}
function formatDate(value: string | null) {
  if (!value) return null;
  const normalized = value.replaceAll('/', '-');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? new Date(`${normalized}T12:00:00`) : new Date(normalized);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
    : null;
}

function formatMoney(value: number | null): string | null {
  return value === null ? null : `$${(value / 100).toFixed(2)}`;
}

function formatSignedMoney(value: number): string {
  if (value === 0) return '$0.00';
  return `${value > 0 ? '+' : '-'}$${(Math.abs(value) / 100).toFixed(2)}`;
}

function formatSignedPercentage(value: number | null): string {
  if (value === null) return '';
  return ` (${value > 0 ? '+' : ''}${value.toFixed(2)}%)`;
}

function formatChange(change: CardPriceHistoryResponse['change7d'] | undefined): string | null {
  return change ? `${formatSignedMoney(change.cents)}${formatSignedPercentage(change.percentage)}` : null;
}

function trendClass(value: number): string {
  return value > 0 ? 'trend-positive' : value < 0 ? 'trend-negative' : 'trend-neutral';
}

function pricePointTimestamp(point: PriceHistoryPoint): number {
  const source = Date.parse(point.sourceUpdatedAt.replaceAll('/', '-'));
  return Number.isFinite(source) ? source : Date.parse(point.capturedAt);
}

function formatPriceRange(card: OwnedCard): string | null {
  const prices = [card.lowPriceCents, card.midPriceCents, card.highPriceCents].map(formatMoney);
  return prices.some(Boolean) ? prices.map((price) => price || '—').join(' / ') : null;
}
function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : null;
}
function historyLabel(card: OwnedCard) {
  const action =
    card.retiredReason === 'removed'
      ? 'Removed'
      : card.retiredReason === 'restored'
        ? 'Archived on restore'
        : 'Replaced';
  return `${action} ${formatDateTime(card.replacedAt || card.updatedAt)}`;
}
function cardToInput(card: OwnedCard | null): CardInput {
  return card
    ? {
        cardName: card.cardName,
        setName: card.setName,
        setCode: card.setCode || '',
        cardNumber: card.cardNumber,
        rarity: card.rarity || '',
        printing: card.printing,
        language: card.language,
        condition: card.condition,
        acquisitionDate: card.acquisitionDate || '',
        purchasePrice: card.purchasePriceCents === null ? '' : (card.purchasePriceCents / 100).toFixed(2),
        catalogCardId: card.catalogCardId || '',
        marketPriceCents: centsValue(card.marketPriceCents),
        lowPriceCents: centsValue(card.lowPriceCents),
        midPriceCents: centsValue(card.midPriceCents),
        highPriceCents: centsValue(card.highPriceCents),
        priceUpdatedAt: card.priceUpdatedAt || '',
        tcgplayerUrl: card.tcgplayerUrl || '',
        notes: card.notes || '',
      }
    : {
        cardName: '',
        setName: '',
        setCode: '',
        cardNumber: '',
        rarity: '',
        printing: 'Normal',
        language: 'English',
        condition: 'Near mint',
        acquisitionDate: localDateInputValue(),
        purchasePrice: '',
        catalogCardId: '',
        marketPriceCents: '',
        lowPriceCents: '',
        midPriceCents: '',
        highPriceCents: '',
        priceUpdatedAt: '',
        tcgplayerUrl: '',
        notes: '',
      };
}

/** Format the browser's local date without shifting it through UTC. */
function localDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Downscale large still images in the browser. GIFs are preserved to avoid
 * destroying animation, and compression is skipped if it makes a larger file.
 */
async function optimizeImage(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type))
    throw new Error('Use a JPEG, PNG, WebP, or GIF image.');
  if (file.type === 'image/gif' || file.size <= 3 * 1024 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}
