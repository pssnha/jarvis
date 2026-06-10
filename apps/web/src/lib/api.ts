import type {
  AdminCircle,
  AdminCircleMember,
  AdminUser,
  CalendarOccurrence,
  Circle,
  CircleAdminUser,
  CircleEmailConfig,
  CircleMemberRole,
  EmailActivity,
  EmailConfirmResult,
  MaintenanceCell,
  MaintenanceRunRow,
  MaintenanceSchedule,
  Conflict,
  EventDetail,
  EventPayload,
  MaintenanceJob,
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

// ---------- Admin: site users ----------
export async function adminListUsers(): Promise<AdminUser[]> {
  return fetch('/api/admin/users').then((r) => json<AdminUser[]>(r));
}
export interface UserInput {
  name?: string | null;
  email?: string;
  role?: string;
  whatsapp?: string | null;
}
export async function adminAddUser(input: UserInput): Promise<void> {
  await fetch('/api/admin/users', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  }).then((r) => json(r));
}
export async function adminUpdateUser(id: string, input: UserInput): Promise<void> {
  await fetch(`/api/admin/users/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  }).then((r) => json(r));
}
export async function adminDeleteUser(id: string): Promise<void> {
  await fetch(`/api/admin/users/${id}`, { method: 'DELETE' }).then((r) => json(r));
}

export async function adminCircleWhatsAppStatus(cid: string): Promise<WhatsAppStatus> {
  return fetch(`/api/admin/circles/${cid}/whatsapp/status`).then((r) => json<WhatsAppStatus>(r));
}
export async function adminStartCircleWhatsApp(cid: string): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/whatsapp/start`, { method: 'POST' }).then((r) => json(r));
}
export async function adminLogoutCircleWhatsApp(cid: string): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/whatsapp/logout`, { method: 'POST' }).then((r) => json(r));
}

// ---------- Admin: circles ----------
export async function adminListCircles(): Promise<AdminCircle[]> {
  return fetch('/api/admin/circles').then((r) => json<AdminCircle[]>(r));
}
export async function adminCreateCircle(name: string, timezone: string): Promise<void> {
  await fetch('/api/admin/circles', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name, timezone }),
  }).then((r) => json(r));
}
export async function adminDeleteCircle(cid: string): Promise<void> {
  await fetch(`/api/admin/circles/${cid}`, { method: 'DELETE' }).then((r) => json(r));
}
export async function adminListCircleAdmins(cid: string): Promise<CircleAdminUser[]> {
  return fetch(`/api/admin/circles/${cid}/admins`).then((r) => json<CircleAdminUser[]>(r));
}
export async function adminAddCircleAdmin(cid: string, email: string): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/admins`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email }),
  }).then((r) => json(r));
}
export async function adminRemoveCircleAdmin(cid: string, userId: string): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/admins/${userId}`, { method: 'DELETE' }).then((r) =>
    json(r),
  );
}
export async function adminSetCircleCover(cid: string, file: File): Promise<{ coverImageUrl: string }> {
  const fd = new FormData();
  fd.append('file', file);
  return fetch(`/api/admin/circles/${cid}/cover`, { method: 'POST', body: fd }).then((r) =>
    json<{ coverImageUrl: string }>(r),
  );
}
export async function adminDeleteCircleCover(cid: string): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/cover`, { method: 'DELETE' }).then((r) => json(r));
}

export async function adminAddCircleMember(
  cid: string,
  m: { name?: string; email?: string; waId?: string },
): Promise<AdminCircleMember> {
  return fetch(`/api/admin/circles/${cid}/members`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(m),
  }).then((r) => json<AdminCircleMember>(r));
}
export async function adminDeleteCircleMember(cid: string, memberId: string): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/members/${memberId}`, { method: 'DELETE' }).then((r) =>
    json(r),
  );
}
export async function adminSetMemberRole(
  cid: string,
  memberId: string,
  role: CircleMemberRole,
): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/members/${memberId}/role`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ role }),
  }).then((r) => json(r));
}

export async function adminAddGroupMember(
  cid: string,
  gid: string,
  memberId: string,
): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/groups/${gid}/members`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ memberId }),
  }).then((r) => json(r));
}
export async function adminRemoveGroupMember(
  cid: string,
  gid: string,
  memberId: string,
): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/groups/${gid}/members/${memberId}`, {
    method: 'DELETE',
  }).then((r) => json(r));
}

