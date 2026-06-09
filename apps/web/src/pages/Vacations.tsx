import { useCallback, useEffect, useState } from 'react';
import { listGroups, listVacations } from '../lib/api';
import type { GroupSummary, VacationSummary } from '../lib/types';
import { VacationDetail } from '../components/VacationDetail';
import { VacationModal } from '../components/VacationModal';

export function Vacations({ onActiveGroup }: { onActiveGroup?: (groupId: string) => void }) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [vacations, setVacations] = useState<VacationSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [includePast, setIncludePast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (gid: string, past: boolean) => {
      listVacations(gid, past)
        .then(setVacations)
        .catch((e) => setError(String(e.message ?? e)));
    },
    [],
  );

  useEffect(() => {
    listGroups()
      .then((gs) => {
        setGroups(gs);
        setGroupId((g) => g ?? (gs[0]?.id ?? null));
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (groupId) load(groupId, includePast);
  }, [groupId, includePast, load]);

  // Keep the chat pane pointed at the trip's group.
  useEffect(() => {
    if (groupId) onActiveGroup?.(groupId);
  }, [groupId, onActiveGroup]);

  // Refetch the trip list when the chat assistant reports a change.
  useEffect(() => {
    const h = () => {
      if (groupId) load(groupId, includePast);
    };
    window.addEventListener('jarvis:refresh', h);
    return () => window.removeEventListener('jarvis:refresh', h);
  }, [groupId, includePast, load]);

  const group = groups.find((g) => g.id === groupId) ?? null;

  if (groups.length === 0) {
    return (
      <div className="vacations">
        {error && <p className="error">{error}</p>}
        <p className="empty">No groups yet. Add a group in the Admin tab first.</p>
      </div>
    );
  }

  if (selected && groupId) {
    return (
      <div className="vacations">
        <VacationDetail
          groupId={groupId}
          vacationId={selected}
          onBack={() => {
            setSelected(null);
            if (groupId) load(groupId, includePast);
          }}
        />
      </div>
    );
  }

  return (
    <div className="vacations">
      <div className="vac-toolbar">
        <h2>Vacations</h2>
        <div className="vac-actions">
          <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <label className="row vac-past">
            <input
              type="checkbox"
              checked={includePast}
              onChange={(e) => setIncludePast(e.target.checked)}
            />
            Past trips
          </label>
          <button className="primary" onClick={() => setCreating(true)}>
            + New trip
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {vacations.length === 0 ? (
        <p className="empty">No trips yet. Click “New trip” to plan one.</p>
      ) : (
        <div className="vac-grid">
          {vacations.map((v) => (
            <button
              key={v.id}
              className={v.coverImageUrl ? 'vac-card has-image' : 'vac-card'}
              onClick={() => setSelected(v.id)}
              style={
                v.coverImageUrl
                  ? {
                      backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.72) 100%), url("${v.coverImageUrl}")`,
                    }
                  : undefined
              }
            >
              <div className="vac-card-body">
                <div className="vac-card-title">{v.title}</div>
                <div className="vac-card-dates">{v.dateRangeLabel}</div>
                {v.destinations && (
                  <div className="vac-chips">
                    {v.destinations
                      .split(',')
                      .map((c) => c.trim())
                      .filter(Boolean)
                      .map((c) => (
                        <span key={c} className="chip cat-vacation">
                          {c}
                        </span>
                      ))}
                  </div>
                )}
                <div className="vac-card-foot">
                  {v.itemCount} item{v.itemCount === 1 ? '' : 's'}
                  {v.travelers.filter((t) => t.name).length > 0 &&
                    ` · ${v.travelers
                      .filter((t) => t.name)
                      .map((t) => t.name)
                      .join(', ')}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && group && groupId && (
        <VacationModal
          groupId={groupId}
          groupTimezone={group.timezone}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load(groupId, includePast);
          }}
        />
      )}
    </div>
  );
}
