import { useEffect, useState } from 'react';
import { getMe, listCircles, logout } from './lib/api';
import type { Me } from './lib/types';
import { Calendar } from './pages/Calendar';
import { Vacations } from './pages/Vacations';
import { Chat } from './pages/Chat';
import { Circles, Permissions } from './pages/Admin';
import { Maintenance } from './pages/Maintenance';
import { Billing } from './pages/Billing';
import { Signups } from './pages/Signups';
import { Splash } from './pages/Splash';
import { Signup } from './pages/Signup';
import { SignupContinue } from './pages/SignupContinue';

/**
 * Running inside the iOS app's web view. The app supplies the navigation (tab
 * bar) and sign-in, so the shell renders bare pages and a full-screen chat.
 */
export const embedded = navigator.userAgent.includes('JarvisiOS');

type View =
  | 'calendar'
  | 'vacations'
  | 'chat'
  | 'circles'
  | 'permissions'
  | 'maintenance'
  | 'billing'
  | 'signups'
  // Public (signed-out) onboarding routes.
  | 'signup'
  | 'welcome';

interface Route {
  view: View;
  /** Optional detail id (e.g. a circle or trip): #/circles/<id>. */
  id: string | null;
}

/** Parse the URL hash into a view + optional detail id. */
function parseRoute(): Route {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/');
  const v = parts[0];
  const known: View[] = [
    'vacations',
    'chat',
    'circles',
    'permissions',
    'maintenance',
    'billing',
    'signups',
    'signup',
    'welcome',
  ];
  const view: View = (known as string[]).includes(v) ? (v as View) : 'calendar';
  return { view, id: parts[1] ? decodeURIComponent(parts[1]) : null };
}

function hashFor(view: View, id?: string | null): string {
  return id ? `#/${view}/${encodeURIComponent(id)}` : `#/${view}`;
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(parseRoute);
  // Bumped when you click the nav item for the page you're already on, to reset
  // its sub-state (e.g. back to the list root).
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

  // In the app, a missing session means the cookie lapsed: tell the native side
  // to re-establish it (it signs in natively; Google won't inside a web view).
  useEffect(() => {
    if (embedded && me === null) {
      window.webkit?.messageHandlers?.jarvis?.postMessage('unauthenticated');
    }
  }, [me]);

  // Remember the circle the calendar/trips pages are on so the app's standalone
  // Chat tab talks to the same one.
  useEffect(() => {
    if (active?.circleId) localStorage.setItem('jarvis:activeCircle', active.circleId);
  }, [active]);

  // Keep the route in sync with browser navigation (back/forward, refresh).
  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Public onboarding routes render regardless of auth state (and before the
  // loading gate) so the sign-up flow works for signed-out visitors.
  if (route.view === 'signup') return <Signup />;
  if (route.view === 'welcome') return <SignupContinue token={route.id ?? ''} />;

  if (me === undefined) {
    return (
      <div className="shell">
        <p className="empty">Loading…</p>
      </div>
    );
  }
  if (me === null) return embedded ? <div className="shell" /> : <Splash />;

  const view = route.view;
  const siteAdmin = me.role === 'admin';
  const circleAdmin = (me.adminCircleIds?.length ?? 0) > 0;

  async function signOut() {
    await logout();
    setMe(null);
  }
  // Navigate by changing the URL hash (pushes history → back/forward + refresh).
  function navigate(v: View, id?: string | null) {
    setNavOpen(false);
    const target = hashFor(v, id);
    if (window.location.hash === target) {
      if (!id) setResetKey((k) => k + 1); // already at this root → reset its sub-state
    } else {
      window.location.hash = target;
    }
  }
  const item = (v: View, label: string) => (
    <button className={view === v ? 'side-item active' : 'side-item'} onClick={() => navigate(v)}>
      {label}
    </button>
  );

  if (embedded) {
    if (view === 'chat') {
      const circleId = active?.circleId ?? localStorage.getItem('jarvis:activeCircle');
      return (
        <div className="shell embedded">
          <EmbeddedChat circleId={circleId} me={me} />
        </div>
      );
    }
    return (
      <div className="shell embedded">
        <main className="content">{renderView()}</main>
      </div>
    );
  }

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
                {item('billing', 'Billing')}
                {siteAdmin && item('signups', 'Sign-ups')}
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

        <main className="content">{renderView()}</main>

        {chatOpen && <div className="backdrop chat-backdrop" onClick={() => setChatOpen(false)} />}
        <aside className={chatOpen ? 'chatpane open' : 'chatpane'}>
          <Chat
            circleId={active?.circleId ?? null}
            scope={active?.scope}
            surface={view === 'vacations' ? 'vacations' : view === 'calendar' ? 'calendar' : 'general'}
            me={me}
            onClose={() => setChatOpen(false)}
          />
        </aside>
      </div>
    </div>
  );

  function renderView() {
            // Resolve the URL view to a page the user may see (else fall back).
            const v: View =
              view === 'circles' && (siteAdmin || circleAdmin)
                ? 'circles'
                : view === 'billing' && (siteAdmin || circleAdmin)
                  ? 'billing'
                  : view === 'signups' && siteAdmin
                    ? 'signups'
                    : view === 'permissions' && siteAdmin
                      ? 'permissions'
                      : view === 'maintenance' && siteAdmin
                        ? 'maintenance'
                        : view === 'vacations'
                          ? 'vacations'
                          : 'calendar';
            const key = `${v}:${resetKey}`;
            if (v === 'vacations')
              return (
                <Vacations
                  key={key}
                  onActive={setActive}
                  itemId={route.id}
                  onOpen={(id) => navigate('vacations', id)}
                  onBack={() => navigate('vacations')}
                />
              );
            if (v === 'circles')
              return (
                <Circles
                  key={key}
                  siteAdmin={siteAdmin}
                  itemId={route.id}
                  onOpen={(id) => navigate('circles', id)}
                  onBack={() => navigate('circles')}
                />
              );
            if (v === 'billing') return <Billing key={key} />;
            if (v === 'signups') return <Signups key={key} itemId={route.id} />;
            if (v === 'permissions') return <Permissions key={key} />;
            if (v === 'maintenance') return <Maintenance key={key} />;
            return <Calendar key={key} onActive={setActive} me={me!} />;
  }
}

/** The app's Chat tab: full-screen, bound to the remembered circle (or the
 *  user's first) since no calendar/trips page is open beside it. */
function EmbeddedChat({ circleId, me }: { circleId: string | null; me: Me }) {
  const [resolved, setResolved] = useState<string | null>(circleId);
  useEffect(() => {
    if (resolved) return;
    listCircles()
      .then((cs) => setResolved(cs[0]?.id ?? null))
      .catch(() => {});
  }, [resolved]);
  return <Chat circleId={resolved} surface="general" me={me} />;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { jarvis?: { postMessage: (msg: string) => void } } };
  }
}
