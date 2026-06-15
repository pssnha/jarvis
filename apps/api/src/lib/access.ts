import { prisma, type AuthUser } from '@jarvis/db';

/**
 * Circles whose SCHEDULE DATA a user may access: real membership (email/waHash) ∪
 * per-circle admin grants ∪ any unexpired break-glass support grant they hold.
 * The site `admin` role grants NO implicit access — admins must be a member or
 * unlock time-limited access with the circle's support passphrase.
 */
export async function accessibleScheduleCircleIds(
  user: AuthUser | null | undefined,
): Promise<string[]> {
  if (!user) return [];
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
  const support = await prisma.circleSupportGrant.findMany({
    where: { authUserId: user.id, expiresAt: { gt: new Date() } },
    select: { circleId: true },
  });
  for (const s of support) ids.add(s.circleId);
  return [...ids];
}

/** Whether a user may access a specific circle's schedule data. */
export async function canAccessSchedule(
  user: AuthUser | null | undefined,
  circleId: string,
): Promise<boolean> {
  const ids = await accessibleScheduleCircleIds(user);
  return ids.includes(circleId);
}

/**
 * A real circle insider: a member or per-circle admin of this circle. Excludes
 * the site `admin` role and break-glass grants — used to gate who may set the
 * circle's support passphrase (only the circle's own people).
 */
export async function isCircleInsider(
  user: AuthUser | null | undefined,
  circleId: string,
): Promise<boolean> {
  if (!user) return false;
  const or: Record<string, unknown>[] = [];
  if (user.email) or.push({ email: user.email });
  if (user.waHash) or.push({ waHash: user.waHash });
  if (or.length > 0) {
    const m = await prisma.member.findFirst({ where: { circleId, OR: or }, select: { id: true } });
    if (m) return true;
  }
  const g = await prisma.circleAdmin.findUnique({
    where: { circleId_authUserId: { circleId, authUserId: user.id } },
  });
  return Boolean(g);
}

/**
 * Management rights over a circle (NOT schedule data): the site `admin` role, or
 * a per-circle admin grant. Lets a site admin help (connections, billing, etc.)
 * without seeing the circle's data.
 */
export async function canManageCircle(
  user: AuthUser | null | undefined,
  circleId: string,
): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const g = await prisma.circleAdmin.findUnique({
    where: { circleId_authUserId: { circleId, authUserId: user.id } },
  });
  return Boolean(g);
}
