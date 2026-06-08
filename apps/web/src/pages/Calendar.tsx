import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCalendar, listGroups } from '../lib/api';
import type { CalendarOccurrence, GroupSummary } from '../lib/types';
import { EventModal } from '../components/EventModal';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Pick a readable text color (black/white) for a given background hex. */
function textOn(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return '#111';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff';
}

interface Cell {
  key: string;
  day: number;
  inMonth: boolean;
}

function buildGrid(year: number, month: number): { cells: Cell[]; from: Date; to: Date } {
  const first = new Date(Date.UTC(year, month, 1));
  const startDow = first.getUTCDay();
  const gridStart = new Date(Date.UTC(year, month, 1 - startDow));
  const cells: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * 86_400_000);
    cells.push({ key: ymd(d), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month });
  }
  const to = new Date(gridStart.getTime() + 42 * 86_400_000);
  return { cells, from: gridStart, to };
}

interface Scope {
  groupId: string;
  memberId?: string;
}

export function Calendar() {
  const today = new Date();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [scope, setScope] = useState<Scope | null>(null);
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [byDay, setByDay] = useState<Map<string, CalendarOccurrence[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ eventId?: string; dateKey?: string } | null>(null);

  const { cells, from, to } = useMemo(() => buildGrid(cursor.year, cursor.month), [cursor]);
  const todayKey = ymd(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));
  const group = scope ? (groups.find((g) => g.id === scope.groupId) ?? null) : null;
  const individual = !!scope?.memberId;

  const load = useCallback(
    async (groupId: string, memberId: string | undefined) => {
      try {
        const occ = await getCalendar(groupId, from.toISOString(), to.toISOString(), memberId);
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
    [from, to],
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

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const m = c.month + delta;
      return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
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
  const scopeValue = scope ? (scope.memberId ? `${scope.groupId}::${scope.memberId}` : scope.groupId) : '';

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
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
          <button onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}>
            Today
          </button>
          <button onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
          <h2>{MONTHS[cursor.month]} {cursor.year}</h2>
        </div>
        <div className="cal-actions">
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
            <a className="ical-link" href={`/api/calendar/${group.icalToken}.ics`} title="Subscribe in a calendar app">
              iCal feed
            </a>
          )}
          <button className="primary" onClick={() => setModal({ dateKey: todayKey })}>
            + New event
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {group && (
        <p className="muted tz-note">
          Times shown in {group.timezone}
          {individual && ' · showing one person'}
        </p>
      )}

      <div className="cal-grid">
        {DOW.map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {cells.map((cell) => {
          const items = byDay.get(cell.key) ?? [];
          return (
            <div
              key={cell.key}
              className={'cal-cell' + (cell.inMonth ? '' : ' out') + (cell.key === todayKey ? ' today' : '')}
              onClick={() => setModal({ dateKey: cell.key })}
            >
              <div className="cal-daynum">{cell.day}</div>
              <div className="cal-events">
                {items.map((o, i) => (
                  <button
                    key={`${o.eventId}-${i}`}
                    className={o.color ? 'chip' : `chip cat-${o.category ?? 'none'}`}
                    style={o.color ? { background: o.color, color: textOn(o.color) } : undefined}
                    title={`${o.title}${o.assigneeName ? ` · ${o.assigneeName}` : ''}${o.location ? ` @ ${o.location}` : ''}`}
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
