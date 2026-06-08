import { useCallback, useEffect, useState } from 'react';
import {
  adminAddMember,
  adminAddUser,
  adminCreateGroup,
  adminDeleteMember,
  adminDeleteUser,
  adminImportSchedule,
  adminLinkGroupWhatsApp,
  adminListGroups,
  adminListMembers,
  adminListUsers,
  adminWhatsAppStatus,
} from '../lib/api';
import type { AdminGroup, AdminUser, GroupMember, WhatsAppGroup, WhatsAppStatus } from '../lib/types';

export function Admin() {
  const [error, setError] = useState<string | null>(null);
  const [wa, setWa] = useState<WhatsAppStatus | null>(null);
  const fail = (e: unknown) => setError(String((e as Error).message ?? e));

  const loadWa = useCallback(() => {
    adminWhatsAppStatus().then(setWa).catch(() => {});
  }, []);
  useEffect(() => {
    loadWa();
    const t = setInterval(loadWa, 4000);
    return () => clearInterval(t);
  }, [loadWa]);

  return (
    <div className="admin">
      {error && <p className="error">{error}</p>}
      <WhatsAppPanel wa={wa} />
      <UsersSection onError={fail} />
      <GroupsSection onError={fail} waGroups={wa?.groups ?? []} />
    </div>
  );
}

function WhatsAppPanel({ wa }: { wa: WhatsAppStatus | null }) {
  const status = wa?.status ?? 'offline';
  return (
    <section className="admin-card">
      <h2>WhatsApp connection</h2>
      {status === 'open' ? (
        <p>
          <span className="badge admin">Connected</span> linked as{' '}
          <strong>{wa?.self ?? 'device'}</strong> · {wa?.groups.length ?? 0} group(s) visible
        </p>
      ) : status === 'qr' && wa?.qr ? (
        <div className="wa-qr">
          <p className="muted">
            Open WhatsApp on the phone → <strong>Settings → Linked Devices → Link a Device</strong>{' '}
            → scan this code:
          </p>
          <img src={wa.qr} alt="WhatsApp QR code" width={240} height={240} />
        </div>
      ) : (
        <p className="muted">
          Status: <strong>{status}</strong>
          {status === 'connecting' && ' — connecting…'}
          {status === 'offline' && ' — worker starting, waiting for a QR code…'}
          {status === 'logged_out' && ' — device was unlinked; restart the worker to get a new QR.'}
        </p>
      )}
    </section>
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
          <li key={u.id}>
            <span>
              {u.email} <span className={`badge ${u.role}`}>{u.role}</span>
            </span>
            <button className="link-danger" onClick={() => remove(u.id)}>
              remove
            </button>
          </li>
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

function GroupsSection({
  onError,
  waGroups,
}: {
  onError: (e: unknown) => void;
  waGroups: WhatsAppGroup[];
}) {
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [name, setName] = useState('');
  const [tz, setTz] = useState('America/Los_Angeles');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    adminListGroups().then(setGroups).catch(onError);
  }, [onError]);
  useEffect(load, [load]);

  async function create() {
    if (!name.trim()) return;
    try {
      await adminCreateGroup(name.trim(), tz.trim() || 'UTC');
      setName('');
      load();
    } catch (e) {
      onError(e);
    }
  }

  return (
    <section className="admin-card">
      <h2>Groups</h2>
      <ul className="admin-list">
        {groups.map((g) => (
          <li key={g.id} className="group-row">
            <div className="group-head" onClick={() => setOpenId(openId === g.id ? null : g.id)}>
              <span>
                <strong>{g.name}</strong> <span className="muted">({g.timezone})</span>{' '}
                {g.whatsappGroupId ? (
                  <span className="badge admin">WhatsApp linked</span>
                ) : (
                  <span className="badge member">no WhatsApp</span>
                )}
              </span>
              <span className="muted">{openId === g.id ? '▲' : '▼'}</span>
            </div>
            {openId === g.id && (
              <GroupDetail group={g} waGroups={waGroups} onError={onError} onChanged={load} />
            )}
          </li>
        ))}
      </ul>
      <div className="admin-form">
        <input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="IANA timezone" value={tz} onChange={(e) => setTz(e.target.value)} />
        <button className="primary" onClick={create}>
          Create group
        </button>
      </div>
    </section>
  );
}

