import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminMaintenanceCalendar, adminMaintenanceRuns } from '../lib/api';
import type { MaintenanceCell, MaintenanceRunRow, MaintenanceSchedule } from '../lib/types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY = 86_400_000;

const JOB_META: Record<string, { emoji: string; label: string }> = {
  email_poll: { emoji: '📧', label: 'Email poll' },
  daily_brief: { emoji: '📰', label: 'Daily brief' },
  health_check: { emoji: '🩺', label: 'Health check' },
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Maintenance job-run calendar (site admins). Cross-circle, UTC day buckets. */
export function Maintenance() {
  const today = new Date();
  const [anchor, setAnchor] = useState({ y: today.getUTCFullYear(), m: today.getUTCMonth() });
  const [cells, setCells] = useState<MaintenanceCell[]>([]);
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<{ date: string; job: string } | null>(null);
  const [runs, setRuns] = useState<MaintenanceRunRow[] | null>(null);

  const grid = useMemo(() => {
    const first = new Date(Date.UTC(anchor.y, anchor.m, 1));
    const start = new Date(first.getTime() - first.getUTCDay() * DAY);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * DAY));
  }, [anchor]);

  const load = useCallback(() => {
    const from = grid[0]!;
    const to = new Date(grid[41]!.getTime() + DAY);
    adminMaintenanceCalendar(from.toISOString(), to.toISOString())
      .then((r) => {
        setCells(r.cells);
        setSchedules(r.schedules);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [grid]);
  useEffect(load, [load]);

  // date -> job -> cell
  const byDay = useMemo(() => {
    const map = new Map<string, Map<string, MaintenanceCell>>();
    for (const c of cells) {
      if (!map.has(c.date)) map.set(c.date, new Map());
      map.get(c.date)!.set(c.job, c);
    }
    return map;
  }, [cells]);

  function openDetail(date: string, job: string) {
    setSel({ date, job });
    setRuns(null);
    const from = new Date(`${date}T00:00:00.000Z`);
    const to = new Date(from.getTime() + DAY);
    adminMaintenanceRuns(from.toISOString(), to.toISOString(), job)
      .then((r) => setRuns(r.runs))
      .catch((e) => setError(String(e.message ?? e)));
  }

  function shiftMonth(delta: number) {
    setSel(null);
    setAnchor((a) => {
      const m = a.m + delta;
      return { y: a.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  }

  const todayKey = ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));

  return (
    <div className="maintenance">
      <h2 className="maint-page-title">Maintenance Calendar</h2>
      <div className="cal-toolbar">
        <div className="cal-nav">
          <button onClick={() => shiftMonth(-1)} aria-label="Previous">‹</button>
          <button onClick={() => setAnchor({ y: today.getUTCFullYear(), m: today.getUTCMonth() })}>
            Today
          </button>
          <button onClick={() => shiftMonth(1)} aria-label="Next">›</button>
          <h2>
            {MONTHS[anchor.m]} {anchor.y}
          </h2>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="maint-sched">
        {schedules.map((s) => (
          <span key={s.job} className="sched-item">
            {JOB_META[s.job]?.emoji ?? '•'} {s.label} · <span className="muted">{s.cadence}</span>
          </span>
        ))}
      </div>

      <div className="cal-grid">
        {DOW.map((d) => (
          <div key={d} className="cal-dow">
            {d}
          </div>
        ))}
        {grid.map((cd) => {
          const key = ymd(cd);
          const jobs = byDay.get(key);
          const past = key < todayKey;
          return (
            <div
              key={key}
              className={
                'cal-cell' +
                (cd.getUTCMonth() === anchor.m ? '' : ' out') +
                (key === todayKey ? ' today' : '')
              }
            >
              <div className="cal-daynum">{cd.getUTCDate()}</div>
              <div className="maint-chips">
                {schedules.map((s) => {
                  const c = jobs?.get(s.job);
                  const status =
                    c && c.errors > 0
                      ? 'error'
                      : c && c.runs > 0
                        ? 'ok'
                        : past
                          ? 'missed'
                          : 'scheduled';
                  const title =
                    status === 'ok'
                      ? `${s.label}: ran ${c!.runs}×`
                      : status === 'error'
                        ? `${s.label}: ${c!.errors} error(s) of ${c!.runs} run(s)`
                        : status === 'missed'
                          ? `${s.label}: scheduled, no runs`
                          : `${s.label}: scheduled (${s.cadence})`;
                  return (
                    <button
                      key={s.job}
                      className={`mrun-chip ${status}`}
                      title={title}
                      onClick={() => openDetail(key, s.job)}
                    >
                      <span className="mc-emoji">{JOB_META[s.job]?.emoji ?? '•'}</span>
                      {c && c.runs > 0 && <span className="mc-count">{c.runs}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {sel && (
        <div className="maint-detail">
          <div className="maint-detail-head">
            <strong>
              {JOB_META[sel.job]?.emoji} {JOB_META[sel.job]?.label ?? sel.job} · {sel.date}
            </strong>
            <button className="btn-quiet sm" onClick={() => setSel(null)}>
              Close
            </button>
          </div>
          {runs === null ? (
            <p className="muted">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="muted">No runs.</p>
          ) : (
            <ul className="maint-runs">
              {runs.map((r, i) => (
                <li key={i} className={r.ok ? 'maint-run' : 'maint-run err'}>
                  <span className="mr-time">
                    {new Date(r.ranAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  {r.circle && <span className="mr-circle">{r.circle}</span>}
                  <span className="mr-summary">{r.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
