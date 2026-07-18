import { useEffect, useRef, useState } from 'react';
import type {
  CollectionImportResponse,
  ExternalApiActivityResponse,
  PokedexSyncResponse,
  PokedexSyncStatus,
  PriceRefreshResponse,
} from '../../shared/types';
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
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<File | null>(null);
  const [transferResult, setTransferResult] = useState<CollectionImportResponse | null>(null);
  const [transferMessage, setTransferMessage] = useState('');
  const [transferError, setTransferError] = useState('');
  const [apiActivity, setApiActivity] = useState<ExternalApiActivityResponse | null>(null);
  const [loadingApiActivity, setLoadingApiActivity] = useState(true);
  const [updatingApiLogging, setUpdatingApiLogging] = useState(false);
  const [apiActivityError, setApiActivityError] = useState('');
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    api
      .externalApiActivity()
      .then((activity) => {
        if (active) setApiActivity(activity);
      })
      .catch((reason: unknown) => {
        if (active)
          setApiActivityError(reason instanceof ApiRequestError ? reason.message : 'API activity could not be loaded.');
      })
      .finally(() => {
        if (active) setLoadingApiActivity(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadApiActivity(beforeId?: number, append = false) {
    setLoadingApiActivity(true);
    setApiActivityError('');
    try {
      const next = await api.externalApiActivity(beforeId);
      setApiActivity((current) => (append && current ? { ...next, logs: [...current.logs, ...next.logs] } : next));
    } catch (reason) {
      setApiActivityError(reason instanceof ApiRequestError ? reason.message : 'API activity could not be loaded.');
    } finally {
      setLoadingApiActivity(false);
    }
  }

  async function changeApiLogging(enabled: boolean) {
    setUpdatingApiLogging(true);
    setApiActivityError('');
    try {
      const result = await api.setExternalApiLogging(enabled);
      setApiActivity((current) =>
        current
          ? { ...current, enabled: result.enabled }
          : { enabled: result.enabled, total: 0, logs: [], nextBeforeId: null },
      );
    } catch (reason) {
      setApiActivityError(
        reason instanceof ApiRequestError ? reason.message : 'The logging setting could not be saved.',
      );
    } finally {
      setUpdatingApiLogging(false);
    }
  }

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
      void loadApiActivity();
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
      void loadApiActivity();
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
      void loadApiActivity();
    }
  }

  async function exportData() {
    setExporting(true);
    setTransferError('');
    setTransferResult(null);
    try {
      const backup = await api.exportData();
      downloadBlob(backup.blob, backup.filename);
      setTransferMessage(
        `Exported ${backup.cards} card record${backup.cards === 1 ? '' : 's'} and ${backup.images} photo${backup.images === 1 ? '' : 's'}.`,
      );
    } catch (reason) {
      setTransferMessage('');
      setTransferError(reason instanceof ApiRequestError ? reason.message : 'Collection data could not be exported.');
    } finally {
      setExporting(false);
    }
  }

  async function importData() {
    if (!selectedBackup) return;
    if (!selectedBackup.name.toLowerCase().endsWith('.zip')) {
      setTransferError('Choose a Dexfolio ZIP backup.');
      return;
    }
    if (selectedBackup.size > 50 * 1024 * 1024) {
      setTransferError('The backup file must be 50 MB or smaller.');
      return;
    }
    const confirmed = window.confirm(
      'Importing will replace all current and archived card records, pricing history, and card photos. Continue?',
    );
    if (!confirmed) return;
    setImporting(true);
    setTransferError('');
    setTransferMessage('');
    setTransferResult(null);
    try {
      const result = await api.importData(selectedBackup);
      setTransferResult(result);
      setSelectedBackup(null);
      if (backupInput.current) backupInput.current.value = '';
      onDataChanged();
    } catch (reason) {
      setTransferError(reason instanceof ApiRequestError ? reason.message : 'Collection data could not be imported.');
    } finally {
      setImporting(false);
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
      <section className="admin-panel" aria-labelledby="data-transfer-title">
        <div>
          <p className="eyebrow">Portable collection backup</p>
          <h2 id="data-transfer-title">Import or export collection data</h2>
          <p>
            Export current and archived cards, pricing history, and card photos in one ZIP. Importing replaces those
            records and reconnects them to Pokémon by National Pokédex number.
          </p>
          <p className="admin-note">
            Only Dexfolio ZIP backups are supported. Update the Pokédex first if a backup contains newer Pokémon.
          </p>
        </div>
        <div className="admin-actions admin-transfer-actions">
          <button
            className="secondary admin-action"
            disabled={exporting || importing}
            onClick={() => void exportData()}
          >
            {exporting ? (
              <>
                <span className="button-spinner dark" aria-hidden="true" /> Exporting…
              </>
            ) : (
              'Export ZIP backup'
            )}
          </button>
          <label className="file-picker">
            <span>{selectedBackup ? selectedBackup.name : 'Choose ZIP backup'}</span>
            <input
              ref={backupInput}
              type="file"
              accept="application/zip,.zip"
              disabled={exporting || importing}
              onChange={(event) => setSelectedBackup(event.target.files?.[0] ?? null)}
            />
          </label>
          <button
            className="primary admin-action"
            disabled={!selectedBackup || exporting || importing}
            onClick={() => void importData()}
          >
            {importing ? (
              <>
                <span className="button-spinner" aria-hidden="true" /> Importing…
              </>
            ) : (
              'Import and replace'
            )}
          </button>
        </div>
        {transferError && (
          <p className="form-error admin-result" role="alert">
            {transferError}
          </p>
        )}
        {transferMessage && !transferError && (
          <p className="admin-result transfer-message" role="status">
            {transferMessage}
          </p>
        )}
        {transferResult && !transferError && (
          <div className="admin-result" role="status">
            <strong>Collection import complete</strong>
            <dl className="transfer-stats">
              <div>
                <dt>Card records</dt>
                <dd>{transferResult.cardsImported}</dd>
              </div>
              <div>
                <dt>Current cards</dt>
                <dd>{transferResult.currentCards}</dd>
              </div>
              <div>
                <dt>Price snapshots</dt>
                <dd>{transferResult.priceHistoryImported}</dd>
              </div>
              <div>
                <dt>Photos restored</dt>
                <dd>{transferResult.imagesImported}</dd>
              </div>
              <div>
                <dt>Photos skipped</dt>
                <dd>{transferResult.skippedImages}</dd>
              </div>
            </dl>
            <small>Finished {formatDateTime(transferResult.importedAt)}</small>
          </div>
        )}
      </section>
      <section className="admin-panel" aria-labelledby="pricing-title">
        <div>
          <p className="eyebrow">Marketplace snapshots</p>
          <h2 id="pricing-title">Refresh card pricing</h2>
          <p>
            Fetch the latest available market, low, mid, and high prices for every current and archived card linked to
            the multilingual Pokémon TCG catalog.
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
              <div>
                <dt>Deferred cards</dt>
                <dd>{priceResult.deferred}</dd>
              </div>
            </dl>
            <small>Finished {formatDateTime(priceResult.refreshedAt)}</small>
            {priceResult.deferred > 0 && (
              <p>Deferred cards will rotate into a future daily refresh to stay within Worker limits.</p>
            )}
            {(priceResult.missingCatalogId > 0 || priceResult.missingPricing > 0) && (
              <p>Edit and save skipped cards after selecting a catalog suggestion to link them for future refreshes.</p>
            )}
          </div>
        )}
      </section>
      <section className="admin-panel api-activity-panel" aria-labelledby="api-activity-title">
        <div>
          <p className="eyebrow">External service observability</p>
          <h2 id="api-activity-title">External API activity</h2>
          <p>
            Review real outbound requests to PokéAPI, Pokémon TCG API, PokeTrace, TCGdex, and the exchange-rate API.
            Cache hits do not create log entries.
          </p>
          <p className="admin-note">Request headers and API keys are never stored.</p>
        </div>
        <div className="api-activity-actions">
          <label className="api-logging-toggle">
            <input
              type="checkbox"
              checked={apiActivity?.enabled ?? true}
              disabled={!apiActivity || updatingApiLogging}
              onChange={(event) => void changeApiLogging(event.target.checked)}
            />
            <span>
              {updatingApiLogging ? 'Saving…' : apiActivity?.enabled === false ? 'Logging off' : 'Logging on'}
            </span>
          </label>
          <button
            className="secondary admin-action"
            disabled={loadingApiActivity}
            onClick={() => void loadApiActivity()}
          >
            {loadingApiActivity ? 'Loading activity…' : 'Refresh activity'}
          </button>
        </div>
        {apiActivityError && (
          <p className="form-error admin-result" role="alert">
            {apiActivityError}
          </p>
        )}
        {apiActivity && !apiActivityError && (
          <div className="api-activity-log">
            <p className="api-activity-summary">
              {apiActivity.total} logged request{apiActivity.total === 1 ? '' : 's'} · Logging is{' '}
              {apiActivity.enabled ? 'enabled' : 'disabled'}
            </p>
            {apiActivity.logs.length ? (
              <div className="api-log-table" role="table" aria-label="External API request log">
                <div className="api-log-row api-log-heading" role="row">
                  <span role="columnheader">Time</span>
                  <span role="columnheader">Provider</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Duration</span>
                  <span role="columnheader">Endpoint</span>
                </div>
                {apiActivity.logs.map((log) => (
                  <div className={`api-log-row${log.success ? '' : ' failed'}`} role="row" key={log.id}>
                    <span role="cell">{formatDateTime(log.requestedAt)}</span>
                    <strong role="cell">{log.provider}</strong>
                    <span role="cell" title={log.errorMessage ?? undefined}>
                      {log.statusCode ?? 'Network error'}
                    </span>
                    <span role="cell">{log.durationMs.toLocaleString()} ms</span>
                    <code role="cell" title={log.url}>
                      {formatExternalUrl(log.url)}
                    </code>
                  </div>
                ))}
              </div>
            ) : (
              <p className="admin-note">No external requests have been logged yet.</p>
            )}
            {apiActivity.nextBeforeId && (
              <button
                className="secondary api-log-more"
                disabled={loadingApiActivity}
                onClick={() => void loadApiActivity(apiActivity.nextBeforeId ?? undefined, true)}
              >
                {loadingApiActivity ? 'Loading…' : 'Load older requests'}
              </button>
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

function formatExternalUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function formatAddedPokemon(pokemon: PokedexSyncResponse['addedPokemon']): string {
  const visible = pokemon.slice(0, 8).map((item) => `#${item.nationalDexNumber} ${item.name}`);
  const remaining = pokemon.length - visible.length;
  return `Added ${visible.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''}.`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
