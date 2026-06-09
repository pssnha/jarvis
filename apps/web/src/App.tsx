import { useEffect, useState } from 'react';
import { getMe, logout } from './lib/api';
import type { Me } from './lib/types';
import { Calendar } from './pages/Calendar';
import { Vacations } from './pages/Vacations';
import { Chat } from './pages/Chat';
import { Admin } from './pages/Admin';
import { Login } from './pages/Login';

type View = 'calendar' | 'vacations' | 'chat' | 'admin';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [view, setView] = useState<View>('calendar');
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) {
    return (
      <div className="shell">
        <p className="empty">Loading…</p>
      </div>
    );
  }
  if (me === null) return <Login />;

  async function signOut() {
    await logout();
    setMe(null);
  }
  function go(v: View) {
    setView(v);
    setNavOpen(false);
  }
  const item = (v: View, label: string) => (
    <button className={view === v ? 'side-item active' : 'side-item'} onClick={() => go(v)}>
      {label}
    </button>
  );

  return (
    <div className="shell">
      <header className="topbar">
        <button
          className="hamburger"
          onClick={() => setNavOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          ☰
        </button>
        <span className="brand-sm">Jarvis</span>
      </header>

      <div className="body">
        {navOpen && <div className="backdrop" onClick={() => setNavOpen(false)} />}
        <aside className={navOpen ? 'sidebar open' : 'sidebar'}>
          <div className="brand">Jarvis</div>
          <nav className="side-nav">
            {item('calendar', 'Calendar')}
            {item('vacations', 'Vacations')}
            {item('chat', 'Chat')}
            {me.role === 'admin' && item('admin', 'Admin')}
          </nav>
          <div className="side-foot">
            <div className="side-email">{me.email}</div>
            <button className="side-item" onClick={signOut}>
              Sign out
            </button>
          </div>
        </aside>

        <main className="content">
          {view === 'calendar' && <Calendar />}
          {view === 'vacations' && <Vacations />}
          {view === 'chat' && <Chat />}
          {view === 'admin' && me.role === 'admin' && <Admin />}
        </main>
      </div>
    </div>
  );
}