export async function adminSetCircleEmail(
  cid: string,
  cfg: { address: string; credential?: string; host?: string; port?: number; enabled?: boolean },
): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/email`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(cfg),
  }).then((r) => json(r));
}
export async function adminDeleteCircleEmail(cid: string): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/email`, { method: 'DELETE' }).then((r) => json(r));
}
export async function adminCircleEmailActivity(cid: string): Promise<EmailActivity> {
  return fetch(`/api/admin/circles/${cid}/email/activity`).then((r) => json<EmailActivity>(r));
}
export async function adminPollCircleEmail(cid: string): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/email/poll`, { method: 'POST' }).then((r) => json(r));
}
export async function adminConfirmEmailItem(
  cid: string,
  id: string,
  target?: string,
): Promise<EmailConfirmResult> {
  return fetch(`/api/admin/circles/${cid}/email/items/${id}/confirm`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(target ? { target } : {}),
  }).then((r) => json<EmailConfirmResult>(r));
}
export async function adminRejectEmailItem(cid: string, id: string): Promise<{ message: string }> {
  return fetch(`/api/admin/circles/${cid}/email/items/${id}/reject`, { method: 'POST' }).then((r) =>
    json<{ message: string }>(r),
  );
}

// ---------- Admin: maintenance ----------
export async function adminMaintenanceCalendar(
  fromISO: string,
  toISO: string,
): Promise<{ cells: MaintenanceCell[]; schedules: MaintenanceSchedule[] }> {
  const u = new URL('/api/admin/maintenance/calendar', window.location.origin);
  u.searchParams.set('from', fromISO);
  u.searchParams.set('to', toISO);
  return fetch(u).then((r) => json<{ cells: MaintenanceCell[]; schedules: MaintenanceSchedule[] }>(r));
}
export async function adminMaintenanceRuns(
  fromISO: string,
  toISO: string,
  job: string,
): Promise<{ runs: MaintenanceRunRow[] }> {
  const u = new URL('/api/admin/maintenance/runs', window.location.origin);
  u.searchParams.set('from', fromISO);
  u.searchParams.set('to', toISO);
  u.searchParams.set('job', job);
  return fetch(u).then((r) => json<{ runs: MaintenanceRunRow[] }>(r));
}

export async function adminSetCircleJob(
  cid: string,
  job: MaintenanceJob,
  muted: boolean,
): Promise<void> {
  await fetch(`/api/admin/circles/${cid}/jobs/${job}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ muted }),
  }).then((r) => json(r));
}

export async function adminImportSchedule(
  cid: string,
  gid: string,
  file: File,
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/admin/circles/${cid}/groups/${gid}/import`, {
    method: 'POST',
    body: fd,
  });
  return json(res);
}

// ---------- Circles (schedule) ----------
export async function listCircles(): Promise<Circle[]> {
  return fetch('/api/circles').then((r) => json<Circle[]>(r));
}

export async function listCircleMembers(cid: string): Promise<MemberLite[]> {
  return fetch(`/api/circles/${cid}/members`).then((r) => json<MemberLite[]>(r));
}

export async function getCalendar(
  cid: string,
  fromISO: string,
  toISO: string,
  scope?: string,
): Promise<CalendarOccurrence[]> {
  const u = new URL(`/api/circles/${cid}/calendar`, window.location.origin);
  u.searchParams.set('from', fromISO);
  u.searchParams.set('to', toISO);
  if (scope) u.searchParams.set('scope', scope);
  return fetch(u).then((r) => json<CalendarOccurrence[]>(r));
}

export async function checkConflicts(
  cid: string,
  start: string,
  end: string | null,
  excludeEventId?: string,
  scope?: string,
): Promise<Conflict[]> {
  const u = new URL(`/api/circles/${cid}/conflicts`, window.location.origin);
  u.searchParams.set('start', start);
  if (end) u.searchParams.set('end', end);
  if (excludeEventId) u.searchParams.set('exclude', excludeEventId);
  if (scope) u.searchParams.set('scope', scope);
  return fetch(u).then((r) => json<Conflict[]>(r));
}

export async function getEvent(cid: string, eventId: string): Promise<EventDetail> {
  return fetch(`/api/circles/${cid}/events/${eventId}`).then((r) => json<EventDetail>(r));
}

export async function createEvent(cid: string, payload: EventPayload): Promise<void> {
  await fetch(`/api/circles/${cid}/events`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function updateEvent(
  cid: string,
  eventId: string,
  payload: EventPayload,
): Promise<void> {
  await fetch(`/api/circles/${cid}/events/${eventId}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function deleteEvent(cid: string, eventId: string): Promise<void> {
  await fetch(`/api/circles/${cid}/events/${eventId}`, { method: 'DELETE' }).then((r) => json(r));
}

// ---------- Vacations (circle-scoped) ----------
export async function listVacations(cid: string, includePast = false): Promise<VacationSummary[]> {
  const u = new URL(`/api/circles/${cid}/vacations`, window.location.origin);
  if (includePast) u.searchParams.set('includePast', '1');
  return fetch(u).then((r) => json<VacationSummary[]>(r));
}

export async function getVacation(cid: string, vacationId: string): Promise<VacationDetail> {
  return fetch(`/api/circles/${cid}/vacations/${vacationId}`).then((r) => json<VacationDetail>(r));
}

export async function createVacation(cid: string, payload: VacationPayload): Promise<void> {
  await fetch(`/api/circles/${cid}/vacations`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function updateVacation(
  cid: string,
  vacationId: string,
  payload: Partial<VacationPayload>,
): Promise<void> {
  await fetch(`/api/circles/${cid}/vacations/${vacationId}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function deleteVacation(cid: string, vacationId: string): Promise<void> {
  await fetch(`/api/circles/${cid}/vacations/${vacationId}`, { method: 'DELETE' }).then((r) =>
    json(r),
  );
}

export async function addVacationItem(
  cid: string,
  vacationId: string,
  payload: VacationItemPayload,
): Promise<void> {
  await fetch(`/api/circles/${cid}/vacations/${vacationId}/items`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function updateVacationItem(
  cid: string,
  vacationId: string,
  itemId: string,
  payload: Partial<VacationItemPayload>,
): Promise<void> {
  await fetch(`/api/circles/${cid}/vacations/${vacationId}/items/${itemId}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  }).then((r) => json(r));
}

export async function deleteVacationItem(
  cid: string,
  vacationId: string,
  itemId: string,
): Promise<void> {
  await fetch(`/api/circles/${cid}/vacations/${vacationId}/items/${itemId}`, {
    method: 'DELETE',
  }).then((r) => json(r));
}

// Re-export for convenience.
export type { CircleEmailConfig };
