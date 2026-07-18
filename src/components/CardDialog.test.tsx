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
    await waitFor(() =>
      expect(cardsSpy).toHaveBeenCalledWith('base1', 1, 'Bulbasaur', 'English', expect.any(AbortSignal)),
    );

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

  it('loads localized cards and saves their linked market snapshot', async () => {
    const japaneseDetail: PokemonDetail = {
      ...detail,
      id: 65,
      nationalDexNumber: 65,
      name: 'Alakazam',
      referenceImageUrl: '/alakazam.png',
    };
    const saveSpy = vi.spyOn(api, 'saveCard').mockResolvedValue(detail);
    const setsSpy = vi.spyOn(api, 'catalogSets').mockResolvedValue({
      sets: [{ id: 'sv4a-shiny-treasure-ex', name: 'Shiny Treasure ex', code: 'SV4a', releaseDate: null }],
    });
    const cardsSpy = vi.spyOn(api, 'catalogCards').mockResolvedValue({
      cards: [
        {
          id: 'poketrace:019bffb5-343d-71aa-b29c-09106357b176:tcg:567726',
          name: 'Alakazam ex',
          number: '326',
          rarity: 'Shiny Secret Rare',
          availablePrintings: ['Holofoil'],
          suggestedPrinting: 'Holofoil',
          prices: [{ printing: 'Holofoil', lowCents: 193, midCents: null, highCents: 193, marketCents: 193 }],
          pricesUpdatedAt: '2026-07-14T00:00:00.000Z',
          tcgplayerUrl: 'https://www.tcgplayer.com/product/567726',
        },
      ],
    });

    render(<CardForm detail={japaneseDetail} mode="add" onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Language/), { target: { value: 'Japanese' } });

    fireEvent.change(screen.getByLabelText(/Set name/), { target: { value: 'SV4a' } });
    await waitFor(() => expect(setsSpy).toHaveBeenCalledWith('Japanese', 'SV4a', expect.any(AbortSignal)));
    fireEvent.click(await screen.findByRole('option', { name: /Shiny Treasure ex.*SV4a/ }));
    await waitFor(() =>
      expect(cardsSpy).toHaveBeenCalledWith(
        'sv4a-shiny-treasure-ex',
        65,
        'Alakazam',
        'Japanese',
        expect.any(AbortSignal),
      ),
    );
    await screen.findByText('1 matching card found.');
    const setRequestsAfterSelection = setsSpy.mock.calls.length;
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    expect(setsSpy).toHaveBeenCalledTimes(setRequestsAfterSelection);
    expect(screen.getByText('1 matching card found.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Card number/), { target: { value: '326' } });
    fireEvent.click(await screen.findByRole('option', { name: /326.*Alakazam ex/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to binder' }));

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(
        65,
        expect.objectContaining({
          language: 'Japanese',
          setCode: 'SV4a',
          catalogCardId: 'poketrace:019bffb5-343d-71aa-b29c-09106357b176:tcg:567726',
          marketPriceCents: '193',
        }),
        null,
        'add',
      ),
    );
  });

  it('preserves the selected printing when localized catalog records share a name and number', async () => {
    const pikachuDetail: PokemonDetail = {
      ...detail,
      id: 25,
      nationalDexNumber: 25,
      name: 'Pikachu',
      referenceImageUrl: '/pikachu.png',
    };
    const saveSpy = vi.spyOn(api, 'saveCard').mockResolvedValue(detail);
    vi.spyOn(api, 'catalogSets').mockResolvedValue({
      sets: [{ id: 'sv4a-shiny-treasure-ex', name: 'Shiny Treasure ex', code: 'SV4a', releaseDate: null }],
    });
    vi.spyOn(api, 'catalogCards').mockResolvedValue({
      cards: [
        {
          id: 'poketrace:019bffb5-343c-76dd-8c12-bf3e04f2e3b5',
          name: 'Pikachu',
          number: '055',
          rarity: 'Common',
          availablePrintings: ['Normal'],
          suggestedPrinting: 'Normal',
          prices: [{ printing: 'Normal', lowCents: 100, midCents: null, highCents: 200, marketCents: 150 }],
          pricesUpdatedAt: '2026-07-17T12:00:00Z',
          tcgplayerUrl: 'https://www.ebay.com/itm/normal',
        },
        {
          id: 'poketrace:019bffc4-1bf1-75bf-8a70-1f9962cfa4aa',
          name: 'Pikachu',
          number: '055',
          rarity: 'Common',
          availablePrintings: ['Holofoil'],
          suggestedPrinting: 'Holofoil',
          prices: [{ printing: 'Holofoil', lowCents: 200, midCents: null, highCents: 300, marketCents: 250 }],
          pricesUpdatedAt: '2026-07-17T12:00:00Z',
          tcgplayerUrl: 'https://www.ebay.com/itm/holofoil',
        },
      ],
    });

    render(<CardForm detail={pikachuDetail} mode="add" onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Language/), { target: { value: 'Japanese' } });
    fireEvent.change(screen.getByLabelText(/Set name/), { target: { value: 'SV4a' } });
    fireEvent.click(await screen.findByRole('option', { name: /Shiny Treasure ex.*SV4a/ }));
    await screen.findByText('2 matching cards found.');

    fireEvent.change(screen.getByLabelText(/Card number/), { target: { value: '055' } });
    fireEvent.click(await screen.findByRole('option', { name: /Pikachu.*Holofoil/ }));
    expect(screen.getByLabelText(/Printing/)).toHaveValue('Holofoil');
    fireEvent.click(screen.getByRole('button', { name: 'Add to binder' }));

    await waitFor(() =>
      expect(saveSpy).toHaveBeenCalledWith(
        25,
        expect.objectContaining({
          catalogCardId: 'poketrace:019bffc4-1bf1-75bf-8a70-1f9962cfa4aa',
          printing: 'Holofoil',
          marketPriceCents: '250',
          tcgplayerUrl: 'https://www.ebay.com/itm/holofoil',
        }),
        null,
        'add',
      ),
    );
  });

  it('recovers a stale localized set name from its correct Japanese set code', async () => {
    const setsSpy = vi.spyOn(api, 'catalogSets').mockResolvedValue({
      sets: [{ id: 'sv4a-shiny-treasure-ex', name: 'Shiny Treasure ex', code: 'SV4a', releaseDate: null }],
    });
    const cardsSpy = vi.spyOn(api, 'catalogCards').mockResolvedValue({ cards: [] });
    const alakazamDetail: PokemonDetail = {
      ...detail,
      id: 65,
      nationalDexNumber: 65,
      name: 'Alakazam',
      referenceImageUrl: '/alakazam.png',
    };

    render(<CardForm detail={alakazamDetail} mode="add" onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Language/), { target: { value: 'Japanese' } });
    fireEvent.change(screen.getByLabelText(/Set name/), { target: { value: 'レイジングサーフ' } });
    fireEvent.change(screen.getByLabelText(/Set code/), { target: { value: 'SV4a' } });

    await waitFor(() => expect(setsSpy).toHaveBeenCalledWith('Japanese', 'SV4a', expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Set name/ })).toHaveValue('Shiny Treasure ex'));
    await waitFor(() =>
      expect(cardsSpy).toHaveBeenCalledWith(
        'sv4a-shiny-treasure-ex',
        65,
        'Alakazam',
        'Japanese',
        expect.any(AbortSignal),
      ),
    );
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
        // Foreign catalog providers return a full ISO timestamp here.
        priceUpdatedAt: '2026-07-16T00:00:00.000Z',
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
    expect(screen.getByRole('img', { name: 'Market price history chart' })).toBeInTheDocument();
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
