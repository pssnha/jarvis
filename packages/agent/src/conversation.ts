import { prisma } from '@jarvis/db';
import type { Channel } from '@jarvis/shared';
import type { LlmMessage } from './llm/types';
import { decryptValue, encryptPhone, phoneHash } from './crypto';

/** A conversation thread: a WhatsApp group thread (groupId) or a member's
 *  private DM thread (memberId), within a circle. */
export async function getOrCreateConversation(
  circleId: string,
  channel: Channel,
  opts: { groupId?: string | null; memberId?: string | null } = {},
) {
  const groupId = opts.groupId ?? null;
  const memberId = opts.memberId ?? null;
  const existing = await prisma.conversation.findFirst({
    where: { circleId, channel, groupId, memberId },
    orderBy: { updatedAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.conversation.create({ data: { circleId, channel, groupId, memberId } });
}

export async function loadHistory(conversationId: string, limit = 20): Promise<LlmMessage[]> {
  // Take the most RECENT `limit` messages, then restore chronological order —
  // ordering asc + take returns the oldest rows, so a long conversation would
  // feed the model ancient turns and lose the recent context.
  // Tie-break on id (cuids are monotonic) — a user/assistant pair written in
  // the same millisecond must never come back flipped, or the model sees the
  // last request as unanswered and does it again.
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  rows.reverse();
  return rows.map((r) => ({
    role: r.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: r.authorName && r.role !== 'assistant' ? `${r.authorName}: ${r.content}` : r.content,
  }));
}

export async function appendMessages(
  conversationId: string,
  userText: string,
  assistantText: string,
  authorName?: string,
): Promise<void> {
  await prisma.message.createMany({
    data: [
      { conversationId, role: 'user', content: userText, authorName: authorName ?? null },
      { conversationId, role: 'assistant', content: assistantText },
    ],
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}

// --- Circle / group / member resolution ---

export async function getCircle(circleId: string) {
  return prisma.circle.findUnique({ where: { id: circleId } });
}

/** Oldest circle — used in single-session contexts (Phase 1 admin DM). */
export async function firstCircle() {
  return prisma.circle.findFirst({ orderBy: { createdAt: 'asc' } });
}

/** The circle's primary (oldest) group — where ungrouped/admin events land. */
export async function primaryGroupId(circleId: string): Promise<string | null> {
  const g = await prisma.group.findFirst({ where: { circleId }, orderBy: { createdAt: 'asc' } });
  return g?.id ?? null;
}

export async function getGroupByWhatsappId(whatsappGroupId: string) {
  return prisma.group.findUnique({ where: { whatsappGroupId } });
}

export async function getGroupByTelegramChatId(telegramChatId: string) {
  return prisma.group.findUnique({ where: { telegramChatId } });
}

/** Find an existing circle member by Telegram user id (no create). */
export async function findMemberByTelegram(circleId: string, tgId: string) {
  return prisma.member.findFirst({ where: { circleId, tgId } });
}

/** Circles where this Telegram user is a member, most recently active first. */
export async function circlesForTelegramMember(tgId: string) {
  return prisma.member.findMany({
    where: { tgId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, circleId: true, name: true },
  });
}

/** Find or create a member of a circle by WhatsApp number, Telegram id, email, or name. */
export async function resolveMember(
  circleId: string,
  opts: { waId?: string; tgId?: string; email?: string; name?: string },
) {
  if (opts.waId) {
    const hash = phoneHash(opts.waId);
    const existing = await prisma.member.findFirst({ where: { circleId, waHash: hash } });
    if (existing) return existing;
    const { enc } = encryptPhone(opts.waId);
    return prisma.member.create({ data: { circleId, waEnc: enc, waHash: hash, name: opts.name } });
  }
  if (opts.tgId) {
    const existing = await prisma.member.findFirst({ where: { circleId, tgId: opts.tgId } });
    if (existing) {
      // Backfill a name once we learn it from Telegram.
      if (opts.name && !existing.name) {
        return prisma.member.update({ where: { id: existing.id }, data: { name: opts.name } });
      }
      return existing;
    }
    return prisma.member.create({ data: { circleId, tgId: opts.tgId, name: opts.name } });
  }
  if (opts.email) {
    const existing = await prisma.member.findFirst({ where: { circleId, email: opts.email } });
    if (existing) return existing;
    return prisma.member.create({ data: { circleId, email: opts.email, name: opts.name } });
  }
  return null;
}

/** Find an existing circle member by WhatsApp number (no create). */
export async function findMemberByWhatsApp(circleId: string, number: string) {
  return prisma.member.findFirst({ where: { circleId, waHash: phoneHash(number) } });
}

/** All circle ids (for booting one WhatsApp session per circle). */
export async function allCircleIds(): Promise<string[]> {
  // Soft-deleted circles are dormant — no WhatsApp session, no servicing.
  const rows = await prisma.circle.findMany({
    where: { deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => r.id);
}

/** Find a member of a circle by (partial) name. */
export async function findMemberByName(circleId: string, name: string) {
  const n = name.trim();
  if (!n) return null;
  return prisma.member.findFirst({ where: { circleId, name: { contains: n } } });
}

/** The group ids a member currently belongs to. */
export async function memberGroupIds(memberId: string): Promise<string[]> {
  const rows = await prisma.groupMember.findMany({ where: { memberId }, select: { groupId: true } });
  return rows.map((r) => r.groupId);
}

/** Ensure a member↔group link exists (idempotent). */
export async function ensureGroupMember(groupId: string, memberId: string): Promise<void> {
  await prisma.groupMember.upsert({
    where: { groupId_memberId: { groupId, memberId } },
    update: {},
    create: { groupId, memberId },
  });
}

// --- Telegram linking ---

/** A short, URL-safe code for t.me deep links. */
function newLinkCode(): string {
  return Math.random().toString(36).slice(2, 10);
}

const LINK_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Issue a code to link a Telegram group to this circle (used in /link <code>). */
export async function createCircleTgLinkCode(circleId: string): Promise<string> {
  const tgLinkCode = newLinkCode();
  await prisma.circle.update({
    where: { id: circleId },
    data: { tgLinkCode, tgLinkExpires: new Date(Date.now() + LINK_TTL_MS) },
  });
  return tgLinkCode;
}

/** Issue a code to link an admin's Telegram account (used in /start <code>). */
export async function createAdminTgLinkCode(authUserId: string): Promise<string> {
  const tgLinkCode = newLinkCode();
  await prisma.authUser.update({
    where: { id: authUserId },
    data: { tgLinkCode, tgLinkExpires: new Date(Date.now() + LINK_TTL_MS) },
  });
  return tgLinkCode;
}

/** Bind a Telegram group chat to the circle that issued `code` (if unexpired). */
export async function bindTelegramGroup(code: string, telegramChatId: string, name: string) {
  const circle = await prisma.circle.findFirst({
    where: { tgLinkCode: code, tgLinkExpires: { gt: new Date() } },
  });
  if (!circle) return null;

  // If this Telegram chat is already a group row, reuse it (re-point to circle).
  const existing = await prisma.group.findUnique({ where: { telegramChatId } });
  let group;
  if (existing) {
    group = await prisma.group.update({
      where: { id: existing.id },
      data: { circleId: circle.id },
    });
  } else {
    // Attach Telegram to the circle's existing shared group (oldest one not yet
    // bound to a Telegram chat) so it shares ONE calendar with WhatsApp/web.
    // Only create a new group if the circle has none to attach to.
    const primary = await prisma.group.findFirst({
      where: { circleId: circle.id, telegramChatId: null },
      orderBy: { createdAt: 'asc' },
    });
    group = primary
      ? await prisma.group.update({ where: { id: primary.id }, data: { telegramChatId } })
      : await prisma.group.create({ data: { circleId: circle.id, telegramChatId, name } });
  }
  await prisma.circle.update({
    where: { id: circle.id },
    data: { tgLinkCode: null, tgLinkExpires: null },
  });
  return { circle, group };
}

/** Bind an admin's Telegram id from a /start <code> deep link (if unexpired). */
export async function bindAdminTelegram(code: string, tgId: string) {
  const user = await prisma.authUser.findFirst({
    where: { tgLinkCode: code, tgLinkExpires: { gt: new Date() } },
  });
  if (!user) return null;
  return prisma.authUser.update({
    where: { id: user.id },
    data: { tgId, tgLinkCode: null, tgLinkExpires: null },
  });
}

/** The AuthUser linked to a Telegram id (with their per-circle admin grants). */
export async function authUserByTelegramId(tgId: string) {
  return prisma.authUser.findUnique({
    where: { tgId },
    include: { circleAdminOf: { select: { circleId: true } } },
  });
}

/** Is this WhatsApp number a registered admin (encrypted blind-index match)? */
export async function isAdminWhatsApp(number: string): Promise<boolean> {
  const user = await prisma.authUser.findFirst({
    where: { waHash: phoneHash(number), role: 'admin' },
  });
  return user !== null;
}

/** The global admin's WhatsApp number (decrypted), for owner-DM notifications. */
export async function adminWhatsAppNumber(): Promise<string | null> {
  const admin = await prisma.authUser.findFirst({
    where: { role: 'admin', NOT: { waEnc: null } },
    orderBy: { createdAt: 'asc' },
  });
  return admin?.waEnc ? decryptValue(admin.waEnc) : null;
}

/** The global admin's linked Telegram id, for owner-DM notifications. */
export async function adminTelegramId(): Promise<string | null> {
  const admin = await prisma.authUser.findFirst({
    where: { role: 'admin', NOT: { tgId: null } },
    orderBy: { createdAt: 'asc' },
  });
  return admin?.tgId ?? null;
}

/** Set (or clear) an auth user's WhatsApp number, stored encrypted. */
export async function setUserWhatsApp(userId: string, number: string | null) {
  if (!number) {
    return prisma.authUser.update({ where: { id: userId }, data: { waEnc: null, waHash: null } });
  }
  const { enc, hash } = encryptPhone(number);
  return prisma.authUser.update({ where: { id: userId }, data: { waEnc: enc, waHash: hash } });
}

/** Find a circle a forwarded email belongs to, by matching the sender to a member. */
export async function findCircleByMemberEmail(email: string) {
  const member = await prisma.member.findFirst({ where: { email } });
  if (!member) return null;
  return { member, circleId: member.circleId };
}

/**
 * Ensure a Group exists (under a circle) for a WhatsApp group the circle's
 * number is in. Called by the worker when the device's group list is fetched.
 */
export async function upsertWhatsAppGroup(circleId: string, whatsappGroupId: string, subject: string) {
  const existing = await prisma.group.findUnique({ where: { whatsappGroupId } });
  if (existing) {
    if (subject && existing.name !== subject) {
      return prisma.group.update({ where: { id: existing.id }, data: { name: subject } });
    }
    return existing;
  }
  return prisma.group.create({
    data: { circleId, whatsappGroupId, name: subject || 'WhatsApp group' },
  });
}
