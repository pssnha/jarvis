import { useEffect, useState } from 'react';
import { adminApproveSignup, adminListSignups, adminRejectSignup } from '../lib/api';
import type { AdminSignup, SignupStatus } from '../lib/types';

const STATUS_LABEL: Record<SignupStatus, string> = {
  pending_review: 'Pending review',
  approved: 'Approved · setting up',
  completed: 'Completed',
  rejected: 'Rejected',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

/**
 * Site-admin review of self-service sign-ups. Approving emails the applicant a
 * link to finish setup; rejecting marks it declined. Deep-linkable via
 * #/signups/<id> (the link in the notification email).
 */
export function Signups({ itemId }: { itemId: string | null }) {
  const [rows, setRows] = useState<AdminSignup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setError(null);
    adminListSignups()
      .then(setRows)
      .catch((e) => setError((e as Error).message));
  }
  useEffect(load, []);

  async function act(id: string, action: 'approve' | 'reject') {
    setBusyId(id);
    setError(null);
    try {
      const updated =
        action === 'approve' ? await adminApproveSignup(id) : await adminRejectSignup(id);
      setRows((prev) => (prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (rows === null && !error) {
    return (
      <div className="admin">
        <p className="empty">Loading…</p>
      </div>
    );
  }

  // When deep-linked, surface the targeted application first.
  const ordered = rows
    ? [...rows].sort((a, b) => (a.id === itemId ? -1 : b.id === itemId ? 1 : 0))
    : [];

  return (
    <div className="admin">
      <h1 className="maint-page-title">Sign-ups</h1>
      {error && <p className="error">{error}</p>}
      {ordered.length === 0 && <p className="empty">No sign-ups yet.</p>}

      {ordered.map((s) => (
        <div
          key={s.id}
          className="admin-card"
          style={s.id === itemId ? { outline: '2px solid var(--accent)' } : undefined}
        >
          <div className="signup-head">
            <div>
              <h2>{s.circleName || `${s.name}'s circle`}</h2>
              <div className="muted">
                {s.name} · {s.email}
              </div>
            </div>
            <span className={`signup-status ${s.status}`}>{STATUS_LABEL[s.status]}</span>
          </div>

          <ul className="signup-facts">
            <li>
              <span>WhatsApp</span>
              <strong>{s.phoneMask}</strong>
            </li>
            <li>
              <span>Terms</span>
              <strong>
                v{s.termsVersion} · {fmtDate(s.termsAcceptedAt)}
              </strong>
            </li>
            <li>
              <span>Requested</span>
              <strong>{fmtDate(s.createdAt)}</strong>
            </li>
            {s.channel && (
              <li>
                <span>Channel</span>
                <strong>
                  {s.channel === 'telegram'
                    ? 'Telegram'
                    : `WhatsApp${s.waNumber ? ` · ${s.waNumber}` : ''}`}
                </strong>
              </li>
            )}
            {s.emailAddress && (
              <li>
                <span>Mailbox</span>
                <strong>{s.emailAddress}</strong>
              </li>
            )}
          </ul>

          {s.status === 'pending_review' && (
            <div className="modal-actions">
              <button
                className="primary"
                disabled={busyId === s.id}
                onClick={() => act(s.id, 'approve')}
              >
                {busyId === s.id ? 'Working…' : 'Approve'}
              </button>
              <button
                className="danger"
                disabled={busyId === s.id}
                onClick={() => act(s.id, 'reject')}
              >
                Reject
              </button>
            </div>
          )}
          {s.status === 'approved' && (
            <p className="muted signup-foot">
              Approved — the applicant has been emailed a link to connect WhatsApp and email.
            </p>
          )}
          {s.status === 'completed' && (
            <p className="muted signup-foot">Circle created. Find it under Circles.</p>
          )}
        </div>
      ))}
    </div>
  );
}
