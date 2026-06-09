import { useEffect, useState } from 'react';
import {
  createVacation,
  deleteVacation,
  listGroupMembers,
  updateVacation,
} from '../lib/api';
import type { MemberLite, VacationDetail, VacationPayload } from '../lib/types';

interface Props {
  groupId: string;
  groupTimezone: string;
  /** Present when editing. */
  existing?: VacationDetail;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: () => void;
}

export function VacationModal({
  groupId,
  groupTimezone,
  existing,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const editing = Boolean(existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberLite[]>([]);

  const [title, setTitle] = useState(existing?.title ?? '');
  const [destinations, setDestinations] = useState(existing?.destinations ?? '');
  const [startDate, setStartDate] = useState(existing?.startDateLocal ?? '');
  const [endDate, setEndDate] = useState(existing?.endDateLocal ?? '');
  const [timezone, setTimezone] = useState(existing?.timezone ?? groupTimezone);
  const [description, setDescription] = useState(existing?.description ?? '');
  const [travelerIds, setTravelerIds] = useState<Set<string>>(
    new Set(existing?.travelers.map((t) => t.id) ?? []),
  );

  useEffect(() => {
    listGroupMembers(groupId).then(setMembers).catch(() => {});
  }, [groupId]);

  function toggleTraveler(id: string) {
    setTravelerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!title.trim() || !startDate || !endDate) {
      setError('Title, start and end dates are required.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload: VacationPayload = {
      title: title.trim(),
      destinations: destinations.trim() || null,
      startDate,
      endDate,
      timezone: timezone.trim() || null,
      description: description.trim() || null,
      travelerIds: [...travelerIds],
    };
    try {
      if (editing && existing) await updateVacation(groupId, existing.id, payload);
      else await createVacation(groupId, payload);
      onSaved();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!confirm('Delete this trip and its whole itinerary?')) return;
    setBusy(true);
    try {
      await deleteVacation(groupId, existing.id);
      onDeleted?.();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{editing ? 'Edit trip' : 'New trip'}</h2>

        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>

        <label>
          Cities <span className="muted">(comma-separated)</span>
          <input
            value={destinations}
            onChange={(e) => setDestinations(e.target.value)}
            placeholder="Lisbon, Porto"
          />
        </label>

        <div className="grid2">
          <label>
            Start date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            End date
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>

        <label>
          Timezone <span className="muted">(IANA, e.g. Asia/Kolkata)</span>
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </label>

        {members.filter((m) => m.name).length > 0 && (
          <label>
            Travelers
            <div className="traveler-list">
              {members
                .filter((m) => m.name)
                .map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={travelerIds.has(m.id) ? 'traveler on' : 'traveler'}
                    onClick={() => toggleTraveler(m.id)}
                  >
                    {m.name}
                  </button>
                ))}
            </div>
          </label>
        )}

        <label>
          Notes <span className="muted">(optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
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
