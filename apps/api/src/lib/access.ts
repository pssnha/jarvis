import { prisma, type AuthUser } from '@jarvis/db';

/** Circle ids a user may access: site admins → 'all'; otherwise circles they're
 *  a member of (matched by email/waHash) plus any they're a per-circle admin of. */
export async function accessibleCircleIds(
  user: AuthUser | null | undefined,
): Promise<string[] | 'all'> {
  if (!user) return [];
  if (user.role === 'admin') return 'all';
  const ids = new Set<string>();
  const or: Record<string, unknown>[] = [];
  if (user.email) or.push({ email: user.email });
  if (user.waHash) or.push({ waHash: user.waHash });
  if (or.length > 0) {
    const members = await prisma.member.findMany({ where: { OR: or }, select: { circleId: true } });
    for (const m of members) ids.add(m.circleId);
  }
  const grants = await prisma.circleAdmin.findMany({
    where: { authUserId: user.id },
    select: { circleId: true },
  });
  for (const g of grants) ids.add(g.circleId);
  return [...ids];
}

/** Whether a user may access a specific circle. */
export async function canAccessCircle(
  user: AuthUser | null | undefined,
  circleId: string,
): Promise<boolean> {
  const ids = await accessibleCircleIds(user);
  return ids === 'all' || ids.includes(circleId);
}
