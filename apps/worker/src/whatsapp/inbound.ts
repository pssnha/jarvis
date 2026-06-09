import type { WAMessage } from '@whiskeysockets/baileys';
import {
  appendMessages,
  ensureMaintenanceGroup,
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

const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE ?? 'America/Los_Angeles';

function digits(s: string): string {
  return s.replace(/\D/g, '');
}

/** Extract plain text from a (possibly wrapped) WhatsApp message. */
function extractText(msg: WAMessage): string | null {
  const m = msg.message?.ephemeralMessage?.message ?? msg.message;
  if (!m) return null;
  return m.conversation ?? m.extendedTextMessage?.text ?? null;
}

/**
 * Handle an inbound WhatsApp message.
 * - Group chat: the group exists solely for Jarvis, so it responds to every
 *   message. Admins get the full assistant; non-admins are restricted to
 *   scheduling.
 * - Direct (1:1) chat: only admins are served — they get maintenance + general
 *   help. Non-admins are redirected to their group chat.
 */
export async function handleInboundMessage(msg: WAMessage, send: Sender): Promise<void> {
  if (!msg.key || msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  if (!jid) return;

  const text = extractText(msg);
  if (!text) return;

  const isGroup = jid.endsWith('@g.us');
  const senderJid = isGroup ? (msg.key.participant ?? '') : jid;
  const senderNumber = digits(senderJid.split('@')[0] ?? '');
  const isAdmin = senderNumber ? await isAdminWhatsApp(senderNumber) : false;

  if (isGroup) {
    const userText = text.trim();
    if (!userText) return;

    const group = await getGroupByWhatsappId(jid);
    if (!group) return; // not mapped to a Jarvis group

    const pushName = msg.pushName ?? undefined;
    const member = await resolveMember(group.id, { waId: senderNumber, name: pushName });
    const convo = await getOrCreateConversation(group.id, 'whatsapp');
    const history = await loadHistory(convo.id);
    const pending = await listPendingProposals(group.id);
    const vacs = await listVacations(group.id, { includePast: false });
    const trips = vacs.map((v) => ({
      id: v.id,
      title: v.title,
      destinations: v.destinations,
      start: toLocalInput(v.startDate, v.timezone ?? group.timezone, true),
      end: toLocalInput(v.endDate, v.timezone ?? group.timezone, true),
    }));

    const { reply } = await runAgent({
      ctx: {
        groupId: group.id,
        timezone: group.timezone,
        source: 'whatsapp',
        createdById: member?.id,
        isAdmin,
      },
      history,
      userText,
      authorName: member?.name ?? pushName,
      pendingProposals: pending.map((p) => ({ code: p.code, kind: p.kind, summary: p.summary })),
      trips,
    });
    await appendMessages(convo.id, userText, reply, member?.name ?? pushName);
    await send(jid, reply);
    return;
  }

  // Direct (1:1) message.
  if (!isAdmin) {
    await send(
      jid,
      "Hi! I manage group schedules. Please use your family/group chat to add or check the schedule.",
    );
    return;
  }

  // Admin direct chat → maintenance calendar + general help.
  const maint = await ensureMaintenanceGroup(DEFAULT_TZ);
  const convo = await getOrCreateConversation(maint.id, 'whatsapp');
  const history = await loadHistory(convo.id);
  const { reply } = await runAgent({
    ctx: {
      groupId: maint.id,
      timezone: maint.timezone,
      source: 'whatsapp',
      isAdmin: true,
      maintenance: true,
    },
    history,
    userText: text,
  });
  await appendMessages(convo.id, text, reply);
  await send(jid, reply);
}
