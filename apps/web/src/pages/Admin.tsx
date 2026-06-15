import { useCallback, useEffect, useState } from 'react';
import {
  adminAddCircleMember,
  adminAddGroupMember,
  adminAddUser,
  adminCircleEmailActivity,
  adminCircleTelegram,
  adminCircleWhatsAppStatus,
  adminConfirmEmailItem,
  adminLinkCircleTelegram,
  adminUnlinkCircleTelegram,
  adminPollCircleEmail,
  adminRejectEmailItem,
  adminCreateCircle,
  adminDeleteCircle,
  adminDeleteCircleEmail,
  adminDeleteCircleMember,
  adminDeleteCircleCover,
  adminReinstateCircle,
  adminDeleteUser,
  adminImportSchedule,
  adminListCircles,
  adminListUsers,
  adminLogoutCircleWhatsApp,
  adminRemoveGroupMember,
  adminSetCircleCover,
  adminSetCircleEmail,
  adminSetCircleJob,
  adminSetMemberRole,
  adminStartCircleWhatsApp,
  adminUpdateUser,
} from '../lib/api';
import type {
  AdminCircle,
  AdminCircleGroup,
  AdminUser,
  CircleMemberRole,
  EmailActivity,
  EmailConfirmResult,
  MaintenanceJob,
  TelegramLink,
  TelegramStatus,
  WhatsAppStatus,
} from '../lib/types';

const JOBS: { id: MaintenanceJob; label: string }[] = [
  { id: 'email_poll', label: 'Email polling' },
  { id: 'daily_brief', label: 'Daily brief' },
  { id: 'health_check', label: 'Health check' },
];

