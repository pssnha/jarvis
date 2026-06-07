import { useEffect, useState } from 'react';
import { getMe, logout } from './lib/api';
import type { Me } from './lib/types';
import { Calendar } from './pages/Calendar';
import { Chat } from './pages/Chat';
import { Admin } from './pages/Admin';
import { Login } from './pages/Login';

type View = 'calendar' | 'chat' | 'admin';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [view, setView] = useState<View>('calendar');

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) {
    return (
      <div className="app">
        <p className="empty">Loading…</p>
      </div>
    );
  }
  if (me === null) return <Login />;

  async function signOut() {
    await logout();
    setMe(null);
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Jarvis</h1>
        <nav className="nav">
          <button
            className={view === 'calendar' ? 'nav-btn active' : 'nav-btn'}
            onClick={() => setView('calendar')}
          >
            Calendar
          </button>
          <button
            className={view === 'chat' ? 'nav-btn active' : 'nav-btn'}
            onClick={() => setView('chat')}
          >
            Chat
          </button>
          {me.role === 'admin' && (
            <button
              className={view === 'admin' ? 'nav-btn active' : 'nav-btn'}
              onClick={() => setView('admin')}
            >
              Admin
            </button>
          )}
        </nav>
        <div className="user-box">
          <span className="muted">{me.email}</span>
          <button className="nav-btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="main">
        {view === 'calendar' && <Calendar />}
        {view === 'chat' && <Chat />}
        {view === 'admin' && me.role === 'admin' && <Admin />}
      </main>
    </div>
  );
}
