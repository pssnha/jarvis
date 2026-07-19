import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  appendMessages,
  authUserByTelegramId,
  bindAdminTelegram,
  bindTelegramGroup,
  circlesForTelegramMember,
  ensureGroupMember,
  firstCircle,
  getCircle,
  getGroupByTelegramChatId,
  getOrCreateConversation,
  listPendingProposals,
  listVacations,
  loadHistory,
  resolveMember,
  runAgent,
  sendTelegramMessage,
  toLocalInput,
  type ScheduleScope,
} from '@jarvis/agent';
import { env } from '../config/env';

// --- Minimal subset of the Telegram Update shape we consume. ---
interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
}
interface TgMessage {
  from?: TgUser;
  chat: TgChat;
  text?: string;
}
interface TgUpdate {
  message?: TgMessage;
  my_chat_member?: {
    chat: TgChat;
    new_chat_member?: { status?: string };
  };
}

function displayName(u?: TgUser): string | undefined {
  if (!u) return undefined;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return name || u.username || undefined;
}

function tripContext(
  vacs: { id: string; title: string; destinations: string | null; startDate: Date; endDate: Date; timezone: string | null }[],
  tz: string,
) {
  return vacs.map((v) => ({
    id: v.id,
    title: v.title,
    destinations: v.destinations,
    start: toLocalInput(v.startDate, v.timezone ?? tz, true),
    end: toLocalInput(v.endDate, v.timezone ?? tz, true),
  }));
}

/** Run a circle-scoped turn through the agent and persist it. Returns the reply. */
async function runScoped(opts: {
  circleId: string;
  timezone: string;
  scope: ScheduleScope;
  conversationId: string;
  userText: string;
  authorName?: string;
  createdById?: string;
  isAdmin: boolean;
  groupContext: boolean;
}): Promise<string> {
  const history = await loadHistory(opts.conversationId);
  // Pending email proposals are the circle's shared inbox; their notifications
  // may be answered from any DM (admin detection is brittle), so surface them in
  // individual chats too — "add 1" then resolves against the real pending list.
  const pending = await listPendingProposals(opts.circleId);
  const vacs = await listVacations(opts.circleId, { includePast: false });
  const { reply } = await runAgent({
    ctx: {
      circleId: opts.circleId,
      scope: opts.scope,
      timezone: opts.timezone,
      source: 'telegram',
      createdById: opts.createdById,
      isAdmin: opts.isAdmin,
      groupContext: opts.groupContext,
    },
    history,
    userText: opts.userText,
    authorName: opts.authorName,
    pendingProposals: pending.map((p) => ({ code: p.code, kind: p.kind, summary: p.summary })),
    trips: tripContext(vacs, opts.timezone),
  });
  await appendMessages(opts.conversationId, opts.userText, reply, opts.authorName);
  return reply;
}

