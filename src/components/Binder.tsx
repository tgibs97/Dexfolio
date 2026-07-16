import { useEffect, useState } from 'react';
import type { PokemonSlot } from '../../shared/types';

/**
 * Presentation-only collection view. Selection is passed to the parent so the
 * same data can be rendered as either visual pockets or a compact table.
 */
export function Binder({
  pokemon,
  view,
  onSelect,
  readOnly = false,
}: {
  pokemon: PokemonSlot[];
  view: 'grid' | 'list';
  onSelect: (pokemon: PokemonSlot) => void;
  readOnly?: boolean;
}) {
  // Do not leave the user staring at an unexplained blank region after filtering.
  if (!pokemon.length)
    return (
      <div className="empty-state">
        <div className="empty-orb" />
        <h2>No Pokémon found</h2>
        <p>Try changing the search or filters.</p>
      </div>
    );
  if (view === 'list')
    return (
      <>
        <PokedexQuickNav pokemon={pokemon} />
        <div className="list-wrap">
          <table className="binder-list">
            <thead>
              <tr>
                <th>#</th>
                <th>Pokémon</th>
                <th>Generation</th>
                <th>Status</th>
                <th>Current card</th>
                <th>Market value</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pokemon.map((slot) => (
                <tr id={slotTargetId(slot)} key={slot.id} className={slot.status}>
                  <td className="dex-number">#{String(slot.nationalDexNumber).padStart(4, '0')}</td>
                  <td>
                    <button className="pokemon-cell" onClick={() => onSelect(slot)}>
                      <img src={slot.referenceImageUrl} alt="" loading="lazy" />
                      <strong>{slot.name}</strong>
                    </button>
                  </td>
                  <td>Gen {slot.generation}</td>
                  <td>
                    <Status status={slot.status} />
                  </td>
                  <td>{formatMoney(slot.currentCard?.marketPriceCents ?? null) || <span className="muted">—</span>}</td>
                  <td>
                    {slot.currentCard ? (
                      <>
                        <strong>{slot.currentCard.cardName}</strong>
                        <small>
                          {slot.currentCard.setName} · {slot.currentCard.cardNumber}
                        </small>
                      </>
                    ) : (
                      <span className="muted">{readOnly ? 'Not collected' : 'No card assigned'}</span>
                    )}
                  </td>
                  <td>
                    <button className="icon-button" aria-label={`Open ${slot.name}`} onClick={() => onSelect(slot)}>
                      →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  // Collected slots prefer the uploaded card photo; missing slots use reference art.
  return (
    <>
      <PokedexQuickNav pokemon={pokemon} />
      <div className="binder-grid">
        {pokemon.map((slot) => {
          const image = slot.currentCard?.imageUrl || slot.referenceImageUrl;
          return (
            <button
              id={slotTargetId(slot)}
              className={`slot-card ${slot.status}`}
              key={slot.id}
              onClick={() => onSelect(slot)}
              aria-label={`${slot.name}, ${slot.status}`}
            >
              <div className="slot-image">
                <img
                  src={image}
                  alt={
                    slot.currentCard?.imageUrl ? `${slot.currentCard.cardName} card` : `${slot.name} official artwork`
                  }
                  loading="lazy"
                />
                <span className="generation-chip">Gen {slot.generation}</span>
                {slot.status === 'missing' && !readOnly && (
                  <span className="add-hint" aria-hidden="true">
                    +
                  </span>
                )}
              </div>
              <div className="slot-meta">
                <span className="dex-number">#{String(slot.nationalDexNumber).padStart(4, '0')}</span>
                <Status status={slot.status} />
              </div>
              <h3>{slot.name}</h3>
              <p>
                {slot.currentCard
                  ? `${slot.currentCard.setName} · ${slot.currentCard.cardNumber}`
                  : readOnly
                    ? 'Not collected'
                    : 'Add your card'}
              </p>
              {slot.currentCard?.marketPriceCents !== null && slot.currentCard?.marketPriceCents !== undefined && (
                <strong className="market-price">Market {formatMoney(slot.currentCard.marketPriceCents)}</strong>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** A compact numeric index modeled after the A–Z rail in mobile contact lists. */
function PokedexQuickNav({ pokemon }: { pokemon: PokemonSlot[] }) {
  const mobile = useMediaQuery('(max-width: 720px)');
  const [mobileOpen, setMobileOpen] = useState(false);
  const targets = quickNavTargets(pokemon, mobile ? 100 : 50);
  if (targets.length < 2) return null;

  function jumpTo(slot: PokemonSlot) {
    const target = document.getElementById(slotTargetId(slot));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setMobileOpen(false);
    target?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }

  return (
    <>
      <button
        className="pokedex-quick-nav-toggle"
        type="button"
        aria-controls="pokedex-quick-nav"
        aria-expanded={mobileOpen}
        aria-label={mobileOpen ? 'Close Pokédex quick navigation' : 'Open Pokédex quick navigation'}
        onClick={() => setMobileOpen((open) => !open)}
      >
        {mobileOpen ? '×' : '#'}
      </button>
      <nav
        id="pokedex-quick-nav"
        className={`pokedex-quick-nav${mobileOpen ? ' mobile-open' : ''}`}
        aria-label="Pokédex quick navigation"
      >
        {targets.map(({ label, slot }) => (
          <button key={label} type="button" onClick={() => jumpTo(slot)} aria-label={`Jump to Pokédex #${label}`}>
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}

function quickNavTargets(pokemon: PokemonSlot[], bandSize: 50 | 100): Array<{ label: number; slot: PokemonSlot }> {
  const targets = new Map<number, PokemonSlot>();
  for (const slot of [...pokemon].sort((left, right) => left.nationalDexNumber - right.nationalDexNumber)) {
    const label = slot.nationalDexNumber < bandSize ? 1 : Math.floor(slot.nationalDexNumber / bandSize) * bandSize;
    if (!targets.has(label)) targets.set(label, slot);
  }
  return [...targets].map(([label, slot]) => ({ label, slot }));
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function slotTargetId(slot: PokemonSlot): string {
  return `pokedex-${slot.nationalDexNumber}`;
}

function formatMoney(value: number | null): string | null {
  return value === null ? null : `$${(value / 100).toFixed(2)}`;
}
function Status({ status }: { status: PokemonSlot['status'] }) {
  return (
    <span className={`status ${status}`}>
      <i />
      {status === 'collected' ? 'Collected' : 'Missing'}
    </span>
  );
}
