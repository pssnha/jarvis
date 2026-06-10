import { Prisma, prisma } from '@jarvis/db';

/**
 * What a calendar view is scoped to within a circle:
 * - group: one WhatsApp group's shared calendar
 * - individual: a member's merged calendar (all their groups + their private events)
 * - circle: everything in the circle (admin / circle-wide)
 */
export type ScheduleScope =
  | { circleId: string; kind: 'group'; groupId: string }
  | { circleId: string; kind: 'individual'; memberId: string }
  | { circleId: string; kind: 'circle' };

/** The Prisma `Event.where` for a scope. */
export async function scopeWhere(scope: ScheduleScope): Promise<Prisma.EventWhereInput> {
  if (scope.kind === 'group') {
    return { circleId: scope.circleId, groupId: scope.groupId };
  }
  if (scope.kind === 'circle') {
    return { circleId: scope.circleId };
  }
  // individual: events of every group the member is in, plus their private events.
  const rows = await prisma.groupMember.findMany({
    where: { memberId: scope.memberId },
    select: { groupId: true },
  });
  const groupIds = rows.map((r) => r.groupId);
  return {
    circleId: scope.circleId,
    OR: [{ groupId: { in: groupIds } }, { ownerMemberId: scope.memberId }],
  };
}
