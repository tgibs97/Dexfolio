import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { api } from './api';
import { Login } from './components/Login';
import type { SessionRole } from '../shared/types';
import './styles.css';

/**
 * Authentication boundary for the browser app. The null state represents the
 * initial cookie check; afterwards the user sees either Login or the binder.
 */
function Root() {
  const [role, setRole] = useState<SessionRole | null | undefined>(undefined);
  // Ask the Worker whether the signed HttpOnly session cookie is still valid.
  useEffect(() => {
    api
      .session()
      .then((session) => setRole(session.authenticated ? session.role : null))
      .catch(() => setRole(null));
  }, []);
  const loggedOut = useCallback(() => setRole(null), []);
  if (role === undefined)
    return (
      <main className="boot-screen">
        <div className="brand-mark" aria-label="Loading Dexfolio">
          <span />
        </div>
        <span className="spinner" />
      </main>
    );
  return role ? <App role={role} onLoggedOut={loggedOut} /> : <Login onAuthenticated={setRole} />;
}

// StrictMode adds extra development checks without changing production output.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
