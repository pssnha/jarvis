import { DateTime } from 'luxon';
import { Prisma, prisma, type VacationItem } from '@jarvis/db';
import type { VacationItemType } from '@jarvis/shared';
import { dateKeyInZone, localIsoToUtc, timeLabel, toLocalInput, zonedTimeLabel } from './datetime';

/**
 * Vacations — a self-contained trip planner. Times are stored UTC and rendered
 * in each trip's `timezone` (falling back to the group zone, resolved by the
 * caller and passed in as `zone`). No recurrence, no calendar/reminder coupling.
 */

const include = {
  travelers: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' } },
  _count: { select: { items: true } },
} as const;

// ---------------------------------------------------------------- Vacation CRUD

export interface CreateVacationInput {
  circleId: string;
  title: string;
  destinations?: string | null;
  /** Local date "yyyy-MM-dd" in the trip zone. */
  startDate: string;
  endDate: string;
  /** IANA zone; null = use the circle zone. */
  timezone?: string | null;
  description?: string | null;
  travelerIds?: string[];
  /** Cover photo URL (resolved via the LLM when omitted — see resolveVacationImage). */
  coverImageUrl?: string | null;
}

/** `zone` is the resolved trip zone (input.timezone ?? circle.timezone). */
export async function createVacation(input: CreateVacationInput, zone: string) {
  return prisma.vacation.create({
    data: {
      circleId: input.circleId,
      title: input.title,
      destinations: input.destinations ?? null,
      startDate: localIsoToUtc(input.startDate, zone),
      endDate: localIsoToUtc(input.endDate, zone),
      timezone: input.timezone ?? null,
      description: input.description ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
      travelers: input.travelerIds?.length
        ? { connect: input.travelerIds.map((id) => ({ id })) }
        : undefined,
    },
    include,
  });
}

export async function listVacations(circleId: string, opts?: { includePast?: boolean }) {
  return prisma.vacation.findMany({
    where: {
      circleId,
      ...(opts?.includePast ? {} : { endDate: { gte: startOfToday() } }),
    },
    orderBy: { startDate: 'asc' },
    include,
  });
}

export async function getVacation(circleId: string, vacationId: string) {
  return prisma.vacation.findFirst({
    where: { id: vacationId, circleId },
    include: {
      travelers: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' } },
      items: { orderBy: { startsAt: 'asc' } },
    },
  });
}

export interface UpdateVacationInput {
  title?: string;
  destinations?: string | null;
  /** Local date "yyyy-MM-dd". */
  startDate?: string;
  endDate?: string;
  timezone?: string | null;
  description?: string | null;
  travelerIds?: string[];
  coverImageUrl?: string | null;
}

export async function updateVacation(
  circleId: string,
  vacationId: string,
  patch: UpdateVacationInput,
  zone: string,
) {
  const v = await prisma.vacation.findFirst({ where: { id: vacationId, circleId } });
  if (!v) return null;

  const data: Prisma.VacationUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.destinations !== undefined) data.destinations = patch.destinations;
  if (patch.timezone !== undefined) data.timezone = patch.timezone;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.coverImageUrl !== undefined) data.coverImageUrl = patch.coverImageUrl;
  if (patch.startDate !== undefined) data.startDate = localIsoToUtc(patch.startDate, zone);
  if (patch.endDate !== undefined) data.endDate = localIsoToUtc(patch.endDate, zone);
  if (patch.travelerIds !== undefined) {
    data.travelers = { set: patch.travelerIds.map((id) => ({ id })) };
  }

  return prisma.vacation.update({ where: { id: v.id }, data, include });
}

export async function deleteVacation(circleId: string, vacationId: string) {
  const v = await prisma.vacation.findFirst({ where: { id: vacationId, circleId } });
  if (!v) return null;
  await prisma.vacation.delete({ where: { id: v.id } });
  return v;
}

// -------------------------------------------------------------------- Item CRUD

export interface VacationItemInput {
  type: VacationItemType;
  title: string;
  /** Local ISO "yyyy-MM-ddTHH:mm" (or "yyyy-MM-dd" when allDay). */
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  notes?: string | null;
  confirmation?: string | null;
  provider?: string | null;
  number?: string | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  fromTimezone?: string | null;
  toTimezone?: string | null;
  seat?: string | null;
  phone?: string | null;
  cost?: string | null;
  color?: string | null;
}

