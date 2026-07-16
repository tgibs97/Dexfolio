import { type FormEvent, useState } from 'react';
import type { SessionRole } from '../../shared/types';
import { api, ApiRequestError } from '../api';

/** Offers owner authentication and public, view-only guest access. */
export function Login({ onAuthenticated }: { onAuthenticated: (role: SessionRole) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState<SessionRole | null>(null);
  async function submit(event: FormEvent) {
    // Keep the page in place so request progress and errors can be shown inline.
    event.preventDefault();
    setSubmitting('admin');
    setError('');
    try {
      const session = await api.login(password);
      if (session.role) onAuthenticated(session.role);
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.message : 'Unable to sign in.');
    } finally {
      setSubmitting(null);
    }
  }

  async function continueAsGuest() {
    setSubmitting('guest');
    setError('');
    try {
      const session = await api.guest();
      if (session.role) onAuthenticated(session.role);
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.message : 'Unable to open guest view.');
    } finally {
      setSubmitting(null);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        <p className="eyebrow">Private collection</p>
        <h1 id="login-title">Welcome to Dexfolio</h1>
        <p className="muted">Trent's complete Pokédex card binder, kept in one quiet corner of the web.</p>
        <form onSubmit={submit}>
          <label htmlFor="password">Collection password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={submitting !== null}>
            {submitting === 'admin' ? 'Signing in…' : 'Login'}
          </button>
          <button
            className="secondary full guest-login"
            type="button"
            disabled={submitting !== null}
            onClick={() => void continueAsGuest()}
          >
            {submitting === 'guest' ? 'Opening binder…' : 'View as guest'}
          </button>
        </form>
      </section>
    </main>
  );
}
