import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogCard, PokemonDetail } from '../../shared/types';
import { api } from '../api';
import { CardDialog, CardForm } from './CardDialog';

const detail: PokemonDetail = {
  id: 1,
  nationalDexNumber: 1,
  name: 'Bulbasaur',
  generation: 1,
  referenceImageUrl: '/bulbasaur.png',
  status: 'missing',
  currentCard: null,
  updatedAt: null,
  history: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Add Card catalog assistance', () => {
  it('defaults the acquisition date to today in the local timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 16, 12));
    vi.spyOn(api, 'catalogSets').mockResolvedValue({ sets: [] });

    render(<CardForm detail={detail} mode="add" onSaved={vi.fn()} />);

    expect(screen.getByLabelText(/Acquisition date/)).toHaveValue('2026-07-16');
  });

  it('shows visible suggestions and fills related card details when selected', async () => {
    const saveSpy = vi.spyOn(api, 'saveCard').mockResolvedValue(detail);
    vi.spyOn(api, 'catalogSets').mockResolvedValue({
      sets: [{ id: 'base1', name: 'Base', code: 'BS', releaseDate: '1999/01/09' }],
    });
    const cardsSpy = vi.spyOn(api, 'catalogCards').mockResolvedValue({
      cards: [
        {
          id: 'base1-44',
          name: 'Bulbasaur',
          number: '44',
          rarity: 'Common',
          availablePrintings: ['Holofoil'],
          suggestedPrinting: 'Holofoil',
          prices: [{ printing: 'Holofoil', lowCents: 100, midCents: 150, highCents: 200, marketCents: 175 }],
          pricesUpdatedAt: '2026/07/15',
          tcgplayerUrl: 'https://prices.pokemontcg.io/tcgplayer/base1-44',
        },
      ],
    });

    render(<CardForm detail={detail} mode="add" onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Choose a suggestion to fill the set code.')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Set name/), { target: { value: 'bas' } });
    fireEvent.click(await screen.findByRole('option', { name: /Base.*BS/ }));
    expect(screen.getByLabelText(/Set code/)).toHaveValue('BS');
    await waitFor(() => expect(cardsSpy).toHaveBeenCalledWith('base1', 1, expect.any(AbortSignal)));

    fireEvent.change(screen.getByLabelText(/Card name/), { target: { value: 'bulb' } });
    fireEvent.click(await screen.findByRole('option', { name: /Bulbasaur.*44.*Common/ }));
    expect(screen.getByLabelText(/Card name/)).toHaveValue('Bulbasaur');
    expect(screen.getByLabelText(/Card number/)).toHaveValue('44');
    expect(screen.getByLabelText(/Rarity/)).toHaveValue('Common');
    expect(screen.getByLabelText(/Printing/)).toHaveValue('Holofoil');
    expect(screen.queryByRole('option', { name: 'Normal' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to binder' }));
    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          catalogCardId: 'base1-44',
          marketPriceCents: '175',
          lowPriceCents: '100',
          midPriceCents: '150',
          highPriceCents: '200',
          priceUpdatedAt: '2026/07/15',
          tcgplayerUrl: 'https://prices.pokemontcg.io/tcgplayer/base1-44',
        }),
        null,
        'add',
      ),
    );
  });

  it('keeps the form open when a cached card record lacks printing fields', async () => {
    vi.spyOn(api, 'catalogSets').mockResolvedValue({
      sets: [{ id: 'base1', name: 'Base', code: 'BS', releaseDate: '1999/01/09' }],
    });
    vi.spyOn(api, 'catalogCards').mockResolvedValue({
      cards: [{ id: 'base1-44', name: 'Bulbasaur', number: '44', rarity: 'Common' }] as CatalogCard[],
    });

    render(<CardForm detail={detail} mode="add" onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Choose a suggestion to fill the set code.')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Set name/), { target: { value: 'bas' } });
    fireEvent.click(await screen.findByRole('option', { name: /Base.*BS/ }));
    fireEvent.change(screen.getByLabelText(/Card name/), { target: { value: 'bulb' } });
    fireEvent.click(await screen.findByRole('option', { name: /Bulbasaur.*44.*Common/ }));

    expect(screen.getByRole('button', { name: 'Add to binder' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Card number/)).toHaveValue('44');
    expect(screen.getByLabelText(/Printing/)).toHaveValue('Normal');
  });

  it('preserves loaded cards when a recognized set code suggestion is selected', async () => {
    vi.spyOn(api, 'catalogSets').mockResolvedValue({
      sets: [{ id: 'sv3pt5', name: '151', code: 'MEW', releaseDate: '2023/09/22' }],
    });
    const cardsSpy = vi.spyOn(api, 'catalogCards').mockResolvedValue({
      cards: [
        {
          id: 'sv3pt5-1',
          name: 'Bulbasaur',
          number: '1',
          rarity: 'Common',
          availablePrintings: ['Normal', 'Reverse Holofoil'],
          suggestedPrinting: null,
          prices: [],
          pricesUpdatedAt: null,
          tcgplayerUrl: null,
        },
        {
          id: 'sv3pt5-166',
          name: 'Bulbasaur',
          number: '166',
          rarity: 'Illustration Rare',
          availablePrintings: ['Holofoil'],
          suggestedPrinting: 'Holofoil',
          prices: [],
          pricesUpdatedAt: null,
          tcgplayerUrl: null,
        },
      ],
    });

    render(<CardForm detail={detail} mode="add" onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Choose a suggestion to fill the set code.')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Set name/), { target: { value: 'mew' } });
    expect(screen.getByLabelText(/Set code/)).toHaveValue('MEW');
    await screen.findByText('2 matching cards found.');

    fireEvent.click(screen.getByRole('option', { name: /151.*MEW/ }));

    expect(screen.getByText('2 matching cards found.')).toBeInTheDocument();
    expect(cardsSpy).toHaveBeenCalledTimes(1);
    fireEvent.focus(screen.getByLabelText(/Card name/));
    expect(screen.getAllByRole('option', { name: /Bulbasaur/ })).toHaveLength(2);
  });
});

describe('Collected card details', () => {
  it('links the TCGplayer market price to the catalog product page', async () => {
    const collected: PokemonDetail = {
      ...detail,
      status: 'collected',
      currentCard: {
        id: 'card-1',
        pokemonId: 1,
        cardName: 'Bulbasaur',
        setName: 'Base',
        setCode: 'BS',
        cardNumber: '44',
        rarity: 'Common',
        printing: 'Normal',
        language: 'English',
        condition: 'Near mint',
        acquisitionDate: '2026-07-16',
        purchasePriceCents: 200,
        catalogCardId: 'base1-44',
        marketPriceCents: 325,
        lowPriceCents: 250,
        midPriceCents: 350,
        highPriceCents: 450,
        priceUpdatedAt: '2026/07/16',
        tcgplayerUrl: 'https://prices.pokemontcg.io/tcgplayer/base1-44',
        notes: null,
        imageUrl: null,
        isCurrent: true,
        addedAt: '2026-07-16T12:00:00.000Z',
        updatedAt: '2026-07-16T12:00:00.000Z',
        replacedAt: null,
        retiredReason: null,
      },
    };
    vi.spyOn(api, 'detail').mockResolvedValue(collected);
    vi.spyOn(api, 'priceHistory').mockResolvedValue({
      cardId: 'card-1',
      catalogCardId: 'base1-44',
      printing: 'Normal',
      purchasePriceCents: 200,
      currentMarketCents: 325,
      unrealizedGainCents: 125,
      unrealizedGainPercentage: 62.5,
      change7d: { cents: 25, percentage: 8.33 },
      change30d: null,
      history: [
        {
          marketPriceCents: 300,
          lowPriceCents: 250,
          midPriceCents: 325,
          highPriceCents: 400,
          sourceUpdatedAt: '2026/07/09',
          capturedAt: '2026-07-09T12:00:00.000Z',
        },
        {
          marketPriceCents: 325,
          lowPriceCents: 250,
          midPriceCents: 350,
          highPriceCents: 450,
          sourceUpdatedAt: '2026/07/16',
          capturedAt: '2026-07-16T12:00:00.000Z',
        },
      ],
    });

    render(<CardDialog pokemonId={1} onClose={vi.fn()} onChanged={vi.fn()} notify={vi.fn()} />);

    const link = await screen.findByRole('link', { name: '$3.25' });
    expect(link).toHaveAttribute('href', 'https://prices.pokemontcg.io/tcgplayer/base1-44');
    expect(link).toHaveAttribute('target', '_blank');
    expect(await screen.findByText('+$1.25 (+62.50%)')).toHaveClass('trend-positive');
    expect(screen.getByText('+$0.25 (+8.33%)')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'TCGplayer market price history chart' })).toBeInTheDocument();
  });

  it('shows card details without collection actions to guests', async () => {
    const collected: PokemonDetail = {
      ...detail,
      status: 'collected',
      currentCard: {
        id: 'card-guest',
        pokemonId: 1,
        cardName: 'Bulbasaur',
        setName: '151',
        setCode: 'MEW',
        cardNumber: '166',
        rarity: 'Illustration Rare',
        printing: 'Holofoil',
        language: 'English',
        condition: 'Near mint',
        acquisitionDate: null,
        purchasePriceCents: 499,
        catalogCardId: null,
        marketPriceCents: 8296,
        lowPriceCents: null,
        midPriceCents: null,
        highPriceCents: null,
        priceUpdatedAt: null,
        tcgplayerUrl: null,
        notes: 'Collection copy',
        imageUrl: null,
        isCurrent: true,
        addedAt: '2026-07-16T12:00:00.000Z',
        updatedAt: '2026-07-16T12:00:00.000Z',
        replacedAt: null,
        retiredReason: null,
      },
    };
    vi.spyOn(api, 'detail').mockResolvedValue(collected);

    render(<CardDialog pokemonId={1} onClose={vi.fn()} onChanged={vi.fn()} notify={vi.fn()} readOnly />);

    expect(await screen.findByText('Guest view · Card changes are disabled.')).toBeInTheDocument();
    expect(screen.getByText('Collection copy')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit card' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replace card' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('shows an informational missing slot instead of the add form to guests', async () => {
    vi.spyOn(api, 'detail').mockResolvedValue(detail);

    render(<CardDialog pokemonId={1} onClose={vi.fn()} onChanged={vi.fn()} notify={vi.fn()} readOnly />);

    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to binder' })).not.toBeInTheDocument();
  });
});