async function handleUpdate(update: TgUpdate): Promise<void> {
  // Bot added to a group → nudge the admin to link it.
  const joined = update.my_chat_member;
  if (joined && (joined.chat.type === 'group' || joined.chat.type === 'supergroup')) {
    const status = joined.new_chat_member?.status;
    if (status === 'member' || status === 'administrator') {
      await sendTelegramMessage(
        joined.chat.id,
        'Added. An admin: send /link <code> here using the code from your Jarvis dashboard to connect this group.',
      ).catch(() => {});
    }
    return;
  }

  const msg = update.message;
  if (!msg?.text || !msg.from) return;
  const text = msg.text.trim();
  if (!text) return;
  const chatId = String(msg.chat.id);
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
  const tgId = String(msg.from.id);
  const name = displayName(msg.from);

  // --- Linking commands ---
  if (isGroup && text.startsWith('/link')) {
    const code = text.split(/\s+/)[1] ?? '';
    const bound = code ? await bindTelegramGroup(code, chatId, msg.chat.title || 'Telegram group') : null;
    await sendTelegramMessage(
      chatId,
      bound ? `Linked to ${bound.circle.name}.` : 'That link code is invalid or expired.',
    );
    return;
  }
  if (!isGroup && text.startsWith('/start')) {
    const code = text.split(/\s+/)[1] ?? '';
    const user = code ? await bindAdminTelegram(code, tgId) : null;
    await sendTelegramMessage(
      chatId,
      user
        ? 'Your Telegram is linked. You can manage your circle from here.'
        : "Hi! I'm Jarvis. Link your account from the dashboard to manage your circle here.",
    );
    return;
  }

  // --- Group message: scoped to that group's shared calendar ---
  if (isGroup) {
    const group = await getGroupByTelegramChatId(chatId);
    if (!group) return; // unlinked group — ignore
    const circle = await getCircle(group.circleId);
    if (!circle) return;
    if (circle.deletedAt) return; // circle scheduled for deletion — don't service it
    const member = await resolveMember(circle.id, { tgId, name });
    if (member) await ensureGroupMember(group.id, member.id);
    const authUser = await authUserByTelegramId(tgId);
    const isAdmin =
      authUser?.role === 'admin' ||
      (authUser?.circleAdminOf.some((g) => g.circleId === circle.id) ?? false);
    const convo = await getOrCreateConversation(circle.id, 'telegram', { groupId: group.id });
    const reply = await runScoped({
      circleId: circle.id,
      timezone: circle.timezone,
      scope: { circleId: circle.id, kind: 'group', groupId: group.id },
      conversationId: convo.id,
      userText: text,
      authorName: member?.name ?? name,
      createdById: member?.id,
      isAdmin,
      groupContext: true,
    });
    await sendTelegramMessage(chatId, reply);
    return;
  }

  // --- Private DM: resolve the circle from the sender's identity ---
  // Admin first: an AuthUser linked to this Telegram id who administers a circle.
  const authUser = await authUserByTelegramId(tgId);
  if (authUser) {
    let circleId: string | null = authUser.circleAdminOf[0]?.circleId ?? null;
    if (!circleId && authUser.role === 'admin') circleId = (await firstCircle())?.id ?? null;
    if (circleId) {
      const circle = await getCircle(circleId);
      if (circle && !circle.deletedAt) {
        const convo = await getOrCreateConversation(circle.id, 'telegram', {});
        const reply = await runScoped({
          circleId: circle.id,
          timezone: circle.timezone,
          scope: { circleId: circle.id, kind: 'circle' },
          conversationId: convo.id,
          userText: text,
          isAdmin: true,
          groupContext: false,
        });
        await sendTelegramMessage(chatId, reply);
        return;
      }
    }
  }

  // Member: serve their own merged calendar for their (most recent) circle.
  const memberships = await circlesForTelegramMember(tgId);
  if (memberships.length > 0) {
    const m = memberships[0]!; // ordered most-recently-active first
    const circle = await getCircle(m.circleId);
    if (circle && !circle.deletedAt) {
      const convo = await getOrCreateConversation(circle.id, 'telegram', { memberId: m.id });
      let reply = await runScoped({
        circleId: circle.id,
        timezone: circle.timezone,
        scope: { circleId: circle.id, kind: 'individual', memberId: m.id },
        conversationId: convo.id,
        userText: text,
        authorName: m.name ?? name,
        createdById: m.id,
        isAdmin: false,
        groupContext: false,
      });
      if (memberships.length > 1) reply += `\n\n(Replying for ${circle.name}.)`;
      await sendTelegramMessage(chatId, reply);
      return;
    }
  }

  await sendTelegramMessage(
    chatId,
    "Hi! I'm Jarvis, a shared schedule assistant. I don't recognise you yet — chat in your circle's group first, or ask your admin to add you.",
  );
}

interface RawReq extends FastifyRequest {
  headers: FastifyRequest['headers'] & { 'x-telegram-bot-api-secret-token'?: string };
}

/** Telegram inbound webhook (single shared bot). Registered under /api. */
export async function registerTelegram(app: FastifyInstance): Promise<void> {
  app.post('/telegram/webhook', async (req: RawReq, reply) => {
    // Only Telegram knows the secret we set via setWebhook.
    if (
      env.TELEGRAM_WEBHOOK_SECRET &&
      req.headers['x-telegram-bot-api-secret-token'] !== env.TELEGRAM_WEBHOOK_SECRET
    ) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    // Always 200 promptly so Telegram doesn't retry; process best-effort.
    try {
      await handleUpdate((req.body ?? {}) as TgUpdate);
    } catch (err) {
      app.log.error({ err }, 'telegram update failed');
    }
    return { ok: true };
  });
}
