import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCalendar, listGroups } from '../lib/api';
import type { CalendarOccurrence, GroupSummary } from '../lib/types';
import { EventModal } from '../components/EventModal';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DAY = 86_400_000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function textOn(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return '#111';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff';
}
const CAT_COLOR: Record<string, string> = {
  appointment: '#2563eb',
  vacation: '#16a34a',
  reminder: '#d97706',
  other: '#7c3aed',
};
function dotColor(o: CalendarOccurrence): string {
  return o.color || CAT_COLOR[o.category ?? 'other'] || '#7c3aed';
}

type ViewMode = 'month' | 'week' | 'day';
type Anchor = { y: number; m: number; d: number };

interface Range {
  from: Date;
  to: Date;
  /** dateKeys to render (month: 42 grid cells; week: 7; day: 1). */
  cells: Date[];
}

function computeRange(view: ViewMode, a: Anchor): Range {
  if (view === 'month') {
    const first = new Date(Date.UTC(a.y, a.m, 1));
    const start = new Date(Date.UTC(a.y, a.m, 1 - first.getUTCDay()));
    const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * DAY));
    return { from: start, to: new Date(start.getTime() + 42 * DAY), cells };
  }
  if (view === 'week') {
    const base = new Date(Date.UTC(a.y, a.m, a.d));
    const ws = new Date(base.getTime() - base.getUTCDay() * DAY);
    const cells = Array.from({ length: 7 }, (_, i) => new Date(ws.getTime() + i * DAY));
    return { from: ws, to: new Date(ws.getTime() + 7 * DAY), cells };
  }
  const base = new Date(Date.UTC(a.y, a.m, a.d));
  return { from: base, to: new Date(base.getTime() + DAY), cells: [base] };
}