function GroupDetail({
  group,
  waGroups,
  onError,
  onChanged,
}: {
  group: AdminGroup;
  waGroups: WhatsAppGroup[];
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [mName, setMName] = useState('');
  const [mEmail, setMEmail] = useState('');
  const [mWa, setMWa] = useState('');
  const [waJid, setWaJid] = useState(group.whatsappGroupId ?? '');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    adminListMembers(group.id).then(setMembers).catch(onError);
  }, [group.id, onError]);

  async function doImport() {
    if (!importFile) return;
    setImportBusy(true);
    setImportMsg(null);
    try {
      const r = await adminImportSchedule(group.id, importFile);
      const errs = r.errors.length ? ` · ${r.errors.length} issue(s)` : '';
      setImportMsg(`Imported ${r.created} event(s)${r.skipped ? `, skipped ${r.skipped}` : ''}${errs}.`);
      setImportFile(null);
      onChanged();
    } catch (e) {
      setImportMsg(`Failed: ${(e as Error).message}`);
    } finally {
      setImportBusy(false);
    }
  }
  useEffect(load, [load]);

  async function addMember() {
    if (!mName && !mEmail && !mWa) return;
    try {
      await adminAddMember(group.id, { name: mName, email: mEmail, waId: mWa });
      setMName('');
      setMEmail('');
      setMWa('');
      load();
    } catch (e) {
      onError(e);
    }
  }
  async function removeMember(id: string) {
    try {
      await adminDeleteMember(group.id, id);
      load();
    } catch (e) {
      onError(e);
    }
  }
  async function linkWhatsApp() {
    if (!waJid) return;
    try {
      await adminLinkGroupWhatsApp(group.id, waJid);
      onChanged();
    } catch (e) {
      onError(e);
    }
  }

  const linkedSubject = waGroups.find((g) => g.id === group.whatsappGroupId)?.subject;

  return (
    <div className="group-detail">
      <div className="subsec">
        <h4>Members (schedule routing)</h4>
        <p className="muted">Match WhatsApp numbers / forwarding emails to this group.</p>
        <ul className="admin-list compact">
          {members.map((m) => (
            <li key={m.id}>
              <span>
                {m.name ?? '—'} {m.email && <span className="muted">· {m.email}</span>}{' '}
                {m.waId && <span className="muted">· {m.waId}</span>}
              </span>
              <button className="link-danger" onClick={() => removeMember(m.id)}>
                remove
              </button>
            </li>
          ))}
        </ul>
        <div className="admin-form">
          <input placeholder="name" value={mName} onChange={(e) => setMName(e.target.value)} />
          <input placeholder="email" value={mEmail} onChange={(e) => setMEmail(e.target.value)} />
          <input
            placeholder="WhatsApp number"
            value={mWa}
            onChange={(e) => setMWa(e.target.value)}
          />
          <button className="primary" onClick={addMember}>
            Add
          </button>
        </div>
      </div>

      <div className="subsec">
        <h4>WhatsApp group</h4>
        <p className="muted">
          Pick which WhatsApp group (the linked device is in) maps to this Jarvis group. Jarvis
          replies when @mentioned or addressed as “Jarvis”, and sends reminders here.
        </p>
        {group.whatsappGroupId && (
          <p className="muted">
            Currently linked: <strong>{linkedSubject ?? group.whatsappGroupId}</strong>
          </p>
        )}
        <div className="admin-form">
          <select value={waJid} onChange={(e) => setWaJid(e.target.value)}>
            <option value="">— select a WhatsApp group —</option>
            {waGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.subject}
              </option>
            ))}
          </select>
          <button className="primary" onClick={linkWhatsApp} disabled={!waJid}>
            Link
          </button>
        </div>
        {waGroups.length === 0 && (
          <p className="muted">No WhatsApp groups visible yet — connect the device above first.</p>
        )}
      </div>

      <div className="subsec">
        <h4>Import schedule</h4>
        <p className="muted">
          Upload an <strong>.ics</strong> calendar or an openclaw <strong>.json</strong> export to
          bulk-add events into this group.
        </p>
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
    </div>
  );
}
