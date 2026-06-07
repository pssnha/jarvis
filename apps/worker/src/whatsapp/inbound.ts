import type { WAMessage } from '@whiskeysockets/baileys';
import {
  appendMessages,
  getGroupByWhatsappId,
  getOrCreateConversation,
  loadHistory,
  resolveMember,
  runAgent,
} from '@jarvis/agent';

type Sender = (jid: string, text: string) => Promise<void>;

/** Extract plain text from a (possibly wrapped) WhatsApp message. */
function extractText(msg: WAMessage): string | null {
  const m = msg.message?.ephemeralMessage?.message ?? msg.message;
  if (!m) return null;
  return m.conversation ?? m.extendedTextMessage?.text ?? null;
}

/**
 * Handle an inbound WhatsApp group message. Jarvis only responds when it's
 * addressed — either @mentioned or the message starts with "Jarvis" — to avoid
 * replying to ordinary group chatter.
 */
export async function handleInboundGroupMessage(
  msg: WAMessage,
  send: Sender,
  selfNumber: string | null,
): Promise<void> {
  if (!msg.key || msg.key.fromMe) return;
  const jid = msg.key.remoteJid;
  if (!jid || !jid.endsWith('@g.us')) return; // groups only

  const text = extractText(msg);
  if (!text) return;

  const wrapped = msg.message?.ephemeralMessage?.message ?? msg.message;
  const mentioned = wrapped?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
  const addressedByMention = Boolean(
    selfNumber && mentioned.some((j) => j.startsWith(selfNumber)),
  );
  const addressedByName = /^\s*jarvis\b/i.test(text);
  if (!addressedByMention && !addressedByName) return;

  const userText = addressedByName ? text.replace(/^\s*jarvis[\s,:]*/i, '').trim() : text;
  if (!userText) return;

  const group = await getGroupByWhatsappId(jid);
  if (!group) return; // this WhatsApp group isn't mapped to a Jarvis group yet

  const participant = msg.key.participant ?? '';
  const waId = participant.split('@')[0] || participant;
  const pushName = msg.pushName ?? undefined;

  const member = await resolveMember(group.id, { waId, name: pushName });
  const convo = await getOrCreateConversation(group.id, 'whatsapp');
  const history = await loadHistory(convo.id);

  const { reply } = await runAgent({
    ctx: {
      groupId: group.id,
      timezone: group.timezone,
      source: 'whatsapp',
      createdById: member?.id,
    },
    history,
    userText,
    authorName: member?.name ?? pushName,
  });

  await appendMessages(convo.id, userText, reply, member?.name ?? pushName);
  await send(jid, reply);
}
