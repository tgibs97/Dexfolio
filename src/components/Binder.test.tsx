import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PokemonSlot } from '../../shared/types';
import { Binder } from './Binder';

const slots: PokemonSlot[] = [
  {
    id: 1,
    nationalDexNumber: 1,
    name: 'Bulbasaur',
    generation: 1,
    referenceImageUrl: '/1.png',
    status: 'missing',
    currentCard: null,
    updatedAt: null,
  },
  {
    id: 4,
    nationalDexNumber: 4,
    name: 'Charmander',
    generation: 1,
    referenceImageUrl: '/4.png',
    status: 'collected',
    updatedAt: '2026-01-01',
    currentCard: {
      id: 'card-1',
      pokemonId: 4,
      cardName: 'Charmander',
      setName: 'Base Set',
      setCode: 'BS',
      cardNumber: '46/102',
      rarity: 'Common',
      printing: 'Normal',
      language: 'English',
      condition: 'Near mint',
      acquisitionDate: null,
      purchasePriceCents: null,
      catalogCardId: 'base1-46',
      marketPriceCents: 325,
      lowPriceCents: 250,
      midPriceCents: 350,
      highPriceCents: 499,
      priceUpdatedAt: '2026/07/15',
      tcgplayerUrl: 'https://prices.pokemontcg.io/tcgplayer/base1-46',
      notes: null,
      imageUrl: null,
      isCurrent: true,
      addedAt: '2026-01-01',
      updatedAt: '2026-01-01',
      replacedAt: null,
      retiredReason: null,
    },
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The component test verifies what a user sees and clicks, not implementation state.
describe('Binder', () => {
  it('distinguishes collected and missing slots and opens the selected Pokémon', () => {
    const onSelect = vi.fn();
    render(<Binder pokemon={slots} view="grid" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Bulbasaur, missing' })).toBeInTheDocument();
    expect(screen.getByText('Collected')).toBeInTheDocument();
    expect(screen.getByText('Market $3.25')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Charmander, collected' }));
    expect(onSelect).toHaveBeenCalledWith(slots[1]);
  });

  it('uses view-only language for missing slots in guest mode', () => {
    render(<Binder pokemon={slots} view="grid" onSelect={vi.fn()} readOnly />);

    expect(screen.getByText('Not collected')).toBeInTheDocument();
    expect(screen.queryByText('Add your card')).not.toBeInTheDocument();
    expect(document.querySelector('.add-hint')).not.toBeInTheDocument();
  });

  it('jumps to the first visible Pokémon in a numeric Pokédex band', () => {
    const meowth = missingSlot(52, 'Meowth');
    const electrode = missingSlot(101, 'Electrode');
    render(<Binder pokemon={[...slots, meowth, electrode]} view="grid" onSelect={vi.fn()} />);
    const target = screen.getByRole('button', { name: 'Meowth, missing' });
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', { value: scrollIntoView });

    const navigation = screen.getByRole('navigation', { name: 'Pokédex quick navigation' });
    expect(within(navigation).getAllByRole('button')).toHaveLength(3);
    fireEvent.click(within(navigation).getByRole('button', { name: 'Jump to Pokédex #50' }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('collapses into a shorter 100-number index on mobile', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query === '(max-width: 720px)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }) as MediaQueryList,
    );
    const electrode = missingSlot(101, 'Electrode');
    const celebi = missingSlot(251, 'Celebi');
    render(
      <Binder pokemon={[...slots, missingSlot(52, 'Meowth'), electrode, celebi]} view="grid" onSelect={vi.fn()} />,
    );
    const target = screen.getByRole('button', { name: 'Electrode, missing' });
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', { value: scrollIntoView });

    const toggle = screen.getByRole('button', { name: 'Open Pokédex quick navigation' });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const navigation = screen.getByRole('navigation', { name: 'Pokédex quick navigation' });
    expect(within(navigation).getAllByRole('button')).toHaveLength(3);
    expect(within(navigation).queryByRole('button', { name: 'Jump to Pokédex #50' })).not.toBeInTheDocument();
    fireEvent.click(within(navigation).getByRole('button', { name: 'Jump to Pokédex #100' }));

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });
});

function missingSlot(number: number, name: string): PokemonSlot {
  return {
    id: number,
    nationalDexNumber: number,
    name,
    generation: 1,
    referenceImageUrl: `/${number}.png`,
    status: 'missing',
    currentCard: null,
    updatedAt: null,
  };
}
