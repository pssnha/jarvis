import { useState } from 'react';
import { addVacationItem, deleteVacationItem, updateVacationItem } from '../lib/api';
import type { ItineraryItem, VacationItemPayload, VacationItemType } from '../lib/types';

const TYPES: { value: VacationItemType; label: string }[] = [
  { value: 'activity', label: '🎟 Activity' },
  { value: 'flight', label: '✈️ Flight' },
  { value: 'hotel', label: '🏨 Hotel' },
  { value: 'transport', label: '🚗 Transport' },
  { value: 'meal', label: '🍽 Meal' },
  { value: 'note', label: '📝 Note' },
];
const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0d9488', '#db2777', '#64748b'];

interface Props {
  groupId: string;
  vacationId: string;
  initialDateKey: string;
  /** Present when editing. */
  existing?: ItineraryItem;
  onClose: () => void;
  onSaved: () => void;
}

/** Which fields each item type shows. */
function fieldsFor(type: VacationItemType) {
  const fromTo = type === 'flight' || type === 'transport';
  return {
    fromTo,
    provider: type !== 'note',
    number: type === 'flight' || type === 'transport',
    seat: type === 'flight' || type === 'hotel' || type === 'transport',
    location: type === 'hotel' || type === 'activity' || type === 'meal',
    phone: type !== 'note' && type !== 'activity',
    booking: type !== 'note',
    cost: type !== 'note',
    canAllDay: type === 'activity' || type === 'note' || type === 'meal',
  };
}

function timeLabels(type: VacationItemType): { start: string; end: string } {
  if (type === 'flight' || type === 'transport') return { start: 'Departure', end: 'Arrival' };
  if (type === 'hotel') return { start: 'Check-in', end: 'Check-out' };
  return { start: 'Start', end: 'End' };
}

function providerLabel(type: VacationItemType): string {
  if (type === 'flight') return 'Airline';
  if (type === 'hotel') return 'Hotel';
  if (type === 'transport') return 'Company';
  if (type === 'meal') return 'Restaurant';
  return 'Operator';
}

export function VacationItemModal({
  groupId,
  vacationId,
  initialDateKey,
  existing,
  onClose,
  onSaved,
}: Props) {
  const editing = Boolean(existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<VacationItemType>(existing?.type ?? 'activity');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [allDay, setAllDay] = useState(existing?.allDay ?? false);
  const [start, setStart] = useState(existing?.startLocal ?? `${initialDateKey}T09:00`);
  const [end, setEnd] = useState(existing?.endLocal ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [provider, setProvider] = useState(existing?.provider ?? '');
  const [number, setNumber] = useState(existing?.number ?? '');
  const [fromLabel, setFromLabel] = useState(existing?.fromLabel ?? '');
  const [toLabel, setToLabel] = useState(existing?.toLabel ?? '');
  const [seat, setSeat] = useState(existing?.seat ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [confirmation, setConfirmation] = useState(existing?.confirmation ?? '');
  const [cost, setCost] = useState(existing?.cost ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [color, setColor] = useState(existing?.color ?? '');

  const f = fieldsFor(type);
  const labels = timeLabels(type);

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

  async function save() {
    if (!title.trim() || !start) {
      setError('Title and start are required.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: VacationItemPayload = {
      type,
      title: title.trim(),
      startsAt: start,
      endsAt: end || null,
      allDay: f.canAllDay ? allDay : false,
      location: f.location ? location || null : null,
      provider: f.provider ? provider || null : null,
      number: f.number ? number || null : null,
      fromLabel: f.fromTo ? fromLabel || null : null,
      toLabel: f.fromTo ? toLabel || null : null,
      seat: f.seat ? seat || null : null,
      phone: f.phone ? phone || null : null,
      confirmation: f.booking ? confirmation || null : null,
      cost: f.cost ? cost || null : null,
      notes: notes || null,
      color: color || null,
    };
    try {
      if (editing && existing) await updateVacationItem(groupId, vacationId, existing.id, payload);
      else await addVacationItem(groupId, vacationId, payload);
      onSaved();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!confirm('Delete this item?')) return;
    setBusy(true);
    try {
      await deleteVacationItem(groupId, vacationId, existing.id);
      onSaved();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  const seatLabel = type === 'hotel' ? 'Room' : type === 'flight' ? 'Seat' : 'Seat / unit';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? 'Edit item' : 'Add to itinerary'}</h2>

        <div className="kind-toggle type-toggle">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={type === t.value ? 'kt on' : 'kt'}
              onClick={() => setType(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>

        {f.canAllDay && (
          <label className="row">
            <input type="checkbox" checked={allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
            All day
          </label>
        )}

        <div className="grid2">
          <label>
            {labels.start}
            <input
              type={allDay ? 'date' : 'datetime-local'}
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            {labels.end} <span className="muted">(optional)</span>
            <input
              type={allDay ? 'date' : 'datetime-local'}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>

        {f.fromTo && (
          <div className="grid2">
            <label>
              From
              <input value={fromLabel} onChange={(e) => setFromLabel(e.target.value)} placeholder="SFO" />
            </label>
            <label>
              To
              <input value={toLabel} onChange={(e) => setToLabel(e.target.value)} placeholder="LIS" />
            </label>
          </div>
        )}

        <div className="grid2">
          {f.provider && (
            <label>
              {providerLabel(type)}
              <input value={provider} onChange={(e) => setProvider(e.target.value)} />
            </label>
          )}
          {f.number && (
            <label>
              Number
              <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="TP1234" />
            </label>
          )}
        </div>

        {f.location && (
          <label>
            {type === 'hotel' ? 'Address' : 'Location'}
            <input value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
        )}

        <div className="grid2">
          {f.seat && (
            <label>
              {seatLabel}
              <input value={seat} onChange={(e) => setSeat(e.target.value)} />
            </label>
          )}
          {f.phone && (
            <label>
              Phone
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          )}
        </div>

        <div className="grid2">
          {f.booking && (
            <label>
              Confirmation
              <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="PNR / booking #" />
            </label>
          )}
          {f.cost && (
            <label>
              Cost
              <input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="€420" />
            </label>
          )}
        </div>

        <label>
          Notes <span className="muted">(optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>

        <label>
          Color
          <div className="swatches">
            <button
              type="button"
              className={color === '' ? 'swatch auto on' : 'swatch auto'}
              onClick={() => setColor('')}
              title="Default (by type)"
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
      </div>
    </div>
  );
}
