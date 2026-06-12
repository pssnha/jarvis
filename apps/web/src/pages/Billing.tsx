import { useCallback, useEffect, useState } from 'react';
import { adminBilling } from '../lib/api';
import type { BillingReport } from '../lib/types';

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

/** Per-circle LLM usage + estimated cost for a month (site + circle admins). */
export function Billing() {
  const today = new Date();
  const [anchor, setAnchor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [report, setReport] = useState<BillingReport | null>(null);
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

  function shift(delta: number) {
    setAnchor((a) => {
      const m = a.m + delta;
      return { y: a.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  }

  const circles = report?.circles ?? [];

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