/** Normalized title for spotting duplicate items (strip case/punctuation). */
function normTitle(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Outcome of an upsert: whether the item was created, changed, or already current. */
export interface UpsertItemResult {
  item: VacationItem;
  action: 'added' | 'updated' | 'unchanged';
  /** Human-readable "before → after" lines for the meaningful changes (times etc.). */
  changes: string[];
}

/** Text fields that an incoming itinerary may carry; overwritten in place when changed. */
const SCALAR_FIELDS = [
  'title', 'location', 'notes', 'confirmation', 'provider', 'number',
  'fromLabel', 'toLabel', 'fromTimezone', 'toTimezone', 'seat', 'phone', 'cost',
] as const;

/** Short label for the few changes worth surfacing in a notification. */
const CHANGE_LABEL: Partial<Record<(typeof SCALAR_FIELDS)[number], string>> = {
  number: 'flight',
  seat: 'seat',
  confirmation: 'confirmation',
  title: 'title',
};

/**
 * Add an item, or — when it matches one already on the trip — update it in place.
 *
 * Matching: a flight/transport leg is the same when the flight/booking number
 * matches and the time is close (a single PNR can cover many legs, so we never
 * collapse on confirmation alone); other types collapse on a shared confirmation
 * or a near-identical title nearby. On a match we OVERWRITE changed fields —
 * including the departure/arrival times — so a re-sent itinerary with updated
 * times actually updates the trip. Fields the incoming item doesn't supply are
 * left untouched (we never wipe existing detail).
 */
export async function upsertVacationItem(
  vacationId: string,
  input: VacationItemInput,
  zone: string,
): Promise<UpsertItemResult> {
  const startsAt = localIsoToUtc(input.startsAt, input.fromTimezone || zone);
  const endsAt = input.endsAt ? localIsoToUtc(input.endsAt, input.toTimezone || zone) : null;

  const existing = await prisma.vacationItem.findMany({ where: { vacationId, type: input.type } });
  const NEAR_MS = 36 * 3_600_000; // within ~1.5 days
  const isTravel = input.type === 'flight' || input.type === 'transport';
  const dup = existing.find((e) => {
    const near = Math.abs(e.startsAt.getTime() - startsAt.getTime()) < NEAR_MS;
    if (isTravel) {
      // Same vehicle/flight number close in time = the same leg.
      if (input.number && e.number && input.number === e.number && near) return true;
    } else if (input.confirmation && e.confirmation && input.confirmation === e.confirmation) {
      return true;
    }
    // Fallback: same type + nearby + (near-)identical title.
    const nt = normTitle(input.title);
    const en = normTitle(e.title);
    return near && nt.length > 0 && (nt === en || nt.startsWith(en) || en.startsWith(nt));
  });

  if (!dup) {
    const item = await prisma.vacationItem.create({
      data: {
        vacationId,
        type: input.type,
        title: input.title,
        startsAt,
        endsAt,
        allDay: input.allDay ?? false,
        location: input.location ?? null,
        notes: input.notes ?? null,
        confirmation: input.confirmation ?? null,
        provider: input.provider ?? null,
        number: input.number ?? null,
        fromLabel: input.fromLabel ?? null,
        toLabel: input.toLabel ?? null,
        fromTimezone: input.fromTimezone ?? null,
        toTimezone: input.toTimezone ?? null,
        seat: input.seat ?? null,
        phone: input.phone ?? null,
        cost: input.cost ?? null,
        color: input.color ?? null,
      },
    });
    return { item, action: 'added', changes: [] };
  }

  const patch: Prisma.VacationItemUpdateInput = {};
  const changes: string[] = [];
  const fromTz = input.fromTimezone || dup.fromTimezone || zone;
  const toTz = input.toTimezone || dup.toTimezone || fromTz;

  if (dup.startsAt.getTime() !== startsAt.getTime()) {
    patch.startsAt = startsAt;
    changes.push(`departure ${timeLabel(dup.startsAt, fromTz)} → ${timeLabel(startsAt, fromTz)}`);
  }
  // Only touch the end when a new one is supplied (don't wipe an existing arrival).
  if (endsAt && dup.endsAt?.getTime() !== endsAt.getTime()) {
    changes.push(`arrival ${dup.endsAt ? timeLabel(dup.endsAt, toTz) : '—'} → ${timeLabel(endsAt, toTz)}`);
    patch.endsAt = endsAt;
  }

  for (const k of SCALAR_FIELDS) {
    const next = input[k];
    if (next == null || next === dup[k]) continue; // not supplied, or unchanged
    (patch as Record<string, unknown>)[k] = next;
    const label = CHANGE_LABEL[k];
    if (label) changes.push(`${label} ${dup[k] ?? '—'} → ${next}`);
  }

  if (Object.keys(patch).length === 0) return { item: dup, action: 'unchanged', changes: [] };
  const item = await prisma.vacationItem.update({ where: { id: dup.id }, data: patch });
  return { item, action: 'updated', changes };
}

/** Add or update an itinerary item, returning just the resulting row. */
export async function addVacationItem(
  vacationId: string,
  input: VacationItemInput,
  zone: string,
): Promise<VacationItem> {
  const { item } = await upsertVacationItem(vacationId, input, zone);
  return item;
}

export async function updateVacationItem(
  vacationId: string,
  itemId: string,
  patch: Partial<VacationItemInput>,
  zone: string,
) {
  const item = await prisma.vacationItem.findFirst({ where: { id: itemId, vacationId } });
  if (!item) return null;

  const data: Prisma.VacationItemUpdateInput = {};
  if (patch.type !== undefined) data.type = patch.type;
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.allDay !== undefined) data.allDay = patch.allDay;
  if (patch.startsAt !== undefined) {
    data.startsAt = localIsoToUtc(patch.startsAt, patch.fromTimezone || item.fromTimezone || zone);
  }
  if (patch.endsAt !== undefined) {
    data.endsAt = patch.endsAt
      ? localIsoToUtc(patch.endsAt, patch.toTimezone || item.toTimezone || zone)
      : null;
  }
  for (const k of [
    'location',
    'notes',
    'confirmation',
    'provider',
    'number',
    'fromLabel',
    'toLabel',
    'fromTimezone',
    'toTimezone',
    'seat',
    'phone',
    'cost',
    'color',
  ] as const) {
    if (patch[k] !== undefined) data[k] = patch[k];
  }

  return prisma.vacationItem.update({ where: { id: item.id }, data });
}

