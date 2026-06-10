import { useCallback, useEffect, useState } from 'react';
import {
  adminAddCircleMember,
  adminAddGroupMember,
  adminAddUser,
  adminCircleWhatsAppStatus,
  adminCreateCircle,
  adminDeleteCircle,
  adminDeleteCircleEmail,
  adminDeleteCircleMember,
  adminDeleteCircleCover,
  adminDeleteUser,
  adminImportSchedule,
  adminListCircles,
  adminListUsers,
  adminRemoveGroupMember,
  adminSetCircleCover,
  adminSetCircleEmail,
  adminSetCircleJob,
  adminSetMemberRole,
  adminSetUserWhatsApp,
  adminStartCircleWhatsApp,
} from '../lib/api';
import type {
  AdminCircle,
  AdminCircleGroup,
  AdminUser,
  CircleMemberRole,
  MaintenanceJob,
  WhatsAppStatus,
} from '../lib/types';

const JOBS: { id: MaintenanceJob; label: string }[] = [
  { id: 'email_poll', label: 'Email polling' },
  { id: 'daily_brief', label: 'Daily brief' },
  { id: 'health_check', label: 'Health check' },
];

/** Permissions page — manage who can sign in to the site. Site admins only. */
export function Permissions() {
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(String((e as Error).message ?? e));
  return (
    <div className="admin">
      {error && <p className="error">{error}</p>}
      <UsersSection onError={fail} />
    </div>
  );
}

