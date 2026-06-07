import { useCallback, useEffect, useState } from 'react';
import {
  adminAddMember,
  adminAddUser,
  adminCreateGroup,
  adminDeleteMember,
  adminDeleteUser,
  adminListGroups,
  adminListMembers,
  adminListUsers,
  adminOnboardWhatsApp,
} from '../lib/api';
import type { AdminGroup, AdminUser, GroupMember } from '../lib/types';

export function Admin() {
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(String((e as Error).message ?? e));

  return (
    <div className="admin">
      {error && <p className="error">{error}</p>}
      <UsersSection onError={fail} />
      <GroupsSection onError={fail} />
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

function GroupsSection({ onError }: { onError: (e: unknown) => void }) {
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
            {openId === g.id && <GroupDetail group={g} onError={onError} onChanged={load} />}
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
  onError,
  onChanged,
}: {
  group: AdminGroup;
  onError: (e: unknown) => void;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [mName, setMName] = useState('');
  const [mEmail, setMEmail] = useState('');
  const [mWa, setMWa] = useState('');
  const [waId, setWaId] = useState(group.whatsappGroupId ?? '');
  const [invite, setInvite] = useState(group.inviteLink ?? '');

  const load = useCallback(() => {
    adminListMembers(group.id).then(setMembers).catch(onError);
  }, [group.id, onError]);
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
  async function saveWhatsApp(create: boolean) {
    try {
      await adminOnboardWhatsApp(group.id, {
        whatsappGroupId: waId || undefined,
        inviteLink: invite || undefined,
        create,
      });
      onChanged();
    } catch (e) {
      onError(e);
    }
  }

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
          <input placeholder="WhatsApp number" value={mWa} onChange={(e) => setMWa(e.target.value)} />
          <button className="primary" onClick={addMember}>
            Add
          </button>
        </div>
      </div>

      <div className="subsec">
        <h4>WhatsApp group</h4>
        <p className="muted">
          Link the hosted WhatsApp group. Paste an existing group id + invite link, or create one
          via the API.
        </p>
        <div className="admin-form">
          <input
            placeholder="WhatsApp group id"
            value={waId}
            onChange={(e) => setWaId(e.target.value)}
          />
          <input
            placeholder="invite link (optional)"
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
          />
          <button className="primary" onClick={() => saveWhatsApp(false)}>
            Save
          </button>
          <button onClick={() => saveWhatsApp(true)}>Create via API</button>
        </div>
      </div>
    </div>
  );
}
