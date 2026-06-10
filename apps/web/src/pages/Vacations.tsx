import { useCallback, useEffect, useState } from 'react';
import { listCircles, listVacations } from '../lib/api';
import type { Circle, VacationSummary } from '../lib/types';
import { VacationDetail } from '../components/VacationDetail';
import { VacationModal } from '../components/VacationModal';
import { CircleTitle } from '../components/CircleTitle';

export function Vacations({
  onActive,
  itemId,
  onOpen,
  onBack,
}: {
  onActive?: (a: { circleId: string; scope?: string }) => void;
  itemId: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [circleId, setCircleId] = useState<string | null>(null);
  const [vacations, setVacations] = useState<VacationSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [includePast, setIncludePast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((cid: string, past: boolean) => {
    listVacations(cid, past)
      .then(setVacations)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    listCircles()
      .then((cs) => {
        setCircles(cs);
        setCircleId((c) => c ?? cs[0]?.id ?? null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (circleId) load(circleId, includePast);
  }, [circleId, includePast, load]);

  // Keep the chat pane pointed at this circle (vacation/circle scope).
  useEffect(() => {
    if (circleId) onActive?.({ circleId });
  }, [circleId, onActive]);

  // Refetch the trip list when the chat assistant reports a change.
  useEffect(() => {
    const h = () => {
      if (circleId) load(circleId, includePast);
    };
    window.addEventListener('jarvis:refresh', h);
    return () => window.removeEventListener('jarvis:refresh', h);
  }, [circleId, includePast, load]);

  const circle = circles.find((c) => c.id === circleId) ?? null;

  if (circles.length === 0) {
    return (
      <div className="vacations">
        {error && <p className="error">{error}</p>}
        <p className="empty">No circles yet. Create a circle in the Admin tab first.</p>
      </div>
    );
  }

  if (itemId && circleId) {
    return (
      <div className="vacations">
        <VacationDetail
          circleId={circleId}
          vacationId={itemId}
          onBack={() => {
            onBack();
            load(circleId, includePast);
          }}
        />
      </div>
    );
  }

  return (
    <div className="vacations">
      <div className="vac-toolbar">
        <CircleTitle
          label="Vacations"
          circles={circles}
          circleId={circleId}
          onChange={setCircleId}
        />
        <div className="vac-actions">
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
              onClick={() => onOpen(v.id)}
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

      {creating && circle && circleId && (
        <VacationModal
          circleId={circleId}
          circleTimezone={circle.timezone}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load(circleId, includePast);
          }}
        />
      )}
    </div>
  );
}
