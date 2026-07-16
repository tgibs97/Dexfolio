import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CollectionSummary } from '../../shared/types';
import { Dashboard } from './Dashboard';

const summary: CollectionSummary = {
  total: 2,
  collected: 2,
  percentage: 100,
  generations: [{ generation: 1, total: 2, collected: 2, percentage: 100 }],
  totalSpentCents: 1500,
  totalValueCents: 2375,
  averageCardValueCents: 1188,
  highestValueCard: {
    id: 'one',
    pokemonId: 1,
    pokemonName: 'Bulbasaur',
    cardName: 'Bulbasaur ex',
    cents: 1500,
  },
  lowestValueCard: { id: 'two', pokemonId: 2, pokemonName: 'Ivysaur', cardName: 'Ivysaur', cents: 875 },
};

describe('Dashboard', () => {
  it('shows market-value metrics and opens an extreme-value card', () => {
    const onOpenCard = vi.fn();
    render(<Dashboard summary={summary} onOpenCard={onOpenCard} />);

    expect(screen.getAllByText('$15.00')).toHaveLength(2);
    expect(screen.getByText('$23.75')).toBeInTheDocument();
    expect(screen.getByText('$11.88')).toBeInTheDocument();
    expect(screen.getByText('$8.75')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bulbasaur · Bulbasaur ex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ivysaur · Ivysaur' }));
    expect(onOpenCard).toHaveBeenCalledWith(1);
    expect(onOpenCard).toHaveBeenCalledWith(2);
  });
});