/** Circles page — a card grid (like Vacations); click a card to manage a circle. */
export function Circles({ siteAdmin }: { siteAdmin: boolean }) {
  const [circles, setCircles] = useState<AdminCircle[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [tz, setTz] = useState('America/Los_Angeles');
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(String((e as Error).message ?? e));

  const load = useCallback(() => {
    adminListCircles().then(setCircles).catch(onError);
  }, []);
  useEffect(load, [load]);

  async function create() {
    if (!name.trim()) return;
    try {
      await adminCreateCircle(name.trim(), tz.trim() || 'UTC');
      setName('');
      setCreating(false);
      load();
    } catch (e) {
      onError(e);
    }
  }

  const current = circles.find((c) => c.id === selected) ?? null;

  if (current) {
    return (
      <div className="admin">
        {error && <p className="error">{error}</p>}
        <button className="link" onClick={() => setSelected(null)}>
          ← All circles
        </button>
        <section className="admin-card">
          <h2>{current.name}</h2>
          <CircleDetail
            circle={current}
            siteAdmin={siteAdmin}
            onError={onError}
            onChanged={load}
            onRemove={async () => {
              if (
                !confirm(
                  `Delete circle "${current.name}"? This removes its ${current.groups.length} group(s), ` +
                    `${current.members.length} member(s), ${current.counts.events} event(s) and ${current.counts.vacations} trip(s).`,
                )
              )
                return;
              try {
                await adminDeleteCircle(current.id);
                setSelected(null);
                load();
              } catch (e) {
                onError(e);
              }
            }}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="vacations">
      <div className="vac-toolbar">
        <h2>Circles</h2>
        <div className="vac-actions">
          {siteAdmin && (
            <button className="primary" onClick={() => setCreating(true)}>
              + New circle
            </button>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {circles.length === 0 ? (
        <p className="empty">
          {siteAdmin
            ? 'No circles yet. Click “New circle” to create one.'
            : 'You don’t administer any circles yet.'}
        </p>
      ) : (
        <div className="vac-grid">
          {circles.map((c) => (
            <button
              key={c.id}
              className={c.coverImageUrl ? 'vac-card has-image' : 'vac-card'}
              onClick={() => setSelected(c.id)}
              style={
                c.coverImageUrl
                  ? {
                      backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.72) 100%), url("${c.coverImageUrl}")`,
                    }
                  : undefined
              }
            >
              <div className="vac-card-body">
                <div className="vac-card-title">{c.name}</div>
                <div className="vac-card-dates">{c.timezone}</div>
                <div className="vac-card-foot">
                  {c.members.length} member{c.members.length === 1 ? '' : 's'} · {c.groups.length} group
                  {c.groups.length === 1 ? '' : 's'} · {c.counts.events} event
                  {c.counts.events === 1 ? '' : 's'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New circle</h2>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label>
              Timezone <span className="muted">(IANA)</span>
              <input value={tz} onChange={(e) => setTz(e.target.value)} />
            </label>
            <div className="modal-actions">
              <span style={{ flex: 1 }} />
              <button onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary" onClick={create}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CircleWhatsApp({ circle, onError }: { circle: AdminCircle; onError: (e: unknown) => void }) {
  const [wa, setWa] = useState<WhatsAppStatus | null>(null);

  const load = useCallback(() => {
    adminCircleWhatsAppStatus(circle.id).then(setWa).catch(() => {});
  }, [circle.id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const status = wa?.status ?? 'offline';
  async function relink() {
    try {
      await adminStartCircleWhatsApp(circle.id);
    } catch (e) {
      onError(e);
    }
  }

  return (
    <div className="subsec">
      <h4>WhatsApp connection</h4>
      <p className="muted">
        This circle's own Jarvis number. Every WhatsApp group it is in becomes a group above
        automatically.
      </p>
      {status === 'open' ? (
        <p>
          <span className="badge admin">Connected</span> linked as{' '}
          <strong>{wa?.self ?? 'device'}</strong> · {wa?.groups.length ?? 0} group(s) visible
        </p>
      ) : status === 'qr' && wa?.qr ? (
        <div className="wa-qr">
          <p className="muted">
            Open WhatsApp on the circle's phone →{' '}
            <strong>Settings → Linked Devices → Link a Device</strong> → scan this code:
          </p>
          <img src={wa.qr} alt="WhatsApp QR code" width={220} height={220} />
        </div>
      ) : (
        <p className="muted">
          Status: <strong>{status}</strong>
          {status === 'connecting' && ' — connecting…'}
          {status === 'offline' && ' — no session yet.'}
          {status === 'logged_out' && ' — device was unlinked.'}{' '}
          <button className="link" onClick={relink}>
            {status === 'offline' || status === 'logged_out' ? 'start / get QR' : 'restart'}
          </button>
        </p>
      )}
    </div>
  );
}

function UsersSection({ onError }: { onError: (e: unknown) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');

  const load = useCallback(() => {
    adminListUsers().then(setUsers).catch(onError);
  }, [onError]);
  useEffect(load, [load]);

  async function add() {
    if (!email.trim()) return;
    try {
      await adminAddUser(email.trim(), role);
      setEmail('');
      load();
    } catch (e) {
      onError(e);
    }
  }
  async function remove(id: string) {
    if (!confirm('Remove this user?')) return;
    try {
      await adminDeleteUser(id);
      load();
    } catch (e) {
      onError(e);
    }
  }

  return (
    <section className="admin-card">
      <h2>Site members</h2>
      <p className="muted">People allowed to sign in (via Google).</p>
      <ul className="admin-list">
        {users.map((u) => (
          <UserRow key={u.id} user={u} onError={onError} onChanged={load} onRemove={remove} />
        ))}
      </ul>
      <div className="admin-form">
        <input
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button className="primary" onClick={add}>
          Add
        </button>
      </div>
    </section>
  );
}

function UserRow({
  user,
  onError,
  onChanged,
  onRemove,
}: {
  user: AdminUser;
  onError: (e: unknown) => void;
  onChanged: () => void;
  onRemove: (id: string) => void;
}) {
  const [num, setNum] = useState('');
  const [editing, setEditing] = useState(false);

  async function save() {
    try {
      await adminSetUserWhatsApp(user.id, num.trim());
      setEditing(false);
      setNum('');
      onChanged();
    } catch (e) {
      onError(e);
    }
  }

  return (
    <li>
      <span>
        {user.email} <span className={`badge ${user.role}`}>{user.role}</span>
        {user.waId && <span className="muted"> · 📱 {user.waId}</span>}
        {user.role === 'admin' &&
          (editing ? (
            <span className="wa-set">
              <input
                placeholder="WhatsApp number"
                value={num}
                onChange={(e) => setNum(e.target.value)}
              />
              <button className="link" onClick={save}>
                save
              </button>
              <button className="link" onClick={() => setEditing(false)}>
                cancel
              </button>
            </span>
          ) : (
            <button className="link" onClick={() => setEditing(true)}>
              {user.waId ? 'change #' : 'set WhatsApp #'}
            </button>
          ))}
      </span>
      <button className="link-danger" onClick={() => onRemove(user.id)}>
        remove
      </button>
    </li>
  );
}

function CircleDetail({
  circle,
  siteAdmin,
  onError,
  onChanged,
  onRemove,
}: {
  circle: AdminCircle;
  siteAdmin: boolean;
  onError: (e: unknown) => void;
  onChanged: () => void;
  onRemove: () => void;
}) {
  const [tab, setTab] = useState<'connections' | 'members' | 'settings'>('connections');
  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'connections', label: 'Connections' },
    { id: 'members', label: 'Members' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="circle-detail">
      <div className="seg" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'connections' && (
        <ConnectionsPane circle={circle} onError={onError} onChanged={onChanged} />
      )}
      {tab === 'members' && (
        <MembersPane circle={circle} siteAdmin={siteAdmin} onError={onError} onChanged={onChanged} />
      )}
      {tab === 'settings' && (
        <SettingsPane
          circle={circle}
          siteAdmin={siteAdmin}
          onError={onError}
          onChanged={onChanged}
          onRemove={onRemove}
        />
      )}
    </div>
  );
}

/** Pane 1 — how the circle reaches the outside: WhatsApp number, its groups, email. */
function ConnectionsPane({
  circle,
  onError,
  onChanged,
}: {
  circle: AdminCircle;
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  return (
    <div className="pane">
      <CircleWhatsApp circle={circle} onError={onError} />

      <div className="subsec">
        <h4>Groups</h4>
        <p className="muted">
          WhatsApp groups this number is in. Toggle which members belong to each group.
        </p>
        {circle.groups.length === 0 ? (
          <p className="muted">No groups yet — add Jarvis to a WhatsApp group.</p>
        ) : (
          circle.groups.map((g) => (
            <GroupBlock key={g.id} circle={circle} group={g} onError={onError} onChanged={onChanged} />
          ))
        )}
      </div>

      <EmailPollingSection circle={circle} onError={onError} onChanged={onChanged} />
    </div>
  );
}

/** Pane 2 — the roster: each member with a Member / Circle-admin role. */
function MembersPane({
  circle,
  siteAdmin,
  onError,
  onChanged,
}: {
  circle: AdminCircle;
  siteAdmin: boolean;
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  const [mName, setMName] = useState('');
  const [mEmail, setMEmail] = useState('');
  const [mWa, setMWa] = useState('');

  async function addMember() {
    if (!mName && !mEmail && !mWa) return;
    try {
      await adminAddCircleMember(circle.id, { name: mName, email: mEmail, waId: mWa });
      setMName('');
      setMEmail('');
      setMWa('');
      onChanged();
    } catch (e) {
      onError(e);
    }
  }
  async function removeMember(id: string) {
    if (!confirm('Remove this member from the circle?')) return;
    try {
      await adminDeleteCircleMember(circle.id, id);
      onChanged();
    } catch (e) {
      onError(e);
    }
  }
  async function setRole(m: AdminCircle['members'][number], role: CircleMemberRole) {
    if (
      role === 'circle_admin' &&
      !confirm(
        `Make ${m.name ?? m.email} a circle admin? They'll be able to sign in and manage this circle.`,
      )
    )
      return;
    try {
      await adminSetMemberRole(circle.id, m.id, role);
      onChanged();
    } catch (e) {
      onError(e);
    }
  }

  return (
    <div className="pane">
      <div className="subsec">
        <h4>Members</h4>
        <p className="muted">
          People in this circle, matched by WhatsApp number and/or email. Circle admins can manage
          this circle (but not site Permissions).
        </p>
        <ul className="member-list">
          {circle.members.length === 0 && <li className="member-row muted">No members yet.</li>}
          {circle.members.map((m) => (
            <li key={m.id} className="member-row">
              <div className="member-id">
                <span className="member-name">{m.name ?? '—'}</span>
                <span className="member-sub">
                  {[m.email, m.waId].filter(Boolean).join('  ·  ') || 'no contact info'}
                </span>
              </div>
              <div className="member-actions">
                {siteAdmin ? (
                  <select
                    className="role-select"
                    value={m.role}
                    disabled={m.role === 'member' && !m.email}
                    title={!m.email ? 'Add an email to allow circle-admin' : undefined}
                    onChange={(e) => setRole(m, e.target.value as CircleMemberRole)}
                  >
                    <option value="member">Member</option>
                    <option value="circle_admin" disabled={!m.email}>
                      Circle admin
                    </option>
                  </select>
                ) : (
                  <span className={m.role === 'circle_admin' ? 'role-badge admin' : 'role-badge'}>
                    {m.role === 'circle_admin' ? 'Circle admin' : 'Member'}
                  </span>
                )}
                <button className="link-danger" onClick={() => removeMember(m.id)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="admin-form">
          <input placeholder="name" value={mName} onChange={(e) => setMName(e.target.value)} />
          <input placeholder="email" value={mEmail} onChange={(e) => setMEmail(e.target.value)} />
          <input placeholder="WhatsApp number" value={mWa} onChange={(e) => setMWa(e.target.value)} />
          <button className="primary" onClick={addMember}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

/** Pane 3 — circle settings: maintenance jobs, background image, delete. */
function SettingsPane({
  circle,
  siteAdmin,
  onError,
  onChanged,
  onRemove,
}: {
  circle: AdminCircle;
  siteAdmin: boolean;
  onError: (e: unknown) => void;
  onChanged: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="pane">
      <JobsSection circle={circle} onError={onError} onChanged={onChanged} />
      <CoverImageSection circle={circle} onError={onError} onChanged={onChanged} />
      {siteAdmin && (
        <div className="subsec danger-zone">
          <h4>Danger zone</h4>
          <p className="muted">Permanently delete this circle and everything in it.</p>
          <button className="btn-danger" onClick={onRemove}>
            Delete circle
          </button>
        </div>
      )}
    </div>
  );
}

function CoverImageSection({
  circle,
  onError,
  onChanged,
}: {
  circle: AdminCircle;
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      await adminSetCircleCover(circle.id, file);
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await adminDeleteCircleCover(circle.id);
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="subsec">
      <h4>Background image</h4>
      <p className="muted">Shown on the circle’s card. JPG/PNG, up to 3 MB.</p>
      {circle.coverImageUrl && (
        <div
          className="cover-preview"
          style={{ backgroundImage: `url("${circle.coverImageUrl}")` }}
        />
      )}
      <div className="admin-form">
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
        {circle.coverImageUrl && (
          <button className="link-danger" onClick={remove} disabled={busy}>
            remove
          </button>
        )}
      </div>
    </div>
  );
}

function GroupBlock({
  circle,
  group,
  onError,
  onChanged,
}: {
  circle: AdminCircle;
  group: AdminCircleGroup;
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const inGroup = new Set(group.memberIds);

  async function toggle(memberId: string, on: boolean) {
    try {
      if (on) await adminAddGroupMember(circle.id, group.id, memberId);
      else await adminRemoveGroupMember(circle.id, group.id, memberId);
      onChanged();
    } catch (e) {
      onError(e);
    }
  }
  async function doImport() {
    if (!importFile) return;
    setImportBusy(true);
    setImportMsg(null);
    try {
      const r = await adminImportSchedule(circle.id, group.id, importFile);
      const errs = r.errors.length ? ` · ${r.errors.length} issue(s)` : '';
      setImportMsg(
        `Imported ${r.created} event(s)${r.skipped ? `, skipped ${r.skipped}` : ''}${errs}.`,
      );
      setImportFile(null);
      onChanged();
    } catch (e) {
      setImportMsg(`Failed: ${(e as Error).message}`);
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="group-block">
      <div className="group-block-head">
        <strong>{group.name}</strong>{' '}
        {group.whatsappGroupId ? (
          <span className="badge admin">WhatsApp</span>
        ) : (
          <span className="badge member">manual</span>
        )}{' '}
        <a className="ical-link" href={`/api/calendar/${group.icalToken}.ics`} title="Subscribe">
          iCal
        </a>
      </div>
      <div className="traveler-list">
        {circle.members
          .filter((m) => m.name)
          .map((m) => (
            <button
              key={m.id}
              type="button"
              className={inGroup.has(m.id) ? 'traveler on' : 'traveler'}
              onClick={() => toggle(m.id, !inGroup.has(m.id))}
            >
              {m.name}
            </button>
          ))}
      </div>
      <div className="admin-form">
        <input
          type="file"
          accept=".ics,.json,text/calendar,application/json"
          onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
        />
        <button className="primary" onClick={doImport} disabled={!importFile || importBusy}>
          {importBusy ? 'Importing…' : 'Import'}
        </button>
      </div>
      {importMsg && <p className="muted">{importMsg}</p>}
    </div>
  );
}

function EmailPollingSection({
  circle,
  onError,
  onChanged,
}: {
  circle: AdminCircle;
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  const cfg = circle.email;
  const [address, setAddress] = useState(cfg.address ?? '');
  const [host, setHost] = useState(cfg.host ?? 'imap.gmail.com');
  const [port, setPort] = useState(String(cfg.port ?? 993));
  const [credential, setCredential] = useState('');
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    if (!address.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await adminSetCircleEmail(circle.id, {
        address: address.trim(),
        credential: credential || undefined,
        host: host.trim(),
        port: Number(port) || 993,
        enabled,
      });
      setCredential('');
      setMsg('Saved.');
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm('Remove email polling for this circle?')) return;
    setBusy(true);
    try {
      await adminDeleteCircleEmail(circle.id);
      setAddress('');
      setCredential('');
      setEnabled(true);
      setMsg(null);
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="subsec">
      <h4>Email polling</h4>
      <p className="muted">
        A dedicated mailbox Jarvis polls. New mail is classified and confirmed in the owner's DM before
        anything is added. Use an IMAP <strong>app-password</strong>.
      </p>
      <div className="admin-form">
        <input
          placeholder="jarvis-family@gmail.com"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <input placeholder="IMAP host" value={host} onChange={(e) => setHost(e.target.value)} />
        <input
          placeholder="port"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          style={{ maxWidth: 80 }}
        />
        <input
          type="password"
          placeholder={cfg.hasCredential ? 'app-password (saved)' : 'app-password'}
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
        />
        <label className="row" style={{ gap: '0.3rem' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        <button className="primary" onClick={save} disabled={busy}>
          Save
        </button>
        {cfg.address && (
          <button className="link-danger" onClick={remove} disabled={busy}>
            remove
          </button>
        )}
      </div>
      {(msg || cfg.address) && (
        <p className="muted">
          {msg && `${msg} `}
          {cfg.address &&
            (cfg.firstScanDone
              ? `Last polled: ${cfg.lastPolledAt ? new Date(cfg.lastPolledAt).toLocaleString() : '—'}`
              : 'Not yet polled — a full scan runs on the first poll.')}
        </p>
      )}
    </div>
  );
}

function JobsSection({
  circle,
  onError,
  onChanged,
}: {
  circle: AdminCircle;
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  const muted = new Set(circle.mutedJobs);
  async function toggle(job: MaintenanceJob, mute: boolean) {
    try {
      await adminSetCircleJob(circle.id, job, mute);
      onChanged();
    } catch (e) {
      onError(e);
    }
  }
  return (
    <div className="subsec">
      <h4>Maintenance jobs</h4>
      <p className="muted">Mute a cross-circle maintenance job for this circle.</p>
      <ul className="admin-list compact">
        {JOBS.map((j) => (
          <li key={j.id}>
            <span>{j.label}</span>
            <label className="row" style={{ gap: '0.3rem' }}>
              <input
                type="checkbox"
                checked={!muted.has(j.id)}
                onChange={(e) => toggle(j.id, !e.target.checked)}
              />
              {muted.has(j.id) ? 'muted' : 'active'}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