export async function deleteVacationItem(vacationId: string, itemId: string) {
  const item = await prisma.vacationItem.findFirst({ where: { id: itemId, vacationId } });
  if (!item) return null;
  await prisma.vacationItem.delete({ where: { id: item.id } });
  return item;
}

// ------------------------------------------------------------ Itinerary expand

export interface ItineraryItemDTO {
  id: string;
  type: VacationItemType;
  title: string;
  /** yyyy-MM-dd of startsAt in the trip zone. */
  dateKey: string;
  startLocal: string;
  endLocal: string | null;
  timeLabel: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  confirmation: string | null;
  provider: string | null;
  number: string | null;
  fromLabel: string | null;
  toLabel: string | null;
  fromTimezone: string | null;
  toTimezone: string | null;
  /** Departure time in the origin zone (transit only), e.g. "1:30 PM PDT". */
  departLabel: string | null;
  /** Arrival time in the destination zone (transit only). */
  arriveLabel: string | null;
  seat: string | null;
  phone: string | null;
  cost: string | null;
  color: string | null;
}

export interface ItineraryDay {
  dateKey: string;
  items: ItineraryItemDTO[];
}

export function toItineraryItemDTO(
  item: {
    id: string;
    type: string;
    title: string;
    startsAt: Date;
    endsAt: Date | null;
    allDay: boolean;
    location: string | null;
    notes: string | null;
    confirmation: string | null;
    provider: string | null;
    number: string | null;
    fromLabel: string | null;
    toLabel: string | null;
    fromTimezone: string | null;
    toTimezone: string | null;
    seat: string | null;
    phone: string | null;
    cost: string | null;
    color: string | null;
  },
  zone: string,
): ItineraryItemDTO {
  // For transit items in a different zone, label departure/arrival in their own zones.
  const departLabel =
    !item.allDay && item.fromTimezone ? zonedTimeLabel(item.startsAt, item.fromTimezone) : null;
  const arriveLabel =
    !item.allDay && item.toTimezone && item.endsAt
      ? zonedTimeLabel(item.endsAt, item.toTimezone)
      : null;
  return {
    id: item.id,
    type: item.type as VacationItemType,
    title: item.title,
    dateKey: dateKeyInZone(item.startsAt, item.fromTimezone || zone),
    startLocal: toLocalInput(item.startsAt, zone, item.allDay),
    endLocal: item.endsAt ? toLocalInput(item.endsAt, zone, item.allDay) : null,
    timeLabel: item.allDay ? 'all day' : timeLabel(item.startsAt, zone),
    allDay: item.allDay,
    location: item.location,
    notes: item.notes,
    confirmation: item.confirmation,
    provider: item.provider,
    number: item.number,
    fromLabel: item.fromLabel,
    toLabel: item.toLabel,
    fromTimezone: item.fromTimezone,
    toTimezone: item.toTimezone,
    departLabel,
    arriveLabel,
    seat: item.seat,
    phone: item.phone,
    cost: item.cost,
    color: item.color,
  };
}

/**
 * Items grouped by trip-zone dateKey, covering every calendar day from
 * `startDate` to `endDate` inclusive (empty days still produce a tab).
 */
export async function expandItinerary(vacationId: string, zone: string): Promise<ItineraryDay[]> {
  const vacation = await prisma.vacation.findUnique({
    where: { id: vacationId },
    include: { items: { orderBy: { startsAt: 'asc' } } },
  });
  if (!vacation) return [];

  const days: ItineraryDay[] = [];
  const byKey = new Map<string, ItineraryItemDTO[]>();

  let cursor = DateTime.fromJSDate(vacation.startDate).setZone(zone).startOf('day');
  const last = DateTime.fromJSDate(vacation.endDate).setZone(zone).startOf('day');
  // Guard against bad ranges; cap at ~1 year of days.
  for (let i = 0; i <= 366 && cursor <= last; i++) {
    const key = cursor.toFormat('yyyy-MM-dd');
    const bucket: ItineraryItemDTO[] = [];
    byKey.set(key, bucket);
    days.push({ dateKey: key, items: bucket });
    cursor = cursor.plus({ days: 1 });
  }

  for (const item of vacation.items) {
    const dto = toItineraryItemDTO(item, zone);
    const bucket = byKey.get(dto.dateKey);
    if (bucket) bucket.push(dto);
    else {
      // Item outside the declared trip range — surface it on its own day.
      days.push({ dateKey: dto.dateKey, items: [dto] });
    }
  }
  days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return days;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