/** Permissions page — who can sign in to the site, with inline editing. */
export function Permissions() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [role, setRole] = useState('member');
  const onError = (e: unknown) => setError(String((e as Error).message ?? e));

  const load = useCallback(() => {
    adminListUsers().then(setUsers).catch(onError);
  }, []);
  useEffect(load, [load]);

  async function add() {
    if (!email.trim()) return;
    try {
      await adminAddUser({ name: name || undefined, email: email.trim(), role, whatsapp: whatsapp || undefined });
      setName('');
      setEmail('');
      setWhatsapp('');
      setRole('member');
      load();
    } catch (e) {
      onError(e);
    }
  }
  async function remove(id: string) {
    if (!confirm('Remove this member?')) return;
    try {
      await adminDeleteUser(id);
      load();
    } catch (e) {
      onError(e);
    }
  }

  return (
    <div className="permissions">
      <div className="vac-toolbar">
        <h2>Permissions</h2>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="perm-table">
        <div className="perm-head">
          <span>Name</span>
          <span>Email</span>
          <span>WhatsApp</span>
          <span>Type</span>
          <span />
        </div>
        {users.map((u) => (
          <PermRow key={u.id} user={u} onError={onError} onChanged={load} onRemove={() => remove(u.id)} />
        ))}
        <div className="perm-row add">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            placeholder="WhatsApp number"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
          />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <span className="perm-actions">
            <button className="btn-quiet" onClick={add}>
              Add
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function PermRow({
  user,
  onError,
  onChanged,
  onRemove,
}: {
  user: AdminUser;
  onError: (e: unknown) => void;
  onChanged: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(user.name ?? '');
  const [email, setEmail] = useState(user.email);
  const [whatsapp, setWhatsapp] = useState('');
  const [role, setRole] = useState(user.role);

  function cancel() {
    setEditing(false);
    setName(user.name ?? '');
    setEmail(user.email);
    setWhatsapp('');
    setRole(user.role);
  }
  async function save() {
    setBusy(true);
    try {
      await adminUpdateUser(user.id, {
        name: name || null,
        email,
        role,
        ...(whatsapp.trim() ? { whatsapp: whatsapp.trim() } : {}),
      });
      setEditing(false);
      setWhatsapp('');
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="perm-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder={user.waId ? `${user.waId} (unchanged)` : 'WhatsApp number'}
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <span className="perm-actions">
          <button className="btn-quiet sm" onClick={save} disabled={busy}>
            Save
          </button>
          <button className="btn-quiet sm" onClick={cancel} disabled={busy}>
            Cancel
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="perm-row">
      <span className="perm-name">{user.name || '—'}</span>
      <span className="perm-cell">{user.email}</span>
      <span className="perm-cell">{user.waId ?? '—'}</span>
      <span>
        <span className={user.role === 'admin' ? 'badge admin' : 'badge member'}>
          {user.role === 'admin' ? 'Admin' : 'Member'}
        </span>
      </span>
      <span className="perm-actions">
        <button className="btn-quiet sm" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="link-danger" onClick={onRemove}>
          Remove
        </button>
      </span>
    </div>
  );
}

/** Circles page — a card grid (like Vacations); click a card to manage a circle. */
export function Circles({
  siteAdmin,
  itemId,
  onOpen,
  onBack,
}: {
  siteAdmin: boolean;
  itemId: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const [circles, setCircles] = useState<AdminCircle[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [tz, setTz] = useState('America/Los_Angeles');
  const [error, setError] = useState<string | null>(null);
  // Set to a circle when its delete (type-to-confirm) modal is open.
  const [deleteTarget, setDeleteTarget] = useState<AdminCircle | null>(null);
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

  const current = itemId ? (circles.find((c) => c.id === itemId) ?? null) : null;

  async function reinstate(c: AdminCircle) {
    try {
      await adminReinstateCircle(c.id);
      load();
    } catch (e) {
      onError(e);
    }
  }

  if (current) {
    return (
      <div className="admin">
        {error && <p className="error">{error}</p>}
        <button className="link" onClick={onBack}>
          ← All circles
        </button>
        {current.deletedAt && (
          <div className="delete-banner">
            <span>
              Scheduled for deletion — data is removed on{' '}
              <strong>{fmtPurgeDate(current.purgeAfter)}</strong>.
            </span>
            <button className="btn-quiet" onClick={() => reinstate(current)}>
              Restore
            </button>
          </div>
        )}
        <section className="admin-card">
          <h2>{current.name}</h2>
          <CircleDetail
            circle={current}
            siteAdmin={siteAdmin}
            onError={onError}
            onChanged={load}
            onRemove={() => setDeleteTarget(current)}
            onReinstate={() => reinstate(current)}
          />
        </section>
        {deleteTarget && (
          <DeleteCircleModal
            circle={deleteTarget}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={async () => {
              try {
                await adminDeleteCircle(deleteTarget.id);
                setDeleteTarget(null);
                load(); // stay on the detail; it now shows the restore option
              } catch (e) {
                onError(e);
                setDeleteTarget(null);
              }
            }}
          />
        )}
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
              className={`vac-card${c.coverImageUrl ? ' has-image' : ''}${c.deletedAt ? ' deleting' : ''}`}
              onClick={() => onOpen(c.id)}
              style={
                c.coverImageUrl
                  ? {
                      backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.72) 100%), url("${c.coverImageUrl}")`,
                    }
                  : undefined
              }
            >
              <div className="vac-card-body">
                {c.deletedAt && (
                  <span className="card-status deleting">
                    Scheduled for deletion · purges {fmtPurgeDate(c.purgeAfter)}
                  </span>
                )}
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

function fmtNumber(n: string | null | undefined): string {
  if (!n) return 'Linked device';
  const d = n.replace(/\D/g, '');
  return `+${d}`;
}

function CircleWhatsApp({ circle, onError }: { circle: AdminCircle; onError: (e: unknown) => void }) {
  const [wa, setWa] = useState<WhatsAppStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminCircleWhatsAppStatus(circle.id).then(setWa).catch(() => {});
  }, [circle.id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const status = wa?.status ?? 'offline';

  async function connect() {
    setBusy(true);
    try {
      await adminStartCircleWhatsApp(circle.id);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    if (!confirm('Remove this WhatsApp number? You can link a new one with a QR code.')) return;
    setBusy(true);
    try {
      await adminLogoutCircleWhatsApp(circle.id);
      setWa(null);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  if (status === 'open') {
    return (
      <div className="conn-card">
        <div className="conn-row">
          <span className="conn-dot ok" />
          <div className="conn-main">
            <div className="conn-title">{fmtNumber(wa?.self)}</div>
            <div className="conn-sub">Connected · {wa?.groups.length ?? 0} groups</div>
          </div>
          <button className="btn-quiet danger" onClick={disconnect} disabled={busy}>
            Remove
          </button>
        </div>
      </div>
    );
  }
  if (status === 'qr' && wa?.qr) {
    return (
      <div className="conn-card qr">
        <img src={wa.qr} alt="WhatsApp QR code" width={200} height={200} />
        <div className="conn-sub">WhatsApp → Linked Devices → Link a Device</div>
      </div>
    );
  }
  return (
    <div className="conn-card">
      <div className="conn-row">
        <span className="conn-dot" />
        <div className="conn-main">
          <div className="conn-title">No number linked</div>
          <div className="conn-sub">{status === 'connecting' ? 'Connecting…' : 'Link a WhatsApp number'}</div>
        </div>
        <button className="btn-quiet" onClick={connect} disabled={busy}>
          Connect
        </button>
      </div>
    </div>
  );
}

/**
 * Type-to-confirm delete dialog. The destructive button stays disabled until
 * the admin types the circle's exact name — a deliberate double-confirmation.
 */
function DeleteCircleModal({
  circle,
  onCancel,
  onConfirm,
}: {
  circle: AdminCircle;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === circle.name;

  async function confirm() {
    if (!matches || busy) return;
    setBusy(true);
    await onConfirm();
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Delete “{circle.name}”?</h2>
        <p className="muted">
          This schedules the circle for deletion. Its {circle.groups.length} group(s),{' '}
          {circle.members.length} member(s), {circle.counts.events} event(s) and{' '}
          {circle.counts.vacations} trip(s) are kept for 30 days so you can restore it, then
          permanently removed.
        </p>
        <label>
          Type the circle name to confirm
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={circle.name}
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="btn-danger" disabled={!matches || busy} onClick={confirm}>
            {busy ? 'Scheduling…' : 'Schedule deletion'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CircleTelegram({ circle, onError }: { circle: AdminCircle; onError: (e: unknown) => void }) {
  const [tg, setTg] = useState<TelegramStatus | null>(null);
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminCircleTelegram(circle.id).then(setTg).catch(() => {});
  }, [circle.id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function generate() {
    setBusy(true);
    try {
      setLink(await adminLinkCircleTelegram(circle.id));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    if (!confirm('Unlink this Telegram group?')) return;
    setBusy(true);
    try {
      await adminUnlinkCircleTelegram(circle.id);
      setLink(null);
      load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!tg) return <div className="conn-card"><div className="conn-sub">Loading…</div></div>;

  const bot = tg.botUsername ? `@${tg.botUsername}` : '—';

  if (!tg.configured) {
    return (
      <div className="conn-card">
        <div className="conn-row">
          <span className="conn-dot" />
          <div className="conn-main">
            <div className="conn-title">Not configured</div>
            <div className="conn-sub">Set TELEGRAM_BOT_TOKEN to enable Telegram.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="conn-card">
      <dl className="conn-details">
        <div className="conn-detail">
          <dt>Bot</dt>
          <dd>{bot}</dd>
        </div>
        <div className="conn-detail">
          <dt>Status</dt>
          <dd>
            <span className={`conn-dot ${tg.linked ? 'ok' : ''}`} /> {tg.linked ? 'Linked' : 'Not linked'}
          </dd>
        </div>
        {tg.linked && (
          <>
            <div className="conn-detail">
              <dt>Group</dt>
              <dd>{tg.linked.name}</dd>
            </div>
            <div className="conn-detail">
              <dt>Chat ID</dt>
              <dd><code>{tg.linked.chatId}</code></dd>
            </div>
          </>
        )}
      </dl>

      {tg.linked ? (
        <button className="btn-quiet danger" onClick={disconnect} disabled={busy}>
          Unlink
        </button>
      ) : link ? (
        <div className="conn-main">
          <ol className="conn-steps">
            <li>
              In Telegram, open the group you want Jarvis in, tap <strong>Add members</strong>,
              search <code>{bot}</code> and add it.
              {link.deepLink && (
                <>
                  {' '}
                  Shortcut:{' '}
                  <a href={link.deepLink} target="_blank" rel="noreferrer">
                    add to a group
                  </a>
                  . If that just opens a chat with the bot, add it manually as above.
                </>
              )}
            </li>
            <li>
              In that group, send <code>{link.command}</code>. Jarvis replies to confirm it's
              linked (works even before privacy mode is changed).
            </li>
          </ol>
          <div className="conn-sub">
            One Telegram group per circle. The code expires soon —{' '}
            <button className="link" onClick={generate} disabled={busy}>
              get a new code
            </button>
            .
          </div>
        </div>
      ) : (
        <button className="btn-quiet" onClick={generate} disabled={busy}>
          Connect
        </button>
      )}
    </div>
  );
}

function CircleDetail({
  circle,
  siteAdmin,
  onError,
  onChanged,
  onRemove,
  onReinstate,
}: {
  circle: AdminCircle;
  siteAdmin: boolean;
  onError: (e: unknown) => void;
  onChanged: () => void;
  onRemove: () => void;
  onReinstate: () => void;
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
          onReinstate={onReinstate}
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
  const [sub, setSub] = useState<'whatsapp' | 'telegram' | 'groups' | 'email'>('whatsapp');
  const pills: { id: typeof sub; label: string }[] = [
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'telegram', label: 'Telegram' },
    { id: 'groups', label: 'Groups' },
    { id: 'email', label: 'Email' },
  ];
  return (
    <div className="pane">
      <div className="pills">
        {pills.map((p) => (
          <button
            key={p.id}
            className={sub === p.id ? 'pill on' : 'pill'}
            onClick={() => setSub(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {sub === 'whatsapp' && <CircleWhatsApp circle={circle} onError={onError} />}
      {sub === 'telegram' && <CircleTelegram circle={circle} onError={onError} />}
      {sub === 'groups' && <GroupsList circle={circle} onError={onError} onChanged={onChanged} />}
      {sub === 'email' && (
        <EmailPollingSection circle={circle} onError={onError} onChanged={onChanged} />
      )}
    </div>
  );
}

function GroupsList({
  circle,
  onError,
  onChanged,
}: {
  circle: AdminCircle;
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  if (circle.groups.length === 0) {
    return <p className="conn-empty">No groups yet — add Jarvis to a WhatsApp group.</p>;
  }
  return (
    <div className="group-cards">
      {circle.groups.map((g) => (
        <GroupCard key={g.id} circle={circle} group={g} onError={onError} onChanged={onChanged} />
      ))}
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
  onError,
  onChanged,
  onRemove,
  onReinstate,
}: {
  circle: AdminCircle;
  siteAdmin: boolean;
  onError: (e: unknown) => void;
  onChanged: () => void;
  onRemove: () => void;
  onReinstate: () => void;
}) {
  const scheduled = Boolean(circle.deletedAt);
  return (
    <div className="pane">
      <JobsSection circle={circle} onError={onError} onChanged={onChanged} />
      <CoverImageSection circle={circle} onError={onError} onChanged={onChanged} />
      <div className="subsec danger-zone">
        <h4>Danger zone</h4>
        {scheduled ? (
          <>
            <p className="muted">
              Scheduled for deletion — all data is permanently removed on{' '}
              <strong>{fmtPurgeDate(circle.purgeAfter)}</strong>. Restore it before then to cancel.
            </p>
            <button className="btn-quiet" onClick={onReinstate}>
              Restore circle
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Schedule this circle for deletion. Its data is kept for 30 days so it can be restored,
              then permanently removed.
            </p>
            <button className="btn-danger" onClick={onRemove}>
              Delete circle
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Format a purge timestamp as a readable date, e.g. "Jul 14, 2026". */
function fmtPurgeDate(iso: string | null): string {
  if (!iso) return 'the scheduled date';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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

function GroupCard({
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
  const [editing, setEditing] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const inGroup = new Set(group.memberIds);
  const named = circle.members.filter((m) => m.name);
  const memberNames = named.filter((m) => inGroup.has(m.id)).map((m) => m.name);

  async function toggle(memberId: string, on: boolean) {
    try {
      if (on) await adminAddGroupMember(circle.id, group.id, memberId);
      else await adminRemoveGroupMember(circle.id, group.id, memberId);
      onChanged();
    } catch (e) {
      onError(e);
    }
  }
  async function doImport(file: File) {
    setImportBusy(true);
    setImportMsg(null);
    try {
      const r = await adminImportSchedule(circle.id, group.id, file);
      const errs = r.errors.length ? ` · ${r.errors.length} issue(s)` : '';
      setImportMsg(`Imported ${r.created}${r.skipped ? `, skipped ${r.skipped}` : ''}${errs}.`);
      onChanged();
    } catch (e) {
      setImportMsg(`Failed: ${(e as Error).message}`);
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="group-card">
      <div className="group-card-head">
        <span className="group-name">{group.name}</span>
        <button className="btn-quiet sm" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {!editing ? (
        <div className="group-members">
          {memberNames.length > 0 ? (
            memberNames.map((n) => (
              <span key={n} className="m-chip">
                {n}
              </span>
            ))
          ) : (
            <span className="conn-sub">No members yet</span>
          )}
        </div>
      ) : (
        <>
          <div className="group-members">
            {named.map((m) => (
              <button
                key={m.id}
                type="button"
                className={inGroup.has(m.id) ? 'm-chip on' : 'm-chip toggle'}
                onClick={() => toggle(m.id, !inGroup.has(m.id))}
              >
                {m.name}
              </button>
            ))}
          </div>
          <div className="group-card-foot">
            <a className="ical-link" href={`/api/calendar/${group.icalToken}.ics`}>
              iCal feed
            </a>
            <label className="import-link">
              {importBusy ? 'Importing…' : 'Import schedule'}
              <input
                type="file"
                accept=".ics,.json,text/calendar,application/json"
                disabled={importBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void doImport(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {importMsg && <p className="conn-sub">{importMsg}</p>}
        </>
      )}
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
  const [address, setAddress] = useState('');
  const [credential, setCredential] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function connect() {
    if (!address.trim() || !credential.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      // The API verifies the IMAP login before saving; a bad app-password is
      // rejected here rather than silently stored.
      await adminSetCircleEmail(circle.id, {
        address: address.trim(),
        credential: credential.trim(),
        enabled: true,
      });
      setAddress('');
      setCredential('');
      onChanged();
      // The save triggers an immediate poll; refresh once it has run so the
      // status flips from "checking…" to "last checked".
      setTimeout(onChanged, 5000);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }
  async function togglePolling() {
    setBusy(true);
    try {
      await adminSetCircleEmail(circle.id, { address: cfg.address!, enabled: !cfg.enabled });
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm('Disconnect this mailbox?')) return;
    setBusy(true);
    try {
      await adminDeleteCircleEmail(circle.id);
      onChanged();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  if (cfg.address) {
    const sub = !cfg.enabled
      ? 'Paused'
      : cfg.lastPolledAt
        ? `Active · last checked ${new Date(cfg.lastPolledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : 'Active · checking…';
    return (
      <>
        <div className="conn-card">
          <div className="conn-row">
            <span className={cfg.enabled ? 'conn-dot ok' : 'conn-dot'} />
            <div className="conn-main">
              <div className="conn-title">{cfg.address}</div>
              <div className="conn-sub">{sub}</div>
            </div>
            <button className="btn-quiet" onClick={togglePolling} disabled={busy}>
              {cfg.enabled ? 'Pause' : 'Resume'}
            </button>
            <button className="btn-quiet danger" onClick={remove} disabled={busy}>
              Remove
            </button>
          </div>
        </div>
        <EmailActivityLog circleId={circle.id} onError={onError} />
      </>
    );
  }

  return (
    <div className="conn-card pad">
      <div className="email-add">
        <input
          type="email"
          placeholder="mailbox@gmail.com"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <input
          type="password"
          placeholder="app password"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
        />
        <button className="btn-quiet" onClick={connect} disabled={busy || !address || !credential}>
          {busy ? 'Verifying…' : 'Connect'}
        </button>
      </div>
      {err && <p className="conn-error">{err}</p>}
    </div>
  );
}

const ITEM_EMOJI: Record<string, string> = { vacation: '🧳', event: '📅', reminder: '🔔' };
function outcome(status: EmailActivity['items'][number]['status']): { label: string; cls: string } {
  if (status === 'confirmed') return { label: 'Added', cls: 'ai-out added' };
  if (status === 'rejected') return { label: 'Skipped', cls: 'ai-out skipped' };
  return { label: 'Pending', cls: 'ai-out pending' };
}
function fmtWhen(s: string): string {
  return new Date(s).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function EmailActivityLog({
  circleId,
  onError,
}: {
  circleId: string;
  onError: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<EmailActivity | null>(null);
  const [polling, setPolling] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [choice, setChoice] = useState<EmailConfirmResult['needsChoice'] | null>(null);

  const load = useCallback(() => {
    adminCircleEmailActivity(circleId).then(setData).catch(() => {});
  }, [circleId]);

  async function act(id: string, action: 'confirm' | 'reject', target?: string) {
    setActing(id);
    try {
      if (action === 'reject') {
        await adminRejectEmailItem(circleId, id);
      } else {
        const r = await adminConfirmEmailItem(circleId, id, target);
        if (r.needsChoice) {
          setChoice(r.needsChoice);
          return; // ask which trip before refreshing
        }
        setChoice(null);
      }
      load();
    } catch (e) {
      onError(e);
    } finally {
      setActing(null);
    }
  }
  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [open, load]);

  async function pollNow() {
    setPolling(true);
    setOpen(true);
    try {
      await adminPollCircleEmail(circleId);
      // The poll runs in the worker; refresh a couple of times to catch results.
      setTimeout(load, 2500);
      setTimeout(load, 6000);
    } catch (e) {
      onError(e);
    } finally {
      setTimeout(() => setPolling(false), 6000);
    }
  }

  return (
    <div className="email-activity">
      <div className="activity-head">
        <button className="activity-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide activity' : 'Show activity'}
        </button>
        <button className="activity-toggle" onClick={pollNow} disabled={polling}>
          {polling ? 'Polling…' : 'Poll now'}
        </button>
      </div>
      {open && data && (
        <div className="activity-body">
          {data.items.length > 0 && (
            <ul className="activity-items">
              {data.items.map((it) => {
                const o = outcome(it.status);
                return (
                  <li key={it.id} className="activity-item">
                    <span className="ai-kind">{ITEM_EMOJI[it.kind] ?? '•'}</span>
                    <div className="ai-main">
                      <div className="ai-title">{it.summary || it.title}</div>
                      <div className="ai-sub">
                        {it.subject || it.fromEmail || 'email'} · {fmtWhen(it.createdAt)}
                      </div>
                    </div>
                    {it.status === 'pending' && choice?.proposalId === it.id ? (
                      <div className="ai-actions choice">
                        {choice.options.map((opt) => (
                          <button
                            key={opt.target}
                            className="btn-quiet sm"
                            disabled={acting === it.id}
                            onClick={() => act(it.id, 'confirm', opt.target)}
                          >
                            {opt.target === 'new' ? 'New trip' : `→ ${opt.label}`}
                          </button>
                        ))}
                      </div>
                    ) : it.status === 'pending' ? (
                      <div className="ai-actions">
                        <button
                          className="btn-quiet sm"
                          disabled={acting === it.id}
                          onClick={() => act(it.id, 'confirm')}
                        >
                          Add
                        </button>
                        <button
                          className="btn-quiet sm"
                          disabled={acting === it.id}
                          onClick={() => act(it.id, 'reject')}
                        >
                          Ignore
                        </button>
                      </div>
                    ) : (
                      <span className={o.cls}>{o.label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="activity-polls">
            <div className="activity-label">Polls</div>
            {data.polls.length === 0 ? (
              <div className="conn-sub">No polls yet.</div>
            ) : (
              data.polls.map((p, i) => (
                <div key={i} className={p.error ? 'poll-row err' : 'poll-row'}>
                  <span className="pr-time">{fmtWhen(p.ranAt)}</span>
                  <span className="pr-detail">
                    {p.error
                      ? `error: ${p.error}`
                      : p.scanned === 0
                        ? 'no new mail'
                        : `scanned ${p.scanned} · found ${p.found}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
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
              {muted.has(j.id) ? 'Muted' : 'Active'}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
