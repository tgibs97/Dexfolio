import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { Admin } from './Admin';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
});
