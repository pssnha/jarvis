import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCalendar, listCircles } from '../lib/api';
import type { CalendarOccurrence, Circle } from '../lib/types';
import { EventModal } from '../components/EventModal';
import {
  HOUR_PX,
  HOURS,
  hourLabel,
  layoutColumns,
  minutesOf,
  type LaidOutBlock,
} from '../lib/timegrid';

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

type Block = LaidOutBlock<CalendarOccurrence>;

/** Lay timed events into side-by-side columns so overlaps don't cover each other. */
function layoutDay(items: CalendarOccurrence[]): Block[] {
  const entries = items
    .filter((o) => !o.allDay)
    .map((o) => {
      const s = minutesOf(o.startLocal);
      let e: number;
      if (o.kind === 'reminder') {
        // Reminders are simple nudges — always show as a fixed 30-min slot so
        // the text is readable (and overlapping ones get split side by side).
        e = s + 30;
      } else {
        e = o.endLocal ? minutesOf(o.endLocal) : s + 60;
        if (e <= s) e = s + 60;
      }
      return { o, startMin: s, endMin: Math.min(e, 1440) };
    });
  return layoutColumns(entries);
}

interface TimeGridProps {
  days: Date[];
  byDay: Map<string, CalendarOccurrence[]>;
  individual: boolean;
  todayKey: string;
  onPick: (eventId: string) => void;
  onAdd: (dateKey: string) => void;
}

