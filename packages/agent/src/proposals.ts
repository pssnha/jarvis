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

/** A pending proposal not acted on within this many days goes stale. */
const PROPOSAL_TTL_DAYS = 7;

function staleCutoff(): Date {
  return new Date(Date.now() - PROPOSAL_TTL_DAYS * 86_400_000);
}

/** Pending proposals still worth acting on (recent). Old, never-decided ones are
 *  excluded so a later "add all" can't sweep up a stale backlog. */
export async function listPendingProposals(circleId: string): Promise<EmailProposal[]> {
  return prisma.emailProposal.findMany({
    where: { circleId, status: 'pending', createdAt: { gte: staleCutoff() } },
    orderBy: { createdAt: 'asc' },
  });
}

/** Mark never-decided proposals older than the TTL as expired (housekeeping run
 *  at poll time) so they leave the pending set for good. */
export async function expireStaleProposals(circleId: string): Promise<number> {
  const r = await prisma.emailProposal.updateMany({
    where: { circleId, status: 'pending', createdAt: { lt: staleCutoff() } },
    data: { status: 'expired', decidedAt: new Date() },
  });
  return r.count;
}

export async function markNotified(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.emailProposal.updateMany({
    where: { id: { in: ids } },
    data: { notifiedAt: new Date() },
  });
}

// --------------------------------------------------------------------------
// Deterministic parsing of a "confirm/reject these proposals" reply.
//
// Notifications present pending items by number ("[1] …", "[2] …"). Mapping a
// reply like "add 1 and 2" back to those codes must NOT go through the LLM: the
// conversation history accumulates months of old numbered lists (codes that
// were long since decided), and the model anchors on that stale numbering
// instead of the current pending set — refusing a valid "add 1 and 2" because
// it "sees" an old 18–23 list. We resolve numeric confirm/reject replies here,
// strictly against the codes pending right now, and only fall back to the LLM
// for genuinely free-form messages.
// --------------------------------------------------------------------------

const CONFIRM_VERBS = new Set(['add', 'confirm', 'accept', 'approve', 'yes', 'y', 'yeah', 'yep', 'yup', 'ok', 'okay', 'keep', 'sure']);
const REJECT_VERBS = new Set(['no', 'n', 'nope', 'skip', 'reject', 'decline', 'ignore', 'dont', 'not']);
const ALL_WORDS = new Set(['all', 'both', 'everything', 'them', 'these', 'those', 'every']);
/** Harmless connective words allowed inside a command without aborting it. */
const FILLER_WORDS = new Set([
  'and', 'plus', 'also', 'then', 'the', 'to', 'of', 'for', 'me', 'a', 'an', 'just',
  'please', 'pls', 'thanks', 'thx', 'item', 'items', 'number', 'numbers', 'calendar',
  'proposal', 'proposals', 'my', 'our',
]);

export interface ProposalCommand {
  /** Pending codes to confirm. */
  confirm: string[];
  /** Pending codes to reject. */
  reject: string[];
  /** Referenced numbers that are NOT in the current pending set. */
  unknown: string[];
}

/**
 * Parse a numeric confirm/reject reply against the codes pending right now.
 * Returns null when the message isn't an unambiguous confirm/reject command
 * (any unrecognised word aborts it) so the caller can defer to the LLM.
 */
