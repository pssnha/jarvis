import { useEffect, useState } from 'react';
import { getMe, logout } from './lib/api';
import type { Me } from './lib/types';
import { Calendar } from './pages/Calendar';
import { Vacations } from './pages/Vacations';
import { Chat } from './pages/Chat';
import { Circles, Permissions } from './pages/Admin';
import { Maintenance } from './pages/Maintenance';
import { Login } from './pages/Login';

type View = 'calendar' | 'vacations' | 'circles' | 'permissions' | 'maintenance';

const HASH: Record<View, string> = {
  calendar: '#/calendar',
  vacations: '#/vacations',
  circles: '#/circles',
  permissions: '#/permissions',
  maintenance: '#/maintenance',
};

/** Current view from the URL hash (defaults to calendar). */
function viewFromHash(): View {
  const h = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  if (h === 'vacations' || h === 'circles' || h === 'permissions' || h === 'maintenance') return h;
  return 'calendar';
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [view, setView] = useState<View>(viewFromHash);
  // Bumped on a nav click to the page you're already on, to reset its sub-state
  // (e.g. back to the trip/circle list from a detail view).
  const [resetKey, setResetKey] = useState(0);
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

  // Keep the view in sync with browser navigation (back/forward, refresh).
  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
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
    setNavOpen(false);
    if (v === view) setResetKey((k) => k + 1); // re-click → reset to the page root
    if (window.location.hash !== HASH[v]) {
      window.location.hash = HASH[v]; // pushes history → back/forward + refresh work
    }
    setView(v);
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
                {siteAdmin && item('maintenance', 'Maintenance')}
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
          {(() => {
            // Resolve the URL view to a page the user may see (else fall back).
            const v: View =
              view === 'circles' && (siteAdmin || circleAdmin)
                ? 'circles'
                : view === 'permissions' && siteAdmin
                  ? 'permissions'
                  : view === 'maintenance' && siteAdmin
                    ? 'maintenance'
                    : view === 'vacations'
                      ? 'vacations'
                      : 'calendar';
            const key = `${v}:${resetKey}`;
            if (v === 'vacations') return <Vacations key={key} onActive={setActive} />;
            if (v === 'circles') return <Circles key={key} siteAdmin={siteAdmin} />;
            if (v === 'permissions') return <Permissions key={key} />;
            if (v === 'maintenance') return <Maintenance key={key} />;
            return <Calendar key={key} onActive={setActive} />;
          })()}
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
