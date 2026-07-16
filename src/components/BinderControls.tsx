import { useState } from 'react';
import type { SortOption } from '../../shared/types';

export interface Filters {
  q: string;
  status: string;
  generation: string;
  sort: SortOption;
}

/** Controlled search, filter, sort, and layout controls for the binder. */
export function BinderControls({
  filters,
  onChange,
  view,
  onViewChange,
  resultCount,
  generations,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  view: 'grid' | 'list';
  onViewChange: (view: 'grid' | 'list') => void;
  resultCount: number;
  generations: number[];
}) {
  const [mobileOpen, setMobileOpen] = useState(readMobileFilterPreference);
  const activeFilterCount = [
    Boolean(filters.q.trim()),
    filters.status !== 'all',
    filters.generation !== 'all',
    filters.sort !== 'number-asc',
  ].filter(Boolean).length;
  // Update one property while preserving the rest of the filter object.
  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  function toggleMobileFilters() {
    setMobileOpen((open) => {
      const next = !open;
      try {
        sessionStorage.setItem('binder-filters-open', String(next));
      } catch {
        /* The control still works when browser storage is unavailable. */
      }
      return next;
    });
  }
  return (
    <section className={`binder-tools${mobileOpen ? ' mobile-open' : ''}`} aria-label="Binder search and filters">
      <button className="mobile-filter-toggle" type="button" aria-expanded={mobileOpen} onClick={toggleMobileFilters}>
        <span>
          <strong>Search &amp; filters</strong>
          <small>
            {resultCount.toLocaleString()} {resultCount === 1 ? 'slot' : 'slots'}
            {activeFilterCount ? ` · ${activeFilterCount} active` : ''}
          </small>
        </span>
        <i aria-hidden="true" />
      </button>
      <div className="search-field">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="m21 21-4.4-4.4m2.4-5.1a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
        </svg>
        <label className="sr-only" htmlFor="search">
          Search by Pokémon name or Pokédex number
        </label>
        <input
          id="search"
          type="search"
          placeholder="Search name or #…"
          value={filters.q}
          onChange={(event) => update('q', event.target.value)}
        />
      </div>
      <label>
        <span>Status</span>
        <select value={filters.status} onChange={(event) => update('status', event.target.value)}>
          <option value="all">All slots</option>
          <option value="collected">Collected</option>
          <option value="missing">Missing</option>
        </select>
      </label>
      <label>
        <span>Generation</span>
        <select value={filters.generation} onChange={(event) => update('generation', event.target.value)}>
          <option value="all">All generations</option>
          {generations.map((generation) => (
            <option key={generation} value={generation}>
              Generation {generation}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Sort by</span>
        <select value={filters.sort} onChange={(event) => update('sort', event.target.value as SortOption)}>
          <option value="number-asc">Pokédex: low to high</option>
          <option value="number-desc">Pokédex: high to low</option>
          <option value="name-asc">Name: A–Z</option>
          <option value="name-desc">Name: Z–A</option>
          <option value="added-desc">Recently added</option>
          <option value="added-asc">First added</option>
          <option value="paid-desc">Paid price: high to low</option>
          <option value="paid-asc">Paid price: low to high</option>
          <option value="value-desc">Card value: high to low</option>
          <option value="value-asc">Card value: low to high</option>
        </select>
      </label>
      <div className="view-switch" role="group" aria-label="Binder view">
        <button
          className={view === 'grid' ? 'active' : ''}
          onClick={() => onViewChange('grid')}
          aria-pressed={view === 'grid'}
          title="Grid view"
        >
          ▦
        </button>
        <button
          className={view === 'list' ? 'active' : ''}
          onClick={() => onViewChange('list')}
          aria-pressed={view === 'list'}
          title="List view"
        >
          ☷
        </button>
      </div>
      <p className="result-count" aria-live="polite">
        {resultCount.toLocaleString()} {resultCount === 1 ? 'slot' : 'slots'}
      </p>
    </section>
  );
}

function readMobileFilterPreference(): boolean {
  try {
    return sessionStorage.getItem('binder-filters-open') === 'true';
  } catch {
    return false;
  }
}
