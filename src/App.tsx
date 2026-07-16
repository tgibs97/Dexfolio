import { useCallback, useEffect, useState } from 'react';
import type { BinderResponse, PokemonSlot, SessionRole } from '../shared/types';
import { api, ApiRequestError } from './api';
import { Admin } from './components/Admin';
import { Binder } from './components/Binder';
import { BinderControls, type Filters } from './components/BinderControls';
import { CardDialog } from './components/CardDialog';
import { Dashboard } from './components/Dashboard';

const initialFilters: Filters = { q: '', status: 'all', generation: 'all', sort: 'number-asc' };

/** Main authenticated screen containing the dashboard and collection browser. */
export function App({ role, onLoggedOut }: { role: SessionRole; onLoggedOut: () => void }) {
  const readOnly = role === 'guest';
  const [page, setPage] = useState<'binder' | 'admin'>(() =>
    !readOnly && window.location.hash === '#admin' ? 'admin' : 'binder',
  );
  const [data, setData] = useState<BinderResponse | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [view, setView] = useState<'grid' | 'list'>(() =>
    localStorage.getItem('binder-view') === 'list' ? 'list' : 'grid',
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);

  /**
   * Reload when filters or collection data change. Search is briefly debounced,
   * and aborting the previous request prevents stale results from winning a race.
   */
  useEffect(() => {
    if (page === 'admin') return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setError('');
        api
          .binder(filters, controller.signal)
          .then(setData)
          .catch((reason) => {
            if (reason instanceof DOMException && reason.name === 'AbortError') return;
            if (reason instanceof ApiRequestError && reason.status === 401) {
              onLoggedOut();
              return;
            }
            setError(reason instanceof ApiRequestError ? reason.message : 'Could not load the binder.');
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      filters.q ? 220 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, refresh, onLoggedOut, page]);

  // The small hash-based route keeps the admin page bookmarkable without a router dependency.
  // Guests are always returned to the binder, even if they manually enter #admin.
  useEffect(() => {
    const changePage = () => {
      if (readOnly && window.location.hash === '#admin') {
        window.history.replaceState(null, '', '#collection');
        setPage('binder');
        return;
      }
      setPage(window.location.hash === '#admin' ? 'admin' : 'binder');
    };
    changePage();
    window.addEventListener('hashchange', changePage);
    return () => window.removeEventListener('hashchange', changePage);
  }, [readOnly]);

  // Success and error notifications disappear automatically after 4.5 seconds.
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // A stable callback keeps CardDialog's loading effect from running again.
  const notify = useCallback(
    (message: string, kind: 'success' | 'error' = 'success') => setToast({ message, kind }),
    [],
  );
  function changeView(next: 'grid' | 'list') {
    // Persist the preferred layout for the next browser visit.
    setView(next);
    localStorage.setItem('binder-view', next);
  }
  async function logout() {
    try {
      await api.logout();
    } finally {
      onLoggedOut();
    }
  }
  function openSlot(slot: PokemonSlot) {
    // CardDialog fetches full card history using this selected Pokémon ID.
    setSelectedId(slot.id);
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Dexfolio home" onClick={() => setPage('binder')}>
          <div className="brand-mark small" aria-hidden="true">
            <span />
          </div>
          <div>
            <strong>Dexfolio</strong>
            <small>Every Pokémon. One binder.</small>
          </div>
        </a>
        <nav aria-label="Primary navigation">
          {readOnly && <span className="guest-badge">View only</span>}
          {!readOnly && (
            <a href="#admin" onClick={() => setPage('admin')}>
              Admin
            </a>
          )}
          <button className="text-button" onClick={() => void logout()}>
            {readOnly ? 'Exit guest' : 'Sign out'}
          </button>
        </nav>
      </header>
      {page === 'admin' ? (
        <Admin onDataChanged={() => setRefresh((value) => value + 1)} />
      ) : (
        <main id="top">
          <h1 className="sr-only">My Pokémon card binder</h1>
          <div id="progress">
            {data ? <Dashboard summary={data.summary} onOpenCard={setSelectedId} /> : <DashboardSkeleton />}
          </div>
          <section className="collection" id="collection">
            <div className="section-title">
              <div>
                <p className="eyebrow">Browse the binder</p>
                <h2>All Pokémon</h2>
              </div>
            </div>
            <BinderControls
              filters={filters}
              onChange={setFilters}
              view={view}
              onViewChange={changeView}
              resultCount={data?.pokemon.length ?? 0}
              generations={data?.summary.generations.map((item) => item.generation) ?? []}
            />
            {error && (
              <div className="error-banner" role="alert">
                <span>!</span>
                <div>
                  <strong>Binder unavailable</strong>
                  <p>{error}</p>
                </div>
                <button onClick={() => setRefresh((value) => value + 1)}>Try again</button>
              </div>
            )}
            {loading && !data ? (
              <BinderSkeleton />
            ) : (
              data && (
                <>
                  <div className={loading ? 'results updating' : 'results'}>
                    <Binder pokemon={data.pokemon} view={view} onSelect={openSlot} readOnly={readOnly} />
                  </div>
                  {loading && <span className="filter-spinner" aria-label="Updating results" />}
                </>
              )
            )}
          </section>
        </main>
      )}
      <footer>
        <div className="brand-mark tiny" aria-hidden="true">
          <span />
        </div>
        <p>Dexfolio · Built for the long silph road to a complete Pokédex.</p>
      </footer>
      {selectedId !== null && (
        <CardDialog
          pokemonId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => setRefresh((value) => value + 1)}
          notify={notify}
          readOnly={readOnly}
        />
      )}
      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          <span>{toast.kind === 'success' ? '✓' : '!'}</span>
          {toast.message}
          <button onClick={() => setToast(null)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="dashboard skeleton">
      <div className="skeleton-circle" />
      <div>
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
function BinderSkeleton() {
  return (
    <div className="binder-grid skeleton-grid">
      {Array.from({ length: 12 }, (_, index) => (
        <div className="skeleton-card" key={index}>
          <i />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
