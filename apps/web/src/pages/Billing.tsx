import { useCallback, useEffect, useState } from 'react';
import { adminBilling, adminBillingLimits, adminSetCircleLimits } from '../lib/api';
import type { BillingLimits, BillingReport } from '../lib/types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function fmtCost(n: number): string {
  return '$' + (n >= 1 ? n.toFixed(2) : n.toFixed(4));
}
function fmtNum(n: number): string {
  return n.toLocaleString();
}

/** Per-circle LLM usage + estimated cost for a month, plus spend caps (site + circle admins). */
export function Billing() {
  const today = new Date();
  const [anchor, setAnchor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [report, setReport] = useState<BillingReport | null>(null);
  const [limits, setLimits] = useState<BillingLimits | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((y: number, m: number) => {
    setError(null);
    adminBilling(`${y}-${String(m + 1).padStart(2, '0')}`)
      .then(setReport)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    load(anchor.y, anchor.m);
  }, [anchor, load]);

  useEffect(() => {
    adminBillingLimits()
      .then(setLimits)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  function shift(delta: number) {
    setAnchor((a) => {
      const m = a.m + delta;
      return { y: a.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  }

  function editLimit(circleId: string, field: 'dailyUsdLimit' | 'monthlyUsdLimit', value: number) {
    setLimits((l) =>
      l
        ? { ...l, circles: l.circles.map((c) => (c.circleId === circleId ? { ...c, [field]: value } : c)) }
        : l,
    );
  }

  async function saveLimit(circleId: string) {
    const row = limits?.circles.find((c) => c.circleId === circleId);
    if (!row) return;
    setSavingId(circleId);
    setError(null);
    try {
      await adminSetCircleLimits(circleId, row.dailyUsdLimit, row.monthlyUsdLimit);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSavingId(null);
    }
  }

  const circles = report?.circles ?? [];
  const canEdit = limits?.canEdit ?? false;

  return (
    <div className="billing">
      <div className="vac-toolbar">
        <h2 className="page-title">Billing</h2>
        <div className="cal-nav">
          <button onClick={() => shift(-1)} aria-label="Previous">‹</button>
          <button onClick={() => setAnchor({ y: today.getFullYear(), m: today.getMonth() })}>
            This month
          </button>
          <button onClick={() => shift(1)} aria-label="Next">›</button>
          <span className="bill-month">
            {MONTHS[anchor.m]} {anchor.y}
          </span>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {limits && limits.circles.length > 0 && (
        <div className="bill-limits">
          <h3 className="bill-section">Limits</h3>
          <table className="bill-table">
            <thead>
              <tr>
                <th>Circle</th>
                <th>Today</th>
                <th>Month</th>
                <th>Daily</th>
                <th>Monthly</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {limits.circles.map((c) => (
                <tr key={c.circleId}>
                  <td>{c.circleName}</td>
                  <td>{fmtCost(c.todayUsd)} / {fmtCost(c.dailyUsdLimit)}</td>
                  <td>{fmtCost(c.monthUsd)} / {fmtCost(c.monthlyUsdLimit)}</td>
                  <td>
                    <input
                      type="number"
                      className="lim-input"
                      min={limits.ranges.dailyMin}
                      max={limits.ranges.dailyMax}
                      step={0.25}
                      value={c.dailyUsdLimit}
                      disabled={!canEdit}
                      onChange={(e) => editLimit(c.circleId, 'dailyUsdLimit', Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="lim-input"
                      min={limits.ranges.monthlyMin}
                      max={limits.ranges.monthlyMax}
                      step={5}
                      value={c.monthlyUsdLimit}
                      disabled={!canEdit}
                      onChange={(e) => editLimit(c.circleId, 'monthlyUsdLimit', Number(e.target.value))}
                    />
                  </td>
                  {canEdit && (
                    <td>
                      <button onClick={() => saveLimit(c.circleId)} disabled={savingId === c.circleId}>
                        {savingId === c.circleId ? 'Saving…' : 'Save'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {circles.length === 0 ? (
        <p className="empty">No usage this month.</p>
      ) : (
        <div className="bill-list">
          {circles.map((c) => (
            <div key={c.circleId} className="bill-circle">
              <div className="bill-circle-head">
                <span className="bill-circle-name">{c.circleName}</span>
                <span className="bill-circle-cost">{fmtCost(c.costUsd)}</span>
              </div>
              <table className="bill-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Calls</th>
                    <th>Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {c.models.map((m) => (
                    <tr key={m.model}>
                      <td>{m.model}</td>
                      <td>{fmtNum(m.inputTokens)}</td>
                      <td>{fmtNum(m.outputTokens)}</td>
                      <td>{fmtNum(m.calls)}</td>
                      <td>{fmtCost(m.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {report && circles.length > 1 && (
            <div className="bill-grand">
              <span>Total</span>
              <span>{fmtCost(report.totalCostUsd)}</span>
            </div>
          )}
          <p className="muted bill-note">Estimated from list prices.</p>
        </div>
      )}
    </div>
  );
}
