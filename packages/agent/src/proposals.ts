import { prisma, type EmailProposal } from '@jarvis/db';
import type { EventDraft } from '@jarvis/shared';
import type { AnalyzedProposal, VacationDraft, VacationItemDraft } from './extract';
import { createEvent } from './schedule';
import { getCircle } from './conversation';
import {
  addVacationItem,
  createVacation,
  getVacation,
  listVacations,
  updateVacation,
} from './vacations';
import { toLocalInput } from './datetime';
import { resolveVacationImage } from './vacationImage';

/** Days outside a trip's range still counted as "part of" the trip. */
const VACATION_ADJACENCY_DAYS = 2;

export interface ConfirmResult {
  message: string;
  /** Present when an email item could belong to more than one trip — the caller
   *  must pick a target (a vacation id, or 'new') before it is filed. */
  needsChoice?: {
    proposalId: string;
    summary: string;
    options: { target: string; label: string }[];
  };
}

export interface ProposalMeta {
  fromEmail?: string;
  subject?: string;
  messageId?: string;
}

/** The circle's primary (oldest) group, where email-confirmed events land. */
async function primaryGroupId(circleId: string): Promise<string | null> {
  const g = await prisma.group.findFirst({ where: { circleId }, orderBy: { createdAt: 'asc' } });
  return g?.id ?? null;
}