export function resolveProposalCommand(
  text: string,
  pendingCodes: string[],
): ProposalCommand | null {
  const pending = new Set(pendingCodes);
  if (pending.size === 0) return null;

  // Drop a "Name: " sender prefix, normalise, and tokenise on non-alphanumerics.
  const body = text.replace(/^[^:]{1,40}:\s/, '').toLowerCase().replace(/#/g, ' ');
  const tokens = body.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let mode: 'confirm' | 'reject' | null = null;
  let sawVerb = false;
  let sawTarget = false; // an explicit number or "all"
  const confirm = new Set<string>();
  const reject = new Set<string>();
  const unknown = new Set<string>();

  for (const tok of tokens) {
    if (CONFIRM_VERBS.has(tok)) {
      mode = 'confirm';
      sawVerb = true;
    } else if (REJECT_VERBS.has(tok)) {
      mode = 'reject';
      sawVerb = true;
    } else if (ALL_WORDS.has(tok)) {
      if (!mode) return null; // "all" with no verb → ambiguous
      sawTarget = true;
      for (const c of pending) (mode === 'confirm' ? confirm : reject).add(c);
    } else if (/^\d+$/.test(tok)) {
      if (!mode) return null; // a bare number with no verb → let the LLM decide
      sawTarget = true;
      const code = String(Number(tok)); // normalise "02" → "2"
      if (pending.has(code)) (mode === 'confirm' ? confirm : reject).add(code);
      else unknown.add(code);
    } else if (!FILLER_WORDS.has(tok)) {
      return null; // any real word we don't recognise → not a plain command
    }
  }

  // Require an explicit target (a number or "all"): a bare "yes"/"no"/"add" is
  // too easily an answer to some other question the assistant asked — let the
  // LLM handle those with full context. Numeric replies are the failure case.
  if (!sawVerb || !sawTarget) return null;
  // A code named on both sides: rejection wins (explicit "no" is the safer read).
  for (const c of reject) confirm.delete(c);

  if (confirm.size === 0 && reject.size === 0 && unknown.size === 0) return null;
  return { confirm: [...confirm], reject: [...reject], unknown: [...unknown] };
}

/** Execute a resolved confirm/reject command, returning a plain reply to send. */
export async function executeProposalCommand(
  circleId: string,
  cmd: ProposalCommand,
  pendingCodes: string[],
): Promise<string> {
  const lines: string[] = [];
  for (const code of cmd.confirm) lines.push(await confirmProposal(circleId, code));
  for (const code of cmd.reject) lines.push(await rejectProposal(circleId, code));
  if (cmd.unknown.length > 0) {
    const items = cmd.unknown.length === 1 ? 'an item' : 'items';
    lines.push(
      `I don't have ${items} numbered ${cmd.unknown.join(', ')} — the current list is ${pendingCodes.join(', ')}.`,
    );
  }
  return lines.join('\n');
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

  // Only a one-off event that falls strictly WITHIN a trip's dates is a trip
  // item. A recurring event (e.g. a weekly class) or one merely near a trip
  // (the day before/after) stays on the calendar — the ±2-day adjacency used
  // for travel bookings is too loose for arbitrary events.
  const itemDate = draft.start.slice(0, 10);
  const candidates = draft.recurrence ? [] : await matchingTrips(circleId, itemDate, zone, 0);

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

/** Trips whose date range contains the given local date. `adj` expands the
 *  range by N days each side (default for travel bookings; pass 0 for a strict
 *  in-range match). */
async function matchingTrips(circleId: string, itemDate: string, zone: string, adj = VACATION_ADJACENCY_DAYS) {
  const vacs = await listVacations(circleId, { includePast: true });
  return vacs.filter((v) =>
    inRange(itemDate, toLocalInput(v.startDate, zone, true), toLocalInput(v.endDate, zone, true), adj),
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

/** Add an email item to an existing trip, extending the trip's dates if needed.
 *  Times are interpreted in the trip's own zone (falling back to `zone`), so an
 *  item imported into a trip reads in the destination's local time. */
async function attachItem(
  circleId: string,
  v: { id: string; title: string; startDate: Date; endDate: Date; timezone?: string | null },
  it: VacationItemDraft,
  zone: string,
): Promise<void> {
  const tz = v.timezone ?? zone;
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
      fromTimezone: it.fromTimezone ?? null,
      toTimezone: it.toTimezone ?? null,
      seat: it.seat ?? null,
      confirmation: it.confirmation ?? null,
    },
    tz,
  );
  const itemDate = it.startsAt.slice(0, 10);
  const start = toLocalInput(v.startDate, tz, true);
  const end = toLocalInput(v.endDate, tz, true);
  const patch: { startDate?: string; endDate?: string } = {};
  if (itemDate < start) patch.startDate = itemDate;
  if (itemDate > end) patch.endDate = itemDate;
  if (patch.startDate || patch.endDate) await updateVacation(circleId, v.id, patch, tz);
}

async function createTrip(circleId: string, p: EmailProposal, vac: VacationDraft, zone: string) {
  const coverImageUrl = await resolveVacationImage({
    title: vac.title,
    destinations: vac.destinations ?? null,
  }).catch(() => null);
  // Show the trip in its destination's zone; fall back to the circle zone.
  const tz = vac.timezone ?? zone;
  const v = await createVacation(
    {
      circleId,
      title: vac.title,
      destinations: vac.destinations ?? null,
      startDate: vac.startDate,
      endDate: vac.endDate,
      timezone: vac.timezone ?? null,
      description: p.subject ? `From email: ${p.subject}` : null,
      coverImageUrl,
    },
    tz,
  );
  if (vac.item) await attachItem(circleId, v, vac.item, tz);
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