export function Calendar() {
  const today = new Date();
  const todayAnchor: Anchor = { y: today.getFullYear(), m: today.getMonth(), d: today.getDate() };
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [scope, setScope] = useState<{ groupId: string; memberId?: string } | null>(null);
  const [view, setView] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState<Anchor>(todayAnchor);
  const [byDay, setByDay] = useState<Map<string, CalendarOccurrence[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ eventId?: string; dateKey?: string } | null>(null);

  const range = useMemo(() => computeRange(view, anchor), [view, anchor]);
  const todayKey = ymd(new Date(Date.UTC(todayAnchor.y, todayAnchor.m, todayAnchor.d)));
  const group = scope ? (groups.find((g) => g.id === scope.groupId) ?? null) : null;
  const individual = !!scope?.memberId;

  const load = useCallback(
    async (groupId: string, memberId: string | undefined) => {
      try {
        // Pad ±1 day so tz-shifted occurrences still land in the visible cells.
        const from = new Date(range.from.getTime() - DAY).toISOString();
        const to = new Date(range.to.getTime() + DAY).toISOString();
        const occ = await getCalendar(groupId, from, to, memberId);
        const map = new Map<string, CalendarOccurrence[]>();
        for (const o of occ) {
          const list = map.get(o.dateKey) ?? [];
          list.push(o);
          map.set(o.dateKey, list);
        }
        for (const list of map.values()) list.sort((a, b) => a.startLocal.localeCompare(b.startLocal));
        setByDay(map);
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    },
    [range],
  );

  useEffect(() => {
    listGroups()
      .then((gs) => {
        setGroups(gs);
        setScope((s) => s ?? (gs[0] ? { groupId: gs[0].id } : null));
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (scope) void load(scope.groupId, scope.memberId);
  }, [scope, load]);

  function shift(delta: number) {
    setAnchor((a) => {
      if (view === 'month') {
        const m = a.m + delta;
        return { y: a.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12, d: 1 };
      }
      const step = view === 'week' ? 7 : 1;
      const nd = new Date(Date.UTC(a.y, a.m, a.d + delta * step));
      return { y: nd.getUTCFullYear(), m: nd.getUTCMonth(), d: nd.getUTCDate() };
    });
  }
  function onSaved() {
    setModal(null);
    if (scope) void load(scope.groupId, scope.memberId);
  }
  function onScopeChange(value: string) {
    if (value.includes('::')) {
      const [groupId, memberId] = value.split('::');
      setScope({ groupId: groupId!, memberId });
    } else {
      setScope({ groupId: value });
    }
  }

  const scopeValue = scope
    ? scope.memberId
      ? `${scope.groupId}::${scope.memberId}`
      : scope.groupId
    : '';

  const title = useMemo(() => {
    if (view === 'month') return `${MONTHS[anchor.m]} ${anchor.y}`;
    if (view === 'week') {
      const a = range.cells[0]!;
      const b = range.cells[6]!;
      return `${MON_SHORT[a.getUTCMonth()]} ${a.getUTCDate()} – ${MON_SHORT[b.getUTCMonth()]} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
    }
    const d = range.cells[0]!;
    return `${DOW[d.getUTCDay()]}, ${MON_SHORT[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
  }, [view, anchor, range]);

  if (groups.length === 0) {
    return (
      <div className="calendar">
        {error && <p className="error">{error}</p>}
        <p className="empty">
          No calendars yet. Connect WhatsApp (the groups your number is in appear automatically), or
          add a group in the Admin tab.
        </p>
      </div>
    );
  }

  return (
    <div className="calendar">
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button onClick={() => shift(-1)} aria-label="Previous">‹</button>
          <button onClick={() => setAnchor(todayAnchor)}>Today</button>
          <button onClick={() => shift(1)} aria-label="Next">›</button>
          <h2>{title}</h2>
        </div>
        <div className="cal-actions">
          <div className="view-toggle">
            {(['month', 'week', 'day'] as ViewMode[]).map((v) => (
              <button
                key={v}
                className={view === v ? 'vt on' : 'vt'}
                onClick={() => setView(v)}
              >
                {v[0]!.toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <select value={scopeValue} onChange={(e) => onScopeChange(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                <option value={g.id}>Everyone — {g.name}</option>
                {g.members
                  .filter((m) => m.name)
                  .map((m) => (
                    <option key={m.id} value={`${g.id}::${m.id}`}>
                      {m.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {group && (
            <a className="ical-link" href={`/api/calendar/${group.icalToken}.ics`} title="Subscribe">
              iCal feed
            </a>
          )}
          <button className="primary" onClick={() => setModal({ dateKey: ymd(range.cells[0]!) })}>
            + New
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {group && (
        <p className="muted tz-note">
          Times in {group.timezone}
          {individual && ' · one person'}
        </p>
      )}

      {view === 'month' ? (
        <div className="cal-grid">
          {DOW.map((d) => (
            <div key={d} className="cal-dow">{d}</div>
          ))}
          {range.cells.map((cd) => {
            const key = ymd(cd);
            const items = byDay.get(key) ?? [];
            return (
              <div
                key={key}
                className={
                  'cal-cell' +
                  (cd.getUTCMonth() === anchor.m ? '' : ' out') +
                  (key === todayKey ? ' today' : '')
                }
                onClick={() => setModal({ dateKey: key })}
              >
                <div className="cal-daynum">{cd.getUTCDate()}</div>
                <div className="cal-events">
                  {items.map((o, i) => (
                    <button
                      key={`${o.eventId}-${i}`}
                      className={o.color ? 'chip' : `chip cat-${o.category ?? 'none'}`}
                      style={o.color ? { background: o.color, color: textOn(o.color) } : undefined}
                      title={`${o.title}${o.assigneeName ? ` · ${o.assigneeName}` : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({ eventId: o.eventId });
                      }}
                    >
                      <span className="chip-time">{o.allDay ? '•' : o.timeLabel}</span>{' '}
                      <span className="chip-title">{o.title}</span>
                      {!individual && o.assigneeName && <span className="chip-who"> · {o.assigneeName}</span>}
                      {o.maintainsName && <span className="chip-who"> → {o.maintainsName}</span>}
                      {o.recurring && <span className="chip-rec"> ↻</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="cal-agenda">
          {range.cells.map((cd) => {
            const key = ymd(cd);
            const items = byDay.get(key) ?? [];
            return (
              <div key={key} className={'agenda-day' + (key === todayKey ? ' today' : '')}>
                <div className="agenda-date">
                  <span>
                    {DOW[cd.getUTCDay()]} {cd.getUTCDate()} {MON_SHORT[cd.getUTCMonth()]}
                  </span>
                  <button className="link" onClick={() => setModal({ dateKey: key })}>
                    + add
                  </button>
                </div>
                {items.length === 0 ? (
                  <div className="agenda-empty muted">No events</div>
                ) : (
                  items.map((o, i) => (
                    <button
                      key={`${o.eventId}-${i}`}
                      className="agenda-item"
                      onClick={() => setModal({ eventId: o.eventId })}
                    >
                      <span className="a-dot" style={{ background: dotColor(o) }} />
                      <span className="a-time">{o.allDay ? 'all day' : o.timeLabel}</span>
                      <span className="a-body">
                        <span className="a-title">{o.title}</span>
                        <span className="a-meta">
                          {o.location ? ` · ${o.location}` : ''}
                          {!individual && o.assigneeName ? ` · for ${o.assigneeName}` : ''}
                          {o.maintainsName ? ` · maintains ${o.maintainsName}` : ''}
                          {o.recurring ? ' · ↻ repeats' : ''}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {modal && group && (
        <EventModal
          groupId={group.id}
          eventId={modal.eventId}
          initialDateKey={modal.dateKey}
          defaultAssigneeId={scope?.memberId}
          onClose={() => setModal(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
