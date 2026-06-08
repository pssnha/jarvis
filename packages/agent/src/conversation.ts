import { prisma } from '@jarvis/db';
import type { Channel } from '@jarvis/shared';
import type { LlmMessage } from './llm/types';
import { encryptPhone, phoneHash } from './crypto';

export async function getOrCreateConversation(groupId: string, channel: Channel) {
  const existing = await prisma.conversation.findFirst({
    where: { groupId, channel },
    orderBy: { updatedAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.conversation.create({ data: { groupId, channel } });
}

export async function loadHistory(conversationId: string, limit = 20): Promise<LlmMessage[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  return rows.map((r) => ({
    role: r.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content:
      r.authorName && r.role !== 'assistant' ? `${r.authorName}: ${r.content}` : r.content,
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

// --- Group & member resolution ---

export async function getGroupByWhatsappId(whatsappGroupId: string) {
  return prisma.group.findUnique({ where: { whatsappGroupId } });
}

export async function resolveMember(
  groupId: string,
  opts: { waId?: string; email?: string; name?: string },
) {
  if (opts.waId) {
    const hash = phoneHash(opts.waId);
    const existing = await prisma.member.findFirst({ where: { groupId, waHash: hash } });
    if (existing) return existing;
    const { enc } = encryptPhone(opts.waId);
    return prisma.member.create({ data: { groupId, waEnc: enc, waHash: hash, name: opts.name } });
  }
  if (opts.email) {
    const existing = await prisma.member.findFirst({ where: { groupId, email: opts.email } });
    if (existing) return existing;
    return prisma.member.create({ data: { groupId, email: opts.email, name: opts.name } });
  }
  return null;
}

/** Is this WhatsApp number a registered admin (encrypted blind-index match)? */
export async function isAdminWhatsApp(number: string): Promise<boolean> {
  const user = await prisma.authUser.findFirst({
    where: { waHash: phoneHash(number), role: 'admin' },
  });
  return user !== null;
}

/** Set (or clear) an auth user's WhatsApp number, stored encrypted. */
export async function setUserWhatsApp(userId: string, number: string | null) {
  if (!number) {
    return prisma.authUser.update({ where: { id: userId }, data: { waEnc: null, waHash: null } });
  }
  const { enc, hash } = encryptPhone(number);
  return prisma.authUser.update({ where: { id: userId }, data: { waEnc: enc, waHash: hash } });
}

/** The single internal maintenance calendar (cron/pollers), or null. */
export async function getMaintenanceGroup() {
  return prisma.group.findFirst({ where: { kind: 'maintenance' } });
}

/** Ensure the maintenance calendar exists (never linked to WhatsApp). */
export async function ensureMaintenanceGroup(timezone: string) {
  const existing = await getMaintenanceGroup();
  if (existing) return existing;
  return prisma.group.create({ data: { name: 'Maintenance', kind: 'maintenance', timezone } });
}

/** Find a member of a group by (partial) name. */
export async function findMemberByName(groupId: string, name: string) {
  const n = name.trim();
  if (!n) return null;
  return prisma.member.findFirst({ where: { groupId, name: { contains: n } } });
}

/** Find the group a forwarded email belongs to, by matching the sender to a member. */
export async function findGroupByMemberEmail(email: string) {
  const member = await prisma.member.findFirst({ where: { email } });
  if (!member) return null;
  return { member, groupId: member.groupId };
}

/**
 * Ensure a Jarvis group exists for a WhatsApp group the linked number is in.
 * Called by the worker whenever the device's group list is fetched, so every
 * group the assistant's number belongs to appears automatically.
 */
export async function upsertWhatsAppGroup(
  whatsappGroupId: string,
  subject: string,
  timezone: string,
) {
  return prisma.group.upsert({
    where: { whatsappGroupId },
    update: subject ? { name: subject } : {},
    create: { whatsappGroupId, name: subject || 'WhatsApp group', timezone },
  });
}
