import type { WAMessage } from '@whiskeysockets/baileys';
import {
  appendMessages,
  ensureGroupMember,
  findMemberByWhatsApp,
  getCircle,
  getGroupByWhatsappId,
  getOrCreateConversation,
  isAdminWhatsApp,
  listPendingProposals,
  listVacations,
  loadHistory,
  resolveMember,
  runAgent,
  toLocalInput,
} from '@jarvis/agent';

type Sender = (jid: string, text: string) => Promise<void>;

function digits(s: string): string {
  return s.replace(/\D/g, '');
}

function extractText(msg: WAMessage): string | null {
  const m = msg.message?.ephemeralMessage?.message ?? msg.message;
  if (!m) return null;
  return m.conversation ?? m.extendedTextMessage?.text ?? null;
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

/**
 * Handle an inbound WhatsApp message arriving on a circle's own session.
 * - Group chat: respond to every message, scoped to that group (shared calendar
 *   only — never private items).
 * - Direct (1:1) chat:
 *     • admin → manage the circle and confirm email proposals in this owner DM;
 *     • a known member → their own merged calendar (groups + private), acting as
 *       themselves; they can add private items;
 *     • anyone else → a short hello (they aren't in this circle).
 */
export async function handleInboundMessage(
  circleId: string,
  msg: WAMessage,
  send: Sender,
): Promise<void> {
  if (!msg.key || msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  if (!jid) return;

  const text = extractText(msg);
  if (!text) return;
  const userText = text.trim();
  if (!userText) return;

  const circle = await getCircle(circleId);
  if (!circle) return;
  if (circle.deletedAt) return; // circle scheduled for deletion — don't service it

  const isGroup = jid.endsWith('@g.us');
  const senderJid = isGroup ? (msg.key.participant ?? '') : jid;
  const senderNumber = digits(senderJid.split('@')[0] ?? '');
  const pushName = msg.pushName ?? undefined;

  if (isGroup) {
    const group = await getGroupByWhatsappId(jid);
    if (!group || group.circleId !== circleId) return; // not this circle's group

    const isAdmin = senderNumber ? await isAdminWhatsApp(senderNumber) : false;
    const member = await resolveMember(circleId, { waId: senderNumber, name: pushName });
    if (member) await ensureGroupMember(group.id, member.id);
    const convo = await getOrCreateConversation(circleId, 'whatsapp', { groupId: group.id });
    const history = await loadHistory(convo.id);
    const pending = await listPendingProposals(circleId);
    const vacs = await listVacations(circleId, { includePast: false });

    const { reply } = await runAgent({
      ctx: {
        circleId,
        scope: { circleId, kind: 'group', groupId: group.id },
        timezone: circle.timezone,
        source: 'whatsapp',
        createdById: member?.id,
        isAdmin,
        groupContext: true,
      },
      history,
      userText,
      authorName: member?.name ?? pushName,
      pendingProposals: pending.map((p) => ({ code: p.code, kind: p.kind, summary: p.summary })),
      trips: tripContext(vacs, circle.timezone),
    });
    await appendMessages(convo.id, userText, reply, member?.name ?? pushName);
    await send(jid, reply);
    return;
  }

  // Direct (1:1) message.
  const isAdmin = senderNumber ? await isAdminWhatsApp(senderNumber) : false;

  if (isAdmin) {
    // Admin owner DM → manage the circle + confirm email proposals here.
    const convo = await getOrCreateConversation(circleId, 'whatsapp', {});
    const history = await loadHistory(convo.id);
    const pending = await listPendingProposals(circleId);
    const vacs = await listVacations(circleId, { includePast: false });

    const { reply } = await runAgent({
      ctx: {
        circleId,
        scope: { circleId, kind: 'circle' },
        timezone: circle.timezone,
        source: 'whatsapp',
        isAdmin: true,
        groupContext: false,
      },
      history,
      userText,
      pendingProposals: pending.map((p) => ({ code: p.code, kind: p.kind, summary: p.summary })),
      trips: tripContext(vacs, circle.timezone),
    });
    await appendMessages(convo.id, userText, reply);
    await send(jid, reply);
    return;
  }

  // A known member of this circle → serve their own merged calendar privately.
  const member = senderNumber ? await findMemberByWhatsApp(circleId, senderNumber) : null;
  if (member) {
    const convo = await getOrCreateConversation(circleId, 'whatsapp', { memberId: member.id });
    const history = await loadHistory(convo.id);
    const vacs = await listVacations(circleId, { includePast: false });

    const { reply } = await runAgent({
      ctx: {
        circleId,
        scope: { circleId, kind: 'individual', memberId: member.id },
        timezone: circle.timezone,
        source: 'whatsapp',
        createdById: member.id,
        isAdmin: false,
        groupContext: false,
      },
      history,
      userText,
      authorName: member.name ?? pushName,
      trips: tripContext(vacs, circle.timezone),
    });
    await appendMessages(convo.id, userText, reply, member.name ?? pushName);
    await send(jid, reply);
    return;
  }

  // Not a member of this circle.
  await send(
    jid,
    "Hi! I'm Jarvis, the schedule assistant for this circle. I don't recognise this number yet — ask the circle admin to add you.",
  );
}
