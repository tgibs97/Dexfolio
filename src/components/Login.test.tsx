import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { Login } from './Login';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Login', () => {
  it('opens a view-only guest session with the guest password', async () => {
    const onAuthenticated = vi.fn();
    const guest = vi.spyOn(api, 'guest').mockResolvedValue({ authenticated: true, role: 'guest' });

    render(<Login onAuthenticated={onAuthenticated} />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'guest password' } });
    fireEvent.click(screen.getByRole('button', { name: 'View as guest' }));

    await waitFor(() => expect(guest).toHaveBeenCalledWith('guest password'));
    expect(onAuthenticated).toHaveBeenCalledWith('guest');
  });

  it('identifies a password login as an admin session', async () => {
    const onAuthenticated = vi.fn();
    vi.spyOn(api, 'login').mockResolvedValue({ authenticated: true, role: 'admin' });

    render(<Login onAuthenticated={onAuthenticated} />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'owner password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('admin'));
  });
});
