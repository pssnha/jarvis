import type {
  AdminGroup,
  AdminUser,
  CalendarOccurrence,
  EventDetail,
  EventPayload,
  GroupMember,
  Me,
  WebGroup,
} from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function getHealth(): Promise<unknown> {
  return fetch('/api/healthz').then((r) => json(r));
}

// ---------- Auth ----------
export async function getMe(): Promise<Me | null> {
  const res = await fetch('/api/auth/me');
  if (res.status === 401) return null;
  return json<Me>(res);
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

// ---------- Admin ----------
export async function adminListUsers(): Promise<AdminUser[]> {
  return fetch('/api/admin/users').then((r) => json<AdminUser[]>(r));
}
export async function adminAddUser(email: string, role: string): Promise<void> {
  await fetch('/api/admin/users', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, role }),
  }).then((r) => json(r));
}
export async function adminDeleteUser(id: string): Promise<void> {
  await fetch(`/api/admin/users/${id}`, { method: 'DELETE' }).then((r) => json(r));
}

export async function adminListGroups(): Promise<AdminGroup[]> {
  return fetch('/api/admin/groups').then((r) => json<AdminGroup[]>(r));
}
export async function adminCreateGroup(name: string, timezone: string): Promise<void> {
  await fetch('/api/admin/groups', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name, timezone }),
  }).then((r) => json(r));
}
export async function adminListMembers(groupId: string): Promise<GroupMember[]> {
  return fetch(`/api/admin/groups/${groupId}/members`).then((r) => json<GroupMember[]>(r));
}
export async function adminAddMember(
  groupId: string,
  m: { name?: string; email?: string; waId?: string },
): Promise<void> {
  await fetch(`/api/admin/groups/${groupId}/members`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(m),
  }).then((r) => json(r));
}
export async function adminDeleteMember(groupId: string, memberId: string): Promise<void> {
  await fetch(`/api/admin/groups/${groupId}/members/${memberId}`, { method: 'DELETE' }).then((r) =>
    json(r),
  );
}
export async function adminOnboardWhatsApp(
  groupId: string,
  body: { whatsappGroupId?: string; inviteLink?: string; create?: boolean },
): Promise<void> {
  await fetch(`/api/admin/groups/${groupId}/whatsapp`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  }).then((r) => json(r));
}

export async function getWebGroup(): Promise<WebGroup> {
  return fetch('/api/web/group').then((r) => json<WebGroup>(r));
}

export async function getCalendar(
  groupId: string,
  fromISO: string,
  toISO: string,
): Promise<CalendarOccurrence[]> {
  const u = new URL(`/api/groups/${groupId}/calendar`, window.location.origin);
  u.searchParams.set('from', fromISO);
  u.searchParams.set('to', toISO);
  return fetch(u).then((r) => json<CalendarOccurrence[]>(r));
}

export async function getEvent(groupId: string, eventId: string): Promise<EventDetail> {
  return fetch(`/api/groups/${groupId}/events/${eventId}`).then((r) => json<EventDetail>(r));
}

export async function createEvent(groupId: string, payload: EventPayload): Promise<void> {
  await fetch(`/api/groups/${groupId}/events`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function updateEvent(
  groupId: string,
  eventId: string,
  payload: EventPayload,
): Promise<void> {
  await fetch(`/api/groups/${groupId}/events/${eventId}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function deleteEvent(groupId: string, eventId: string): Promise<void> {
  await fetch(`/api/groups/${groupId}/events/${eventId}`, { method: 'DELETE' }).then((r) =>
    json(r),
  );
}
