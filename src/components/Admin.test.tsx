import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { Admin } from './Admin';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Admin', () => {
  it('refreshes pricing and reports updated and skipped cards', async () => {
    const onDataChanged = vi.fn();
    vi.spyOn(api, 'refreshPrices').mockResolvedValue({
      total: 8,
      refreshed: 6,
      missingCatalogId: 1,
      missingPricing: 1,
      refreshedAt: '2026-07-16T17:00:00.000Z',
    });

    render(<Admin onDataChanged={onDataChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh all pricing' }));

    expect(await screen.findByText('Pricing refresh complete')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getAllByText('1')).toHaveLength(2);
    expect(onDataChanged).toHaveBeenCalledOnce();
  });

  it('keeps the action available after a refresh error', async () => {
    vi.spyOn(api, 'refreshPrices').mockRejectedValue(new Error('offline'));
    render(<Admin onDataChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh all pricing' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Pricing could not be refreshed.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh all pricing' })).toBeEnabled());
  });

  it('checks for new species and explicitly synchronizes them', async () => {
    const onDataChanged = vi.fn();
    vi.spyOn(api, 'pokedexSyncStatus').mockResolvedValue({
      stored: 1025,
      upstreamTotal: 1027,
      available: 2,
      checkedAt: '2026-07-16T17:00:00.000Z',
    });
    vi.spyOn(api, 'syncPokedex').mockResolvedValue({
      stored: 1027,
      upstreamTotal: 1027,
      available: 0,
      checkedAt: '2026-07-16T17:01:00.000Z',
      syncedAt: '2026-07-16T17:01:00.000Z',
      added: 2,
      addedPokemon: [
        { nationalDexNumber: 1026, name: 'Examplemon', generation: 10 },
        { nationalDexNumber: 1027, name: 'Samplemon', generation: 10 },
      ],
    });

    render(<Admin onDataChanged={onDataChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for new Pokémon' }));

    expect(await screen.findByText('New Pokémon are available')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync 2 new Pokémon' }));

    expect(await screen.findByText('Pokédex sync complete')).toBeInTheDocument();
    expect(screen.getByText(/#1026 Examplemon/)).toBeInTheDocument();
    expect(onDataChanged).toHaveBeenCalledOnce();
  });

  it('downloads a ZIP collection backup with photos', async () => {
    vi.spyOn(api, 'exportData').mockResolvedValue({
      blob: new Blob(['archive'], { type: 'application/zip' }),
      filename: 'dexfolio-2026-07-16.zip',
      cards: 2,
      images: 1,
    });
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<Admin onDataChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export ZIP backup' }));

    expect(await screen.findByText('Exported 2 card records and 1 photo.')).toBeInTheDocument();
    expect(objectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith('blob:backup');
  });

  it('confirms and imports a selected backup', async () => {
    const onDataChanged = vi.fn();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    vi.spyOn(api, 'importData').mockResolvedValue({
      cardsImported: 3,
      currentCards: 2,
      priceHistoryImported: 4,
      imagesImported: 1,
      skippedImages: 1,
      importedAt: '2026-07-16T17:00:00.000Z',
    });
    const file = new File([new Uint8Array([0x50, 0x4b])], 'backup.zip', { type: 'application/zip' });

    render(<Admin onDataChanged={onDataChanged} />);
    fireEvent.change(screen.getByLabelText('Choose ZIP backup'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import and replace' }));

    expect(await screen.findByText('Collection import complete')).toBeInTheDocument();
    expect(api.importData).toHaveBeenCalledWith(file);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(onDataChanged).toHaveBeenCalledOnce();
  });

  it('rejects non-ZIP backup files before importing', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const importData = vi.spyOn(api, 'importData');
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });

    render(<Admin onDataChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Choose ZIP backup'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Import and replace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a Dexfolio ZIP backup.');
    expect(confirm).not.toHaveBeenCalled();
    expect(importData).not.toHaveBeenCalled();
  });
});
