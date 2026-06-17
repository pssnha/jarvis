import { useEffect, useState } from 'react';
import {
  checkConflicts,
  createEvent,
  deleteEvent,
  getEvent,
  listCircleMembers,
  updateEvent,
} from '../lib/api';
import type {
  Conflict,
  EventKind,
  EventPayload,
  MemberLite,
  RecurrenceFreq,
  Weekday,
} from '../lib/types';

const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const LEAD_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'At start time' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
];

/** Add one hour to a "yyyy-MM-ddTHH:mm" local string (for a default event end). */
function plusHour(local: string): string {
  const [d, t] = local.split('T');
  if (!d || !t) return local;
  const dt = new Date(`${d}T${t}:00`);
  dt.setHours(dt.getHours() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`;
}
const FREQ_OPTIONS: { value: RecurrenceFreq | 'none'; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];
const CATEGORIES = ['', 'appointment', 'vacation', 'reminder', 'other'];
const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0d9488', '#db2777', '#64748b'];

interface Props {
  circleId: string;
  eventId?: string | null;
  initialDateKey?: string;
  /** Where a *new* event lands: a group (shared) or a member (private). */
  target?: { groupId?: string | null; ownerMemberId?: string | null };
  /** The active calendar scope (for scoped conflict checks). */
  scope?: string;
  defaultAssigneeId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EventModal({
  circleId,
  eventId,
  initialDateKey,
  target,
  scope,
  defaultAssigneeId,
  onClose,
  onSaved,
}: Props) {
  const editing = Boolean(eventId);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Existing events open read-only; new events go straight to the form.
  const [mode, setMode] = useState<'view' | 'edit'>(editing ? 'view' : 'edit');

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<EventKind>('reminder');
  const [lead, setLead] = useState<number>(15);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(
    initialDateKey ? (initialDateKey.includes('T') ? initialDateKey : `${initialDateKey}T09:00`) : '',
  );
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId ?? '');
  const [color, setColor] = useState('');
  const [freq, setFreq] = useState<RecurrenceFreq | 'none'>('none');
  const [repeatEvery, setRepeatEvery] = useState(1);
  const [weekdays, setWeekdays] = useState<Set<Weekday>>(new Set());
  const [until, setUntil] = useState('');

  useEffect(() => {
    listCircleMembers(circleId).then(setMembers).catch(() => {});
  }, [circleId]);

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    getEvent(circleId, eventId)
      .then((ev) => {
        if (!active) return;
        setTitle(ev.title);
        setKind(ev.kind);
        setLead(ev.reminderLeadMinutes ?? 0);
        setAllDay(ev.allDay);
        setStart(ev.startLocal);
        setEnd(ev.endLocal ?? '');
        setLocation(ev.location ?? '');
        setCategory(ev.category ?? '');
        setAssigneeId(ev.assigneeId ?? '');
        setColor(ev.color ?? '');
        if (ev.recurrence) {
          setFreq(ev.recurrence.freq);
          setRepeatEvery(ev.recurrence.interval ?? 1);
          setWeekdays(new Set(ev.recurrence.byweekday ?? []));
          setUntil(ev.recurrence.until ?? '');
        }
      })
      .catch((e) => active && setError(String(e.message ?? e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [circleId, eventId]);

  // Live conflict check for hard-block events (reminders never conflict).
  useEffect(() => {
    if (kind !== 'event' || allDay || !start || !end) {
      setConflicts([]);
      return;
    }
    let active = true;
    const t = setTimeout(() => {
      checkConflicts(circleId, start, end, eventId ?? undefined, scope)
        .then((c) => active && setConflicts(c))
        .catch(() => active && setConflicts([]));
    }, 400);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [circleId, eventId, kind, allDay, start, end, scope]);

  function switchKind(next: EventKind) {
    setKind(next);
    // Events need an end; default to one hour after the start.
    if (next === 'event' && !allDay && start && !end) setEnd(plusHour(start));
  }

  function toggleAllDay(next: boolean) {
    setAllDay(next);
    if (next) {
      setStart((s) => s.slice(0, 10));
      setEnd((e) => e.slice(0, 10));
    } else {
      setStart((s) => (s.length === 10 ? `${s}T09:00` : s));
      setEnd((e) => (e.length === 10 ? `${e}T10:00` : e));
    }
  }

  function toggleWeekday(d: Weekday) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  // --- Read-only display helpers ---
  function fmtWhen(): string {
    if (!start) return '';
    const dateOpts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    const startD = new Date(start.length === 10 ? `${start}T00:00` : start);
    if (allDay) {
      const sd = startD.toLocaleDateString(undefined, dateOpts);
      if (end && end.slice(0, 10) !== start.slice(0, 10)) {
        const ed = new Date(`${end.slice(0, 10)}T00:00`).toLocaleDateString(undefined, dateOpts);
        return `${sd} – ${ed} · all day`;
      }
      return `${sd} · all day`;
    }
    const dateStr = startD.toLocaleDateString(undefined, dateOpts);
    const startT = startD.toLocaleTimeString(undefined, timeOpts);
    if (kind === 'event' && end) {
      const endD = new Date(end);
      return end.slice(0, 10) === start.slice(0, 10)
        ? `${dateStr} · ${startT} – ${endD.toLocaleTimeString(undefined, timeOpts)}`
        : `${dateStr} ${startT} – ${endD.toLocaleDateString(undefined, dateOpts)} ${endD.toLocaleTimeString(undefined, timeOpts)}`;
    }
    return `${dateStr} · ${startT}`;
  }

  function fmtRepeat(): string | null {
    if (freq === 'none') return null;
    const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[freq];
    let s = repeatEvery > 1 ? `Every ${repeatEvery} ${unit}s` : `Every ${unit}`;
    if (freq === 'weekly' && weekdays.size > 0) s += ` on ${[...weekdays].join(', ')}`;
    if (until) s += `, until ${until}`;
    return s;
  }

  const assigneeName = assigneeId ? (members.find((m) => m.id === assigneeId)?.name ?? null) : null;

  async function save() {
    if (!title.trim() || !start) {
      setError('Title and start are required.');
      return;
    }
    if (kind === 'event' && !allDay && !end) {
      setError('An end time is required for events.');
      return;
    }
    setBusy(true);
    setError(null);
    const recurrence =
      freq === 'none'
        ? null
        : {
            freq,
            interval: repeatEvery > 1 ? repeatEvery : undefined,
            byweekday: freq === 'weekly' && weekdays.size > 0 ? [...weekdays] : undefined,
            until: until || undefined,
          };
    const payload: EventPayload = {
      title: title.trim(),
      start,
      end: kind === 'event' ? end || null : null,
      allDay,
      location: location || null,
      category: category || null,
      assigneeId: assigneeId || null,
      color: color || null,
      kind,
      reminderLeadMinutes: kind === 'event' ? lead : null,
      recurrence,
    };
    try {
      if (editing && eventId) await updateEvent(circleId, eventId, payload);
      else await createEvent(circleId, { ...payload, ...target });
      onSaved();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!eventId) return;
    if (!confirm('Delete this event' + (freq !== 'none' ? ' and its whole series' : '') + '?'))
      return;
    setBusy(true);
    try {
      await deleteEvent(circleId, eventId);
      onSaved();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{!editing ? 'New event' : mode === 'edit' ? 'Edit event' : title || 'Event'}</h2>
        {loading ? (
          <p>Loading…</p>
        ) : mode === 'view' ? (
          <>
            <div className="event-view">
              <span className={kind === 'event' ? 'badge admin' : 'badge member'}>
                {kind === 'event' ? '📅 Event' : '🔔 Reminder'}
              </span>
              <div className="ev-row">
                <span className="ev-k">When</span>
                <span>{fmtWhen()}</span>
              </div>
              {location && (
                <div className="ev-row">
                  <span className="ev-k">Location</span>
                  <span>{location}</span>
                </div>
              )}
              {category && (
                <div className="ev-row">
                  <span className="ev-k">Category</span>
                  <span>{category}</span>
                </div>
              )}
              <div className="ev-row">
                <span className="ev-k">For</span>
                <span>{assigneeName ?? 'Whole group'}</span>
              </div>
              {kind === 'event' && !allDay && (
                <div className="ev-row">
                  <span className="ev-k">Remind</span>
                  <span>{LEAD_OPTIONS.find((o) => o.value === lead)?.label ?? `${lead} min before`}</span>
                </div>
              )}
              {fmtRepeat() && (
                <div className="ev-row">
                  <span className="ev-k">Repeat</span>
                  <span>{fmtRepeat()}</span>
                </div>
              )}
            </div>

            {error && <p className="error">{error}</p>}

            <div className="modal-actions">
              <button className="danger" onClick={remove} disabled={busy}>
                Delete
              </button>
              <span style={{ flex: 1 }} />
              <button onClick={onClose} disabled={busy}>
                Close
              </button>
              <button className="primary" onClick={() => setMode('edit')} disabled={busy}>
                Edit
              </button>
            </div>
          </>
        ) : (
          <>
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>

            <div className="kind-toggle">
              <button
                type="button"
                className={kind === 'reminder' ? 'kt on' : 'kt'}
                onClick={() => switchKind('reminder')}
              >
                🔔 Reminder
              </button>
              <button
                type="button"
                className={kind === 'event' ? 'kt on' : 'kt'}
                onClick={() => switchKind('event')}
              >
                📅 Event
              </button>
            </div>
            <p className="muted kind-help">
              {kind === 'reminder'
                ? 'A simple nudge — shows as a 30-min “available” slot and never blocks the calendar.'
                : 'A hard block on the calendar. Needs an end time and warns if it overlaps another event.'}
            </p>

            <label className="row">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => toggleAllDay(e.target.checked)}
              />
              All day
            </label>

            <div className="grid2">
              <label>
                Start
                <input
                  type={allDay ? 'date' : 'datetime-local'}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              {kind === 'event' && (
                <label>
                  End{allDay && <span className="muted"> (optional)</span>}
                  <input
                    type={allDay ? 'date' : 'datetime-local'}
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
              )}
            </div>

            {kind === 'event' && !allDay && (
              <label>
                Remind me
                <select value={lead} onChange={(e) => setLead(Number(e.target.value))}>
                  {LEAD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {kind === 'event' && conflicts.length > 0 && (
              <div className="conflict-warn">
                ⚠️ Overlaps{' '}
                {conflicts.length === 1 ? 'an existing event' : `${conflicts.length} existing events`}:
                <ul>
                  {conflicts.map((c) => (
                    <li key={c.eventId}>
                      {c.title} · {c.timeLabel}
                    </li>
                  ))}
                </ul>
                You can still save.
              </div>
            )}

            <div className="grid2">
              <label>
                Location <span className="muted">(optional)</span>
                <input value={location} onChange={(e) => setLocation(e.target.value)} />
              </label>
              <label>
                Category
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c || '—'}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              Color
              <div className="swatches">
                <button
                  type="button"
                  className={color === '' ? 'swatch auto on' : 'swatch auto'}
                  onClick={() => setColor('')}
                  title="Default (by category)"
                >
                  Auto
                </button>
                {COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={color === c ? 'swatch on' : 'swatch'}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={c}
                  />
                ))}
              </div>
            </label>

            <label>
              For
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Whole group</option>
                {members
                  .filter((m) => m.name)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Repeat
              <select value={freq} onChange={(e) => setFreq(e.target.value as RecurrenceFreq | 'none')}>
                {FREQ_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {freq !== 'none' && (
              <div className="recurrence">
                <label className="row">
                  Every
                  <input
                    type="number"
                    min={1}
                    value={repeatEvery}
                    onChange={(e) => setRepeatEvery(Math.max(1, Number(e.target.value)))}
                    style={{ width: 64 }}
                  />
                  {freq === 'daily' && 'day(s)'}
                  {freq === 'weekly' && 'week(s)'}
                  {freq === 'monthly' && 'month(s)'}
                  {freq === 'yearly' && 'year(s)'}
                </label>

                {freq === 'weekly' && (
                  <div className="weekdays">
                    {WEEKDAYS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={weekdays.has(d) ? 'wd on' : 'wd'}
                        onClick={() => toggleWeekday(d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}

                <label>
                  Until <span className="muted">(optional)</span>
                  <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                </label>
              </div>
            )}

            {error && <p className="error">{error}</p>}

            <div className="modal-actions">
              {editing && (
                <button className="danger" onClick={remove} disabled={busy}>
                  Delete
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="primary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