/** Smallest positive integer not already used by this circle's pending proposals. */
async function nextCode(circleId: string): Promise<string> {
  const pending = await prisma.emailProposal.findMany({
    where: { circleId, status: 'pending' },
    select: { code: true },
  });
  const used = new Set(pending.map((p) => p.code));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

/**
 * Persist detected proposals for a circle (status "pending", not yet notified).
 * De-duplicates on the email Message-ID so re-polling the same mail is a no-op.
 */
export async function createProposals(
  circleId: string,
  analyzed: AnalyzedProposal[],
  meta: ProposalMeta = {},
): Promise<EmailProposal[]> {
  if (analyzed.length === 0) return [];
  if (meta.messageId) {
    const existing = await prisma.emailProposal.count({
      where: { circleId, messageId: meta.messageId },
    });
    if (existing > 0) return [];
  }

  const created: EmailProposal[] = [];
  for (const a of analyzed) {
    const code = await nextCode(circleId);
    const row = await prisma.emailProposal.create({
      data: {
        circleId,
        code,
        kind: a.kind,
        title: a.title,
        summary: a.summary,
        payload: JSON.stringify(a),
        fromEmail: meta.fromEmail ?? null,
        subject: meta.subject ?? null,
        messageId: meta.messageId ?? null,
      },
    });
    created.push(row);
  }
  return created;
}

export async function listPendingProposals(circleId: string): Promise<EmailProposal[]> {
  return prisma.emailProposal.findMany({
    where: { circleId, status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });
}

export async function markNotified(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.emailProposal.updateMany({
    where: { id: { in: ids } },
    data: { notifiedAt: new Date() },
  });
}

/** Create the entity a confirmed proposal describes. Events land in the circle's
 *  primary group; trips on the circle's vacation calendar (merging email items
 *  into an existing trip when their dates fall in/near it). */
export async function confirmProposal(circleId: string, code: string): Promise<string> {
  const p = await prisma.emailProposal.findFirst({ where: { circleId, code, status: 'pending' } });
  if (!p) return `No pending proposal "${code}".`;
  return (await applyConfirm(circleId, p)).message;
}

/** Confirm a specific proposal by id (web Activity log — codes can repeat). An
 *  optional target ('new' or a vacation id) resolves a previous needsChoice. */
export async function confirmProposalById(
  circleId: string,
  id: string,
  target?: string,
): Promise<ConfirmResult> {
  const p = await prisma.emailProposal.findFirst({ where: { id, circleId, status: 'pending' } });
  if (!p) return { message: 'No pending proposal.' };
  return applyConfirm(circleId, p, target);
}

/** Reject a specific proposal by id (web Activity log). */
export async function rejectProposalById(circleId: string, id: string): Promise<string> {
  const p = await prisma.emailProposal.findFirst({ where: { id, circleId, status: 'pending' } });
  if (!p) return 'No pending proposal.';
  await prisma.emailProposal.update({
    where: { id: p.id },
    data: { status: 'rejected', decidedAt: new Date() },
  });
  return `Skipped "${p.title}".`;
}

async function applyConfirm(
  circleId: string,
  p: EmailProposal,
  target?: string,
): Promise<ConfirmResult> {
  const circle = await getCircle(circleId);
  if (!circle) return { message: 'Circle not found.' };
  const zone = circle.timezone;
  const a = JSON.parse(p.payload) as AnalyzedProposal;

  try {
    if (a.kind === 'vacation' && a.vacation) {
      return await confirmVacation(circleId, p, a.vacation, zone, target);
    }
    if (a.draft) {
      // A reservation whose date falls within an existing trip belongs on that
      // trip's itinerary, not the standalone calendar.
      const placed = await confirmEvent(circleId, p, a, a.draft, zone, target);
      return placed;
    }
    return { message: `Proposal "${p.code}" is malformed.` };
  } catch (err) {
    return { message: `Couldn't create "${p.title}": ${(err as Error).message}` };
  }
}

/** File a plain calendar event in the circle's primary group (no trip match). */
async function createCalendarEvent(
  circleId: string,
  p: EmailProposal,
  a: AnalyzedProposal,
  draft: EventDraft,
  zone: string,
): Promise<ConfirmResult> {
  const ev = await createEvent({
    circleId,
    groupId: await primaryGroupId(circleId),
    draft,
    source: 'email',
    timezone: zone,
    sourceRef: p.messageId ?? undefined,
    kind: a.kind === 'event' ? 'event' : 'reminder',
    reminderLeadMinutes: a.kind === 'event' ? (a.reminderLeadMinutes ?? null) : null,
  });
  await finalize(p.id);
  return { message: `Added ${a.kind} "${ev.title}".` };
}

const MEAL_RE =
  /\b(breakfast|brunch|lunch|dinner|restaurant|reservation|dining|bistro|trattoria|osteria|ristorante|caf[eé]|eatery|grill|kitchen|tavern|steakhouse)\b/i;

/** Map an email event-draft onto a trip itinerary item (best-effort type). */
function eventDraftToItem(draft: EventDraft, confirmation?: string): VacationItemDraft {
  return {
    type: MEAL_RE.test(draft.title) ? 'meal' : 'activity',
    title: draft.title,
    startsAt: draft.start,
    endsAt: draft.end,
    location: draft.location,
    confirmation,
  };
}

/**
 * Confirm an event/reminder proposal. If its date falls in (or adjacent to) an
 * existing trip, it's added to that trip's itinerary; otherwise it lands on the
 * calendar. When more than one trip could match, ask which (or the calendar).
 */
async function confirmEvent(
  circleId: string,
  p: EmailProposal,
  a: AnalyzedProposal,
  draft: EventDraft,
  zone: string,
  target?: string,
): Promise<ConfirmResult> {
  // Resolve a prior needsChoice: 'calendar' = keep it off any trip.
  if (target === 'calendar') return createCalendarEvent(circleId, p, a, draft, zone);
  if (target) {
    const v = await getVacation(circleId, target);
    if (!v) return { message: 'That trip no longer exists.' };
    await attachItem(circleId, v, eventDraftToItem(draft), zone);
    await finalize(p.id);
    return { message: `Added "${a.title}" to "${v.title}".` };
  }

  const itemDate = draft.start.slice(0, 10);
  const candidates = await matchingTrips(circleId, itemDate, zone);

  if (candidates.length === 1) {
    await attachItem(circleId, candidates[0]!, eventDraftToItem(draft), zone);
    await finalize(p.id);
    return { message: `Added "${a.title}" to "${candidates[0]!.title}".` };
  }
  if (candidates.length === 0) return createCalendarEvent(circleId, p, a, draft, zone);

  return {
    message: `"${a.title}" (${itemDate}) could belong to more than one trip.`,
    needsChoice: {
      proposalId: p.id,
      summary: `${a.title} · ${itemDate}`,
      options: [
        ...candidates.map((v) => ({
          target: v.id,
          label: `${v.title} (${toLocalInput(v.startDate, zone, true)} → ${toLocalInput(v.endDate, zone, true)})`,
        })),
        { target: 'calendar', label: 'Add to calendar (not a trip)' },
      ],
    },
  };
}

/** Trips whose date range contains (or is adjacent to) the given local date. */
async function matchingTrips(circleId: string, itemDate: string, zone: string) {
  const vacs = await listVacations(circleId, { includePast: true });
  return vacs.filter((v) =>
    inRange(
      itemDate,
      toLocalInput(v.startDate, zone, true),
      toLocalInput(v.endDate, zone, true),
      VACATION_ADJACENCY_DAYS,
    ),
  );
}

async function finalize(id: string): Promise<void> {
  await prisma.emailProposal.update({
    where: { id },
    data: { status: 'confirmed', decidedAt: new Date() },
  });
}

/** True if `dateStr` (yyyy-MM-dd) is inside [start,end] expanded by `adj` days. */
function inRange(dateStr: string, start: string, end: string, adj: number): boolean {
  const d = Date.parse(`${dateStr}T00:00:00Z`);
  const s = Date.parse(`${start}T00:00:00Z`) - adj * 86_400_000;
  const e = Date.parse(`${end}T00:00:00Z`) + adj * 86_400_000;
  return !Number.isNaN(d) && d >= s && d <= e;
}

/** Add an email item to an existing trip, extending the trip's dates if needed. */
async function attachItem(
  circleId: string,
  v: { id: string; title: string; startDate: Date; endDate: Date },
  it: VacationItemDraft,
  zone: string,
): Promise<void> {
  await addVacationItem(
    v.id,
    {
      type: it.type,
      title: it.title,
      startsAt: it.startsAt,
      endsAt: it.endsAt ?? null,
      location: it.location ?? null,
      provider: it.provider ?? null,
      number: it.number ?? null,
      fromLabel: it.fromLabel ?? null,
      toLabel: it.toLabel ?? null,
      seat: it.seat ?? null,
      confirmation: it.confirmation ?? null,
    },
    zone,
  );
  const itemDate = it.startsAt.slice(0, 10);
  const start = toLocalInput(v.startDate, zone, true);
  const end = toLocalInput(v.endDate, zone, true);
  const patch: { startDate?: string; endDate?: string } = {};
  if (itemDate < start) patch.startDate = itemDate;
  if (itemDate > end) patch.endDate = itemDate;
  if (patch.startDate || patch.endDate) await updateVacation(circleId, v.id, patch, zone);
}

async function createTrip(circleId: string, p: EmailProposal, vac: VacationDraft, zone: string) {
  const coverImageUrl = await resolveVacationImage({
    title: vac.title,
    destinations: vac.destinations ?? null,
  }).catch(() => null);
  const v = await createVacation(
    {
      circleId,
      title: vac.title,
      destinations: vac.destinations ?? null,
      startDate: vac.startDate,
      endDate: vac.endDate,
      description: p.subject ? `From email: ${p.subject}` : null,
      coverImageUrl,
    },
    zone,
  );
  if (vac.item) await attachItem(circleId, v, vac.item, zone);
  return v;
}

/** Decide where an email's vacation item belongs: an existing trip (in-range or
 *  adjacent), a new trip, or — when it could fit more than one — ask. */
async function confirmVacation(
  circleId: string,
  p: EmailProposal,
  vac: VacationDraft,
  zone: string,
  target?: string,
): Promise<ConfirmResult> {
  const item = vac.item;

  // Explicit resolution of a prior needsChoice (or a no-item whole-trip).
  if (target === 'new' || !item) {
    const v = await createTrip(circleId, p, vac, zone);
    await finalize(p.id);
    return { message: `Created trip "${v.title}".` };
  }
  if (target) {
    const v = await getVacation(circleId, target);
    if (!v) return { message: 'That trip no longer exists.' };
    await attachItem(circleId, v, item, zone);
    await finalize(p.id);
    return { message: `Added "${item.title}" to "${v.title}".` };
  }

  // Auto-match against existing trips by the item's date.
  const itemDate = (item.startsAt || vac.startDate).slice(0, 10);
  const candidates = await matchingTrips(circleId, itemDate, zone);

  if (candidates.length === 1) {
    await attachItem(circleId, candidates[0]!, item, zone);
    await finalize(p.id);
    return { message: `Added "${item.title}" to "${candidates[0]!.title}".` };
  }
  if (candidates.length === 0) {
    const v = await createTrip(circleId, p, vac, zone);
    await finalize(p.id);
    return { message: `Created trip "${v.title}".` };
  }

  // Ambiguous — ask which trip (leave the proposal pending).
  return {
    message: `"${item.title}" (${itemDate}) could belong to more than one trip.`,
    needsChoice: {
      proposalId: p.id,
      summary: `${item.title} · ${itemDate}`,
      options: [
        ...candidates.map((v) => ({
          target: v.id,
          label: `${v.title} (${toLocalInput(v.startDate, zone, true)} → ${toLocalInput(v.endDate, zone, true)})`,
        })),
        { target: 'new', label: 'New trip' },
      ],
    },
  };
}

export async function rejectProposal(circleId: string, code: string): Promise<string> {
  const p = await prisma.emailProposal.findFirst({ where: { circleId, code, status: 'pending' } });
  if (!p) return `No pending proposal "${code}".`;
  await prisma.emailProposal.update({
    where: { id: p.id },
    data: { status: 'rejected', decidedAt: new Date() },
  });
  return `Skipped "${p.title}".`;
}
