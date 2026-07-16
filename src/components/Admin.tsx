import { useState } from 'react';
import type { PokedexSyncResponse, PokedexSyncStatus, PriceRefreshResponse } from '../../shared/types';
import { api, ApiRequestError } from '../api';

/** Owner-only maintenance tools; the surrounding app already requires the admin session. */
export function Admin({ onDataChanged }: { onDataChanged: () => void }) {
  const [refreshing, setRefreshing] = useState(false);
  const [priceResult, setPriceResult] = useState<PriceRefreshResponse | null>(null);
  const [priceError, setPriceError] = useState('');
  const [checkingPokedex, setCheckingPokedex] = useState(false);
  const [syncingPokedex, setSyncingPokedex] = useState(false);
  const [pokedexStatus, setPokedexStatus] = useState<PokedexSyncStatus | null>(null);
  const [pokedexResult, setPokedexResult] = useState<PokedexSyncResponse | null>(null);
  const [pokedexError, setPokedexError] = useState('');

  async function refreshPrices() {
    setRefreshing(true);
    setPriceError('');
    try {
      const next = await api.refreshPrices();
      setPriceResult(next);
      onDataChanged();
    } catch (reason) {
      setPriceError(reason instanceof ApiRequestError ? reason.message : 'Pricing could not be refreshed.');
    } finally {
      setRefreshing(false);
    }
  }

  async function checkPokedex() {
    setCheckingPokedex(true);
    setPokedexError('');
    setPokedexResult(null);
    try {
      setPokedexStatus(await api.pokedexSyncStatus());
    } catch (reason) {
      setPokedexError(reason instanceof ApiRequestError ? reason.message : 'The Pokédex update check failed.');
    } finally {
      setCheckingPokedex(false);
    }
  }

  async function syncNewPokemon() {
    setSyncingPokedex(true);
    setPokedexError('');
    try {
      const next = await api.syncPokedex();
      setPokedexResult(next);
      setPokedexStatus(next);
      onDataChanged();
    } catch (reason) {
      setPokedexError(reason instanceof ApiRequestError ? reason.message : 'New Pokémon could not be synchronized.');
    } finally {
      setSyncingPokedex(false);
    }
  }

  return (
    <main className="admin-page" id="admin">
      <section className="page-heading admin-heading">
        <div>
          <p className="eyebrow">Collection maintenance</p>
          <h1>Admin</h1>
          <p>Keep external catalog data attached to your binder records up to date.</p>
        </div>
      </section>
      <section className="admin-panel" aria-labelledby="pokedex-sync-title">
        <div>
          <p className="eyebrow">National Pokédex reference data</p>
          <h2 id="pokedex-sync-title">Update Pokédex</h2>
          <p>
            Check PokéAPI for newly released species, then explicitly add only Pokémon that are not already in this
            binder. Existing Pokémon and collection records are never overwritten or deleted.
          </p>
          <p className="admin-note">New species receive an empty binder slot and appear in collection progress.</p>
        </div>
        <div className="admin-actions">
          <button
            className="secondary admin-action"
            disabled={checkingPokedex || syncingPokedex}
            onClick={() => void checkPokedex()}
          >
            {checkingPokedex ? (
              <>
                <span className="button-spinner dark" aria-hidden="true" /> Checking PokéAPI…
              </>
            ) : (
              'Check for new Pokémon'
            )}
          </button>
          {pokedexStatus && pokedexStatus.available > 0 && (
            <button
              className="primary admin-action"
              disabled={checkingPokedex || syncingPokedex}
              onClick={() => void syncNewPokemon()}
            >
              {syncingPokedex ? (
                <>
                  <span className="button-spinner" aria-hidden="true" /> Synchronizing…
                </>
              ) : (
                `Sync ${pokedexStatus.available} new Pokémon`
              )}
            </button>
          )}
        </div>
        {pokedexError && (
          <p className="form-error admin-result" role="alert">
            {pokedexError}
          </p>
        )}
        {pokedexStatus && !pokedexError && (
          <div className="admin-result" role="status">
            <strong>
              {pokedexResult
                ? pokedexResult.added
                  ? 'Pokédex sync complete'
                  : 'No new Pokémon were added'
                : pokedexStatus.available
                  ? 'New Pokémon are available'
                  : 'Pokédex is up to date'}
            </strong>
            <dl>
              <div>
                <dt>Stored</dt>
                <dd>{pokedexStatus.stored}</dd>
              </div>
              <div>
                <dt>PokéAPI total</dt>
                <dd>{pokedexStatus.upstreamTotal}</dd>
              </div>
              <div>
                <dt>Available</dt>
                <dd>{pokedexStatus.available}</dd>
              </div>
              <div>
                <dt>Added</dt>
                <dd>{pokedexResult?.added ?? '—'}</dd>
              </div>
            </dl>
            <small>
              {pokedexResult ? 'Synchronized' : 'Checked'} {formatDateTime(pokedexStatus.checkedAt)}
            </small>
            {pokedexResult && pokedexResult.addedPokemon.length > 0 && (
              <p>{formatAddedPokemon(pokedexResult.addedPokemon)}</p>
            )}
          </div>
        )}
      </section>
      <section className="admin-panel" aria-labelledby="pricing-title">
        <div>
          <p className="eyebrow">TCGplayer snapshots</p>
          <h2 id="pricing-title">Refresh card pricing</h2>
          <p>
            Fetch the latest available market, low, mid, and high prices for every current and archived card linked to
            the Pokémon TCG catalog.
          </p>
          <p className="admin-note">This may take a little while for a large collection.</p>
        </div>
        <button className="primary admin-action" disabled={refreshing} onClick={() => void refreshPrices()}>
          {refreshing ? (
            <>
              <span className="button-spinner" aria-hidden="true" /> Refreshing pricing…
            </>
          ) : (
            'Refresh all pricing'
          )}
        </button>
        {priceError && (
          <p className="form-error admin-result" role="alert">
            {priceError}
          </p>
        )}
        {priceResult && !priceError && (
          <div className="admin-result" role="status">
            <strong>Pricing refresh complete</strong>
            <dl>
              <div>
                <dt>Owned cards</dt>
                <dd>{priceResult.total}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{priceResult.refreshed}</dd>
              </div>
              <div>
                <dt>Not catalog-linked</dt>
                <dd>{priceResult.missingCatalogId}</dd>
              </div>
              <div>
                <dt>Pricing unavailable</dt>
                <dd>{priceResult.missingPricing}</dd>
              </div>
            </dl>
            <small>Finished {formatDateTime(priceResult.refreshedAt)}</small>
            {(priceResult.missingCatalogId > 0 || priceResult.missingPricing > 0) && (
              <p>Edit and save skipped cards after selecting a catalog suggestion to link them for future refreshes.</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatAddedPokemon(pokemon: PokedexSyncResponse['addedPokemon']): string {
  const visible = pokemon.slice(0, 8).map((item) => `#${item.nationalDexNumber} ${item.name}`);
  const remaining = pokemon.length - visible.length;
  return `Added ${visible.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''}.`;
}
