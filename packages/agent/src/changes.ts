import { Prisma, prisma, type Event } from '@jarvis/db';

/**
 * Event change feed: every Event mutation appends an `EventChange` row in the same
 * transaction as the write, so the feed can't drift from the calendar. External
 * agents page through it by sequence id (`list_event_changes`) instead of polling.
 */

export type ChangeType = 'created' | 'updated' | 'deleted';

/** Prune anything older than this; the feed promises at least 30 days. */
export const CHANGE_RETENTION_DAYS = 35;
/** Hide entries younger than this: auto-increment ids are assigned at insert, not
 *  commit, so a reader racing an open transaction could otherwise step past it. */
export const CHANGE_SETTLE_MS = 5_000;

type Db = Prisma.TransactionClient | typeof prisma;

/** Public event object (snake_case) for MCP responses and change snapshots.
 *  `rawText`/`sourceRef` stay out: they can hold whole forwarded emails. */
export function eventObject(ev: Event) {
  return {
    id: ev.id,
    circle_id: ev.circleId,
    group_id: ev.groupId,
    owner_member_id: ev.ownerMemberId,
    title: ev.title,
    description: ev.description,
    starts_at: ev.startsAt.toISOString(),
    ends_at: ev.endsAt?.toISOString() ?? null,
    all_day: ev.allDay,
    location: ev.location,
    kind: ev.kind,
    category: ev.category,
    color: ev.color,
    rrule: ev.rrule,
    reminder_lead_minutes: ev.reminderLeadMinutes,
    recurrence_parent_id: ev.recurrenceParentId,
    recurrence_start: ev.recurrenceStart?.toISOString() ?? null,
    cancelled: ev.cancelled,
    assignee_id: ev.assigneeId,
    created_by_id: ev.createdById,
    source: ev.source,
    created_at: ev.createdAt.toISOString(),
    updated_at: ev.updatedAt.toISOString(),
  };
}
export type EventObject = ReturnType<typeof eventObject>;

/** Append one change. An override row (single occurrence of a series) is reported
 *  against its series id with the instance's original start; pass `occurrence`
 *  when the snapshot is the series itself (an instance reverting to it). */
export async function recordChange(
  db: Db,
  type: ChangeType,
  ev: Event,
  occurrence?: { seriesId: string; start: Date },
): Promise<void> {
  const occ =
    occurrence ??
    (ev.recurrenceParentId && ev.recurrenceStart
      ? { seriesId: ev.recurrenceParentId, start: ev.recurrenceStart }
      : null);
  await db.eventChange.create({
    data: {
      circleId: ev.circleId,
      type,
      eventId: occ?.seriesId ?? ev.id,
      occurrenceStart: occ?.start ?? null,
      groupId: ev.groupId,
      ownerMemberId: ev.ownerMemberId,
      event: eventObject(ev),
    },
  });
}

/** One circle the reader may see, and which member's private events are theirs. */
export interface ChangeReader {
  circleId: string;
  memberId: string | null;
}

export interface ChangeEntry {
  seq: number;
  at: string;
  circle_id: string;
  type: ChangeType;
  event_id: string;
  occurrence_start: string | null;
  event: EventObject;
}

export type ChangePage =
  | { expired: true }
  | { expired: false; changes: ChangeEntry[]; next_cursor: number; has_more: boolean };

/**
 * Changes after `since` (exclusive; 0 = oldest retained) across the reader's
 * circles, in sequence order. Same visibility as the family read scope: shared
 * group events plus the reader's own private ones. A cursor older than the
 * retained window is reported as expired so the client resyncs instead of
 * silently missing pruned entries.
 */
export async function listChanges(
  readers: ChangeReader[],
  since: number,
  limit: number,
): Promise<ChangePage> {
  if (since > 0) {
    // Ids are global, and pruning is by age across every circle, so a gap below
    // the oldest retained id means entries the cursor never saw were pruned.
    const oldest = await prisma.eventChange.findFirst({
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (oldest && BigInt(since) < oldest.id - 1n) return { expired: true };
  }
  if (readers.length === 0)
    return { expired: false, changes: [], next_cursor: since, has_more: false };

  const rows = await prisma.eventChange.findMany({
    where: {
      id: { gt: BigInt(since) },
      createdAt: { lte: new Date(Date.now() - CHANGE_SETTLE_MS) },
      OR: readers.map((r) => ({
        circleId: r.circleId,
        OR: [{ groupId: { not: null } }, ...(r.memberId ? [{ ownerMemberId: r.memberId }] : [])],
      })),
    },
    orderBy: { id: 'asc' },
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    expired: false,
    changes: page.map((r) => ({
      seq: Number(r.id),
      at: r.createdAt.toISOString(),
      circle_id: r.circleId,
      type: r.type as ChangeType,
      event_id: r.eventId,
      occurrence_start: r.occurrenceStart?.toISOString() ?? null,
      event: r.event as EventObject,
    })),
    next_cursor: page.length > 0 ? Number(page[page.length - 1].id) : since,
    has_more: rows.length > limit,
  };
}

/** Drop entries past the retention window (daily worker job). */
export async function pruneChanges(): Promise<number> {
  const cutoff = new Date(Date.now() - CHANGE_RETENTION_DAYS * 86_400_000);
  const { count } = await prisma.eventChange.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}

/**
 * Delete a member and log what the cascade does to the calendar: their private
 * events go (deleted), and events they were assigned to or created lose that
 * link (updated, via SetNull).
 */
export async function deleteMemberWithChanges(memberId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const owned = await tx.event.findMany({ where: { ownerMemberId: memberId } });
    const linked = await tx.event.findMany({
      where: {
        AND: [
          { OR: [{ assigneeId: memberId }, { createdById: memberId }] },
          // `not` alone skips NULL owners in SQL, and shared events have a NULL owner.
          { OR: [{ ownerMemberId: null }, { NOT: { ownerMemberId: memberId } }] },
        ],
      },
      select: { id: true },
    });
    await tx.member.delete({ where: { id: memberId } });
    for (const ev of owned) await recordChange(tx, 'deleted', ev);
    const ids = linked.map((e) => e.id);
    if (ids.length > 0) {
      for (const ev of await tx.event.findMany({ where: { id: { in: ids } } })) {
        await recordChange(tx, 'updated', ev);
      }
    }
  });
}
