import { analyzeItinerary, type ParsedItinerary } from './extract';
import type { LlmDocument } from './llm/types';
import { dateKeyInZone } from './datetime';
import {
  createVacation,
  deleteVacationItem,
  getVacation,
  listVacations,
  updateVacation,
  upsertVacationItem,
  type VacationItemInput,
} from './vacations';

/** Outcome of applying a parsed itinerary to a circle's trips. */
export interface ApplyItineraryResult {
  vacationId: string;
  vacationTitle: string;
  /** True when a brand-new trip was created (vs. updating an existing one). */
  created: boolean;
  added: number;
  updated: number;
  unchanged: number;
  /** Items removed by replace mode (superseded by the new itinerary). */
  removed: number;
  /** Human-readable per-item lines for a notification. */
  lines: string[];
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Tokens (cities/words) shared between two destination/title strings. */
function tokens(...parts: (string | null | undefined)[]): Set<string> {
  const set = new Set<string>();
  for (const p of parts) {
    for (const t of (p ?? '').toLowerCase().split(/[^a-z]+/)) {
      if (t.length >= 3) set.add(t);
    }
  }
  return set;
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}

function toInput(d: ParsedItinerary['items'][number]): VacationItemInput {
  return {
    type: d.type,
    title: d.title,
    startsAt: d.startsAt,
    endsAt: d.endsAt ?? null,
    location: d.location ?? null,
    provider: d.provider ?? null,
    number: d.number ?? null,
    fromLabel: d.fromLabel ?? null,
    toLabel: d.toLabel ?? null,
    fromTimezone: d.fromTimezone ?? null,
    toTimezone: d.toTimezone ?? null,
    seat: d.seat ?? null,
    confirmation: d.confirmation ?? null,
    notes: d.notes ?? null,
  };
}

function itemLabel(d: ParsedItinerary['items'][number]): string {
  if ((d.type === 'flight' || d.type === 'transport') && (d.fromLabel || d.toLabel)) {
    const route = [d.fromLabel, d.toLabel].filter(Boolean).join(' → ');
    return d.number ? `${d.number} ${route}` : route || d.title;
  }
  return d.title;
}

/**
 * Find the trip a parsed itinerary belongs to, or create one.
 *
 * Matching, strongest first:
 *  1. an existing trip whose items share a flight/booking number or PNR with the
 *     parsed itinerary (the reliable "this is the same trip, updated" signal);
 *  2. otherwise a single trip whose dates overlap (disambiguated by destination).
 * If nothing matches we create a new trip rather than risk editing the wrong one.
 */
async function resolveTrip(
  circleId: string,
  parsed: ParsedItinerary,
  circleZone: string,
): Promise<{ vacationId: string; zone: string; created: boolean }> {
  const candidates = await listVacations(circleId, { includePast: true });

  const parsedNumbers = new Set(parsed.items.map((i) => norm(i.number)).filter(Boolean));
  const parsedConfs = new Set(parsed.items.map((i) => norm(i.confirmation)).filter(Boolean));

  let best: { id: string; timezone: string | null } | null = null;
  let bestScore = 0;
  const dateOverlap: { id: string; timezone: string | null; shares: boolean }[] = [];

  const pStart = new Date(`${parsed.startDate}T00:00:00Z`);
  const pEnd = new Date(`${parsed.endDate}T00:00:00Z`);
  const pTokens = tokens(parsed.destinations, parsed.title);

  for (const c of candidates) {
    const full = await getVacation(circleId, c.id);
    if (!full) continue;
    let score = 0;
    for (const it of full.items) {
      if (it.number && parsedNumbers.has(norm(it.number))) score += 2;
      if (it.confirmation && parsedConfs.has(norm(it.confirmation))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { id: c.id, timezone: c.timezone };
    }
    if (rangesOverlap(pStart, pEnd, c.startDate, c.endDate)) {
      const cTokens = tokens(c.destinations, c.title);
      const shares = [...pTokens].some((t) => cTokens.has(t));
      dateOverlap.push({ id: c.id, timezone: c.timezone, shares });
    }
  }

  if (best && bestScore > 0) {
    return { vacationId: best.id, zone: best.timezone ?? circleZone, created: false };
  }

  // No booking-number match: fall back to a single unambiguous date overlap.
  const pick =
    dateOverlap.length === 1
      ? dateOverlap[0]
      : dateOverlap.filter((d) => d.shares).length === 1
        ? dateOverlap.find((d) => d.shares)!
        : null;
  if (pick) return { vacationId: pick.id, zone: pick.timezone ?? circleZone, created: false };

  const zone = parsed.timezone ?? circleZone;
  const v = await createVacation(
    {
      circleId,
      title: parsed.title,
      destinations: parsed.destinations ?? null,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      timezone: parsed.timezone ?? null,
    },
    zone,
  );
  return { vacationId: v.id, zone, created: true };
}

/** Apply a parsed itinerary: upsert every item onto the matched (or new) trip. */
export async function applyItinerary(
  circleId: string,
  parsed: ParsedItinerary,
  circleZone: string,
  opts?: { replace?: boolean },
): Promise<ApplyItineraryResult> {
  const { vacationId, zone, created } = await resolveTrip(circleId, parsed, circleZone);

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let removed = 0;
  const lines: string[] = [];

  // Track what this upload touched so replace mode can retire only the items it
  // superseded — by item id, the days it covers, and the types it carries.
  const keptIds = new Set<string>();
  const coveredDays = new Set<string>();
  const coveredTypes = new Set<string>();

  for (const draft of parsed.items) {
    const res = await upsertVacationItem(vacationId, toInput(draft), zone);
    keptIds.add(res.item.id);
    coveredDays.add(dateKeyInZone(res.item.startsAt, zone));
    coveredTypes.add(res.item.type);
    const label = itemLabel(draft);
    if (res.action === 'added') {
      added++;
      lines.push(`➕ ${label}`);
    } else if (res.action === 'updated') {
      updated++;
      lines.push(`✏️ ${label}${res.changes.length ? ` — ${res.changes.join(', ')}` : ''}`);
    } else {
      unchanged++;
    }
  }

  // Replace mode: a full itinerary upload is the source of truth, so remove the
  // trip's now-superseded items — but ONLY those of a type the upload carries, on
  // a day it covers, that it didn't itself add/update. This retires flights that
  // were rebooked onto different numbers without touching unrelated items or days
  // the upload never mentions. New trips have nothing to reconcile.
  if (opts?.replace && !created && keptIds.size > 0) {
    const full = await getVacation(circleId, vacationId);
    for (const e of full?.items ?? []) {
      if (keptIds.has(e.id)) continue;
      if (!coveredTypes.has(e.type as ParsedItinerary['items'][number]['type'])) continue;
      if (!coveredDays.has(dateKeyInZone(e.startsAt, zone))) continue;
      await deleteVacationItem(vacationId, e.id);
      removed++;
      lines.push(`➖ ${e.title}`);
    }
  }

  // Grow the trip's date range to cover any items that fall outside it (never shrink).
  if (!created) {
    const v = await getVacation(circleId, vacationId);
    if (v) {
      const itemDays = v.items.map((i) => dateKeyInZone(i.startsAt, zone));
      const start = [dateKeyInZone(v.startDate, zone), ...itemDays].sort()[0];
      const end = [dateKeyInZone(v.endDate, zone), ...itemDays].sort().reverse()[0];
      if (start !== dateKeyInZone(v.startDate, zone) || end !== dateKeyInZone(v.endDate, zone)) {
        await updateVacation(circleId, vacationId, { startDate: start, endDate: end }, zone);
      }
    }
  }

  const v = await getVacation(circleId, vacationId);
  return {
    vacationId,
    vacationTitle: v?.title ?? parsed.title,
    created,
    added,
    updated,
    unchanged,
    removed,
    lines,
  };
}

export interface IngestItineraryOptions {
  circleId: string;
  /** The circle's time zone (fallback when a trip has none). */
  zone: string;
  documents: LlmDocument[];
  /** Optional accompanying text (email subject, caption). */
  context?: string;
  /** Usage attribution: email | whatsapp | web. */
  source?: string;
  /**
   * Treat this document as the trip's full itinerary: also remove flights it
   * supersedes (see applyItinerary). Set for document uploads (PDF/image), which
   * are complete itineraries; leave off for partial single-booking sources.
   */
  replace?: boolean;
}

export interface IngestItineraryResult {
  ok: boolean;
  message: string;
  result?: ApplyItineraryResult;
}

/**
 * End-to-end ingest used by every surface (email, WhatsApp, web): parse an
 * itinerary document, apply it, and return a human summary to send back.
 */
export async function ingestItineraryDocument(
  opts: IngestItineraryOptions,
): Promise<IngestItineraryResult> {
  const parsed = await analyzeItinerary({
    documents: opts.documents,
    timezone: opts.zone,
    context: opts.context,
    circleId: opts.circleId,
    source: opts.source,
  });
  if (!parsed) {
    return { ok: false, message: "I couldn't find a travel itinerary in that file." };
  }

  const result = await applyItinerary(opts.circleId, parsed, opts.zone, { replace: opts.replace });
  const header = result.created
    ? `🧳 Added trip *${result.vacationTitle}*`
    : `🧳 Updated *${result.vacationTitle}*`;

  if (result.lines.length === 0) {
    return {
      ok: true,
      message: `${header} — everything was already up to date.`,
      result,
    };
  }
  return { ok: true, message: `${header}\n${result.lines.join('\n')}`, result };
}
