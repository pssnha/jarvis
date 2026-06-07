import { useEffect, useState } from 'react';
import { createEvent, deleteEvent, getEvent, updateEvent } from '../lib/api';
import type { EventPayload, RecurrenceFreq, Weekday } from '../lib/types';

const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const FREQ_OPTIONS: { value: RecurrenceFreq | 'none'; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];
const CATEGORIES = ['', 'appointment', 'vacation', 'reminder', 'other'];

interface Props {
  groupId: string;
  eventId?: string | null;
  initialDateKey?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EventModal({ groupId, eventId, initialDateKey, onClose, onSaved }: Props) {
  const editing = Boolean(eventId);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(initialDateKey ? `${initialDateKey}T09:00` : '');
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [freq, setFreq] = useState<RecurrenceFreq | 'none'>('none');
  const [repeatEvery, setRepeatEvery] = useState(1);
  const [weekdays, setWeekdays] = useState<Set<Weekday>>(new Set());
  const [until, setUntil] = useState('');

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    getEvent(groupId, eventId)
      .then((ev) => {
        if (!active) return;
        setTitle(ev.title);
        setAllDay(ev.allDay);
        setStart(ev.startLocal);
        setEnd(ev.endLocal ?? '');
        setLocation(ev.location ?? '');
        setCategory(ev.category ?? '');
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
  }, [groupId, eventId]);

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

  async function save() {
    if (!title.trim() || !start) {
      setError('Title and start are required.');
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
      end: end || null,
      allDay,
      location: location || null,
      category: category || null,
      recurrence,
    };
    try {
      if (editing && eventId) await updateEvent(groupId, eventId, payload);
      else await createEvent(groupId, payload);
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
      await deleteEvent(groupId, eventId);
      onSaved();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? 'Edit event' : 'New event'}</h2>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <>
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>

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
              <label>
                End <span className="muted">(optional)</span>
                <input
                  type={allDay ? 'date' : 'datetime-local'}
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>

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
