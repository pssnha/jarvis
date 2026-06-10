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
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
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

/** Find or create a member of a circle by WhatsApp number, email, or name. */
export async function resolveMember(
  circleId: string,
  opts: { waId?: string; email?: string; name?: string },
) {
  if (opts.waId) {
    const hash = phoneHash(opts.waId);
    const existing = await prisma.member.findFirst({ where: { circleId, waHash: hash } });
    if (existing) return existing;
    const { enc } = encryptPhone(opts.waId);
    return prisma.member.create({ data: { circleId, waEnc: enc, waHash: hash, name: opts.name } });
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
  const rows = await prisma.circle.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } });
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
