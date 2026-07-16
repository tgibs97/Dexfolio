import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinderControls, type Filters } from './BinderControls';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

// Controlled-input tests ensure each control sends the expected next filter object.
describe('BinderControls', () => {
  it('reports search and filter changes', () => {
    const filters: Filters = { q: '', status: 'all', generation: 'all', sort: 'number-asc' };
    const onChange = vi.fn();
    render(
      <BinderControls
        filters={filters}
        onChange={onChange}
        view="grid"
        onViewChange={vi.fn()}
        resultCount={1025}
        generations={[1, 2, 10]}
      />,
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Pikachu' } });
    expect(onChange).toHaveBeenCalledWith({ ...filters, q: 'Pikachu' });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'missing' } });
    expect(onChange).toHaveBeenCalledWith({ ...filters, status: 'missing' });
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'paid-desc' } });
    expect(onChange).toHaveBeenCalledWith({ ...filters, sort: 'paid-desc' });
    expect(screen.getByRole('option', { name: 'Card value: low to high' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Generation 10' })).toBeInTheDocument();
    expect(screen.getAllByText('1,025 slots')).toHaveLength(2);
  });

  it('lets mobile users collapse the controls and remembers the session preference', () => {
    const filters: Filters = { q: '', status: 'all', generation: 'all', sort: 'number-asc' };
    const props = {
      filters,
      onChange: vi.fn(),
      view: 'grid' as const,
      onViewChange: vi.fn(),
      resultCount: 1025,
      generations: [1, 2, 10],
    };
    const { unmount } = render(<BinderControls {...props} />);
    const toggle = screen.getByRole('button', { name: /Search & filters/ });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(sessionStorage.getItem('binder-filters-open')).toBe('true');

    unmount();
    render(<BinderControls {...props} />);
    expect(screen.getByRole('button', { name: /Search & filters/ })).toHaveAttribute('aria-expanded', 'true');
  });
});
