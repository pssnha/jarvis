import { useEffect, useState } from 'react';
import { getMe, logout } from './lib/api';
import type { Me } from './lib/types';
import { Calendar } from './pages/Calendar';
import { Vacations } from './pages/Vacations';
import { Chat } from './pages/Chat';
import { Circles, Permissions } from './pages/Admin';
import { Login } from './pages/Login';

type View = 'calendar' | 'vacations' | 'circles' | 'permissions';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [view, setView] = useState<View>('calendar');
  const [navOpen, setNavOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // What the visible center pane is showing — the chat pane acts on the same
  // circle + scope.
  const [active, setActive] = useState<{ circleId: string; scope?: string } | null>(null);

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

  const siteAdmin = me.role === 'admin';
  const circleAdmin = (me.adminCircleIds?.length ?? 0) > 0;

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
        <button className="hamburger" onClick={() => setNavOpen((o) => !o)} aria-label="Toggle menu">
          ☰
        </button>
        <span className="brand-sm">Jarvis</span>
        <span style={{ flex: 1 }} />
        <button
          className="hamburger chat-toggle"
          onClick={() => setChatOpen((o) => !o)}
          aria-label="Toggle assistant"
        >
          💬
        </button>
      </header>

      <div className="body">
        {navOpen && <div className="backdrop" onClick={() => setNavOpen(false)} />}
        <aside className={navOpen ? 'sidebar open' : 'sidebar'}>
          <div className="brand">Jarvis</div>
          <nav className="side-nav">
            {item('calendar', 'Calendar')}
            {item('vacations', 'Vacations')}
            {(siteAdmin || circleAdmin) && (
              <>
                <div className="side-group">Admin</div>
                {item('circles', 'Circles')}
                {siteAdmin && item('permissions', 'Permissions')}
              </>
            )}
          </nav>
          <div className="side-foot">
            <div className="side-email">{me.email}</div>
            <button className="side-item" onClick={signOut}>
              Sign out
            </button>
          </div>
        </aside>

        <main className="content">
          {view === 'calendar' && <Calendar onActive={setActive} />}
          {view === 'vacations' && <Vacations onActive={setActive} />}
          {view === 'circles' && (siteAdmin || circleAdmin) && <Circles siteAdmin={siteAdmin} />}
          {view === 'permissions' && siteAdmin && <Permissions />}
        </main>

        {chatOpen && <div className="backdrop chat-backdrop" onClick={() => setChatOpen(false)} />}
        <aside className={chatOpen ? 'chatpane open' : 'chatpane'}>
          <Chat
            circleId={active?.circleId ?? null}
            scope={active?.scope}
            surface={view === 'vacations' ? 'vacations' : view === 'calendar' ? 'calendar' : 'general'}
            onClose={() => setChatOpen(false)}
          />
        </aside>
      </div>
    </div>
  );
}
