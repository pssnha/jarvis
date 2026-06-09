import type {
  AdminGroup,
  AdminUser,
  CalendarOccurrence,
  Conflict,
  EventDetail,
  EventPayload,
  GroupMember,
  GroupSummary,
  Me,
  MemberLite,
  VacationDetail,
  VacationItemPayload,
  VacationPayload,
  VacationSummary,
  WhatsAppStatus,
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
export async function adminSetUserWhatsApp(id: string, number: string): Promise<void> {
  await fetch(`/api/admin/users/${id}/whatsapp`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ number }),
  }).then((r) => json(r));
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
export async function adminWhatsAppStatus(): Promise<WhatsAppStatus> {
  return fetch('/api/admin/whatsapp/status').then((r) => json<WhatsAppStatus>(r));
}

export async function adminImportSchedule(
  groupId: string,
  file: File,
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/admin/groups/${groupId}/import`, { method: 'POST', body: fd });
  return json(res);
}


export async function listGroups(): Promise<GroupSummary[]> {
  return fetch('/api/groups').then((r) => json<GroupSummary[]>(r));
}

export async function getCalendar(
  groupId: string,
  fromISO: string,
  toISO: string,
  memberId?: string,
): Promise<CalendarOccurrence[]> {
  const u = new URL(`/api/groups/${groupId}/calendar`, window.location.origin);
  u.searchParams.set('from', fromISO);
  u.searchParams.set('to', toISO);
  if (memberId) u.searchParams.set('memberId', memberId);
  return fetch(u).then((r) => json<CalendarOccurrence[]>(r));
}

export async function checkConflicts(
  groupId: string,
  start: string,
  end: string | null,
  excludeEventId?: string,
): Promise<Conflict[]> {
  const u = new URL(`/api/groups/${groupId}/conflicts`, window.location.origin);
  u.searchParams.set('start', start);
  if (end) u.searchParams.set('end', end);
  if (excludeEventId) u.searchParams.set('exclude', excludeEventId);
  return fetch(u).then((r) => json<Conflict[]>(r));
}

export async function listGroupMembers(groupId: string): Promise<MemberLite[]> {
  return fetch(`/api/groups/${groupId}/members`).then((r) => json<MemberLite[]>(r));
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

// ---------- Vacations ----------
export async function listVacations(
  groupId: string,
  includePast = false,
): Promise<VacationSummary[]> {
  const u = new URL(`/api/groups/${groupId}/vacations`, window.location.origin);
  if (includePast) u.searchParams.set('includePast', '1');
  return fetch(u).then((r) => json<VacationSummary[]>(r));
}

export async function getVacation(groupId: string, vacationId: string): Promise<VacationDetail> {
  return fetch(`/api/groups/${groupId}/vacations/${vacationId}`).then((r) =>
    json<VacationDetail>(r),
  );
}

export async function createVacation(groupId: string, payload: VacationPayload): Promise<void> {
  await fetch(`/api/groups/${groupId}/vacations`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function updateVacation(
  groupId: string,
  vacationId: string,
  payload: Partial<VacationPayload>,
): Promise<void> {
  await fetch(`/api/groups/${groupId}/vacations/${vacationId}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function deleteVacation(groupId: string, vacationId: string): Promise<void> {
  await fetch(`/api/groups/${groupId}/vacations/${vacationId}`, { method: 'DELETE' }).then((r) =>
    json(r),
  );
}

export async function addVacationItem(
  groupId: string,
  vacationId: string,
  payload: VacationItemPayload,
): Promise<void> {
  await fetch(`/api/groups/${groupId}/vacations/${vacationId}/items`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function updateVacationItem(
  groupId: string,
  vacationId: string,
  itemId: string,
  payload: Partial<VacationItemPayload>,
): Promise<void> {
  await fetch(`/api/groups/${groupId}/vacations/${vacationId}/items/${itemId}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function deleteVacationItem(
  groupId: string,
  vacationId: string,
  itemId: string,
): Promise<void> {
  await fetch(`/api/groups/${groupId}/vacations/${vacationId}/items/${itemId}`, {
    method: 'DELETE',
  }).then((r) => json(r));
}
