import type Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@jarvis/db';
import type { Channel } from '@jarvis/shared';

/** Find or create the app user for a given WhatsApp wa_id (phone). */
export async function getOrCreateUserByWaId(waId: string) {
  return prisma.user.upsert({
    where: { waId },
    update: {},
    create: { waId },
  });
}

/** Get the most recent conversation for a user+channel, creating one if needed. */
export async function getOrCreateConversation(userId: string, channel: Channel) {
  const existing = await prisma.conversation.findFirst({
    where: { userId, channel },
    orderBy: { updatedAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.conversation.create({ data: { userId, channel } });
}

/** Load recent turns as Anthropic message params (oldest first). */
export async function loadHistory(
  conversationId: string,
  limit = 20,
): Promise<Anthropic.MessageParam[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  return rows.map((r) => ({
    role: r.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: r.content,
  }));
}

/** Persist a user message and the assistant's reply, bumping the conversation. */
export async function appendMessages(
  conversationId: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  await prisma.message.createMany({
    data: [
      { conversationId, role: 'user', content: userText },
      { conversationId, role: 'assistant', content: assistantText },
    ],
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}