/** Google-Calendar-style time grid: hours down the side, day columns across. */
function TimeGrid({ days, byDay, individual, todayKey, onPick, onAdd }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const single = days.length === 1;
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date();
      setNowMin(n.getHours() * 60 + n.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const firstKey = days[0] ? ymd(days[0]) : '';
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const todayInView = days.some((d) => ymd(d) === todayKey);
    const n = new Date();
    const target = todayInView ? n.getHours() * 60 + n.getMinutes() : 8 * 60;
    el.scrollTop = Math.max(0, (target / 60) * HOUR_PX - 40);
  }, [firstKey, single, days, todayKey]);

  return (
    <div className={single ? 'tg tg-single' : 'tg'}>
      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-topstick">
          {!single && (
            <div className="tg-head">
              <div className="tg-corner" />
          {days.map((d) => {
            const key = ymd(d);
            return (
              <div key={key} className={'tg-dayhead' + (key === todayKey ? ' today' : '')}>
                <span className="tg-dow">{DOW[d.getUTCDay()]}</span>
                <span className="tg-dnum">{d.getUTCDate()}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="tg-allday">
        <div className="tg-gutter-label">all-day</div>
        {days.map((d) => {
          const key = ymd(d);
          const allday = (byDay.get(key) ?? []).filter((o) => o.allDay);
          return (
            <div key={key} className="tg-allday-col" onClick={() => onAdd(key)}>
              {allday.map((o, i) => {
                const c = dotColor(o);
                return (
                  <button
                    key={`${o.eventId}-${i}`}
                    className="tg-allday-pill"
                    style={{ background: c, color: textOn(c) }}
                    title={o.title}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPick(o.eventId);
                    }}
                  >
                    {o.title}
                  </button>
                );
              })}
            </div>
          );
        })}
        </div>
        </div>

        <div className="tg-body">
        <div className="tg-gutter" style={{ height: 24 * HOUR_PX }}>
          {HOURS.map((h) => (
            <div key={h} className="tg-hour" style={{ height: HOUR_PX }}>
              <span>{hourLabel(h)}</span>
            </div>
          ))}
        </div>
        {days.map((d) => {
          const key = ymd(d);
          const blocks = layoutDay(byDay.get(key) ?? []);
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className="tg-col"
              style={{
                height: 24 * HOUR_PX,
                backgroundImage: `repeating-linear-gradient(to bottom, #eef0f2 0, #eef0f2 1px, transparent 1px, transparent ${HOUR_PX}px)`,
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const hh = Math.max(0, Math.min(23, Math.floor((e.clientY - rect.top) / HOUR_PX)));
                onAdd(`${key}T${hh < 10 ? '0' : ''}${hh}:00`);
              }}
            >
              {blocks.map((b, i) => {
                const c = dotColor(b.o);
                const reminder = b.o.kind === 'reminder';
                return (
                  <button
                    key={`${b.o.eventId}-${i}`}
                    className={reminder ? 'tg-event reminder' : 'tg-event'}
                    style={{
                      top: (b.startMin / 60) * HOUR_PX,
                      height: Math.max(((b.endMin - b.startMin) / 60) * HOUR_PX - 2, 16),
                      left: `calc(${(b.col / b.cols) * 100}% + 2px)`,
                      width: `calc(${100 / b.cols}% - 4px)`,
                      background: reminder ? `${c}22` : c,
                      color: reminder ? '#1f2937' : textOn(c),
                      borderLeft: reminder ? `3px solid ${c}` : undefined,
                    }}
                    title={b.o.title}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPick(b.o.eventId);
                    }}
                  >
                    <span className="tg-ev-title">
                      {reminder && '🔔 '}
                      {b.o.title}
                    </span>
                    <span className="tg-ev-time">
                      {b.o.timeLabel}
                      {!individual && b.o.assigneeName ? ` · ${b.o.assigneeName}` : ''}
                    </span>
                  </button>
                );
              })}
              {isToday && (
                <div className="tg-now" style={{ top: (nowMin / 60) * HOUR_PX }}>
                  <span className="tg-now-dot" />
                </div>
              )}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
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

/** What the calendar is scoped to within a circle: a group (shared) or one
 *  member's merged calendar (their groups + their private items). */
type Scope =
  | { kind: 'group'; groupId: string }
  | { kind: 'individual'; memberId: string };

function scopeParam(s: Scope): string {
  return s.kind === 'group' ? `group:${s.groupId}` : `individual:${s.memberId}`;
}

export function Calendar({
  onActive,
}: {
  onActive?: (a: { circleId: string; scope?: string }) => void;
}) {
  const today = new Date();
  const todayAnchor: Anchor = { y: today.getFullYear(), m: today.getMonth(), d: today.getDate() };
  const [circles, setCircles] = useState<Circle[]>([]);
  const [circleId, setCircleId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [view, setView] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState<Anchor>(todayAnchor);
  const [byDay, setByDay] = useState<Map<string, CalendarOccurrence[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ eventId?: string; dateKey?: string } | null>(null);

  const range = useMemo(() => computeRange(view, anchor), [view, anchor]);
  const todayKey = ymd(new Date(Date.UTC(todayAnchor.y, todayAnchor.m, todayAnchor.d)));

  const circle = useMemo(() => circles.find((c) => c.id === circleId) ?? null, [circles, circleId]);
  const individual = scope?.kind === 'individual';
  // The group backing the active scope — used for the iCal feed and as the
  // create target. Individual scope creates private events (no group).
  const scopeGroup =
    scope?.kind === 'group' ? (circle?.groups.find((g) => g.id === scope.groupId) ?? null) : null;
  const createTarget = useMemo(() => {
    if (scope?.kind === 'group') return { groupId: scope.groupId };
    if (scope?.kind === 'individual') return { ownerMemberId: scope.memberId };
    return {};
  }, [scope]);

  const load = useCallback(
    async (cid: string, sc: Scope) => {
      try {
        // Pad ±1 day so tz-shifted occurrences still land in the visible cells.
        const from = new Date(range.from.getTime() - DAY).toISOString();
        const to = new Date(range.to.getTime() + DAY).toISOString();
        const occ = await getCalendar(cid, from, to, scopeParam(sc));
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
    listCircles()
      .then((cs) => {
        setCircles(cs);
        setCircleId((id) => id ?? cs[0]?.id ?? null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  // When the active circle changes, default the scope to its first group.
  useEffect(() => {
    if (!circle) return;
    setScope((s) => {
      if (s) {
        // Keep the scope only if it still belongs to this circle.
        if (s.kind === 'group' && circle.groups.some((g) => g.id === s.groupId)) return s;
        if (s.kind === 'individual' && circle.members.some((m) => m.id === s.memberId)) return s;
      }
      const g = circle.groups[0];
      return g ? { kind: 'group', groupId: g.id } : null;
    });
  }, [circle]);

  useEffect(() => {
    if (circleId && scope) void load(circleId, scope);
  }, [circleId, scope, load]);

  // Refetch when the chat assistant reports a change.
  useEffect(() => {
    const h = () => {
      if (circleId && scope) void load(circleId, scope);
    };
    window.addEventListener('jarvis:refresh', h);
    return () => window.removeEventListener('jarvis:refresh', h);
  }, [circleId, scope, load]);

  // Tell the shell which circle + scope is active so the chat pane matches.
  useEffect(() => {
    if (circleId) onActive?.({ circleId, scope: scope ? scopeParam(scope) : undefined });
  }, [circleId, scope, onActive]);

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
    if (circleId && scope) void load(circleId, scope);
  }
  function onScopeChange(value: string) {
    if (value.startsWith('group:')) setScope({ kind: 'group', groupId: value.slice(6) });
    else if (value.startsWith('individual:'))
      setScope({ kind: 'individual', memberId: value.slice(11) });
  }

  const scopeValue = scope ? scopeParam(scope) : '';
  const namedMembers = circle?.members.filter((m) => m.name) ?? [];

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

  if (circles.length === 0) {
    return (
      <div className="calendar">
        {error && <p className="error">{error}</p>}
        <p className="empty">
          No circles yet. Create a circle in the Admin tab — its WhatsApp groups appear automatically.
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
          {circles.length > 1 && (
            <select value={circleId ?? ''} onChange={(e) => setCircleId(e.target.value)}>
              {circles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <select value={scopeValue} onChange={(e) => onScopeChange(e.target.value)}>
            {circle && circle.groups.length > 0 && (
              <optgroup label="Group">
                {circle.groups.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
            )}
            {namedMembers.length > 0 && (
              <optgroup label="Individual">
                {namedMembers.map((m) => (
                  <option key={m.id} value={`individual:${m.id}`}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {scopeGroup && (
            <a
              className="ical-link"
              href={`/api/calendar/${scopeGroup.icalToken}.ics`}
              title="Subscribe"
            >
              iCal feed
            </a>
          )}
          <button
            className="primary"
            onClick={() => setModal({ dateKey: ymd(range.cells[0]!) })}
          >
            + New
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {circle && (
        <p className="muted tz-note">
          Times in {circle.timezone}
          {individual &&
            ` · ${namedMembers.find((m) => m.id === (scope as { memberId: string }).memberId)?.name ?? 'member'} · all groups + private`}
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
                      {o.isPrivate && <span className="chip-who"> · 🔒</span>}
                      {o.recurring && <span className="chip-rec"> ↻</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <TimeGrid
          days={range.cells}
          byDay={byDay}
          individual={individual}
          todayKey={todayKey}
          onPick={(eventId) => setModal({ eventId })}
          onAdd={(dk) => setModal({ dateKey: dk })}
        />
      )}

      {modal && circleId && (
        <EventModal
          circleId={circleId}
          eventId={modal.eventId}
          initialDateKey={modal.dateKey}
          target={modal.eventId ? undefined : createTarget}
          scope={scopeValue || undefined}
          onClose={() => setModal(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
