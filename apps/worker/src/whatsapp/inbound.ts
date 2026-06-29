import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';
import {
  appendMessages,
  ensureGroupMember,
  findMemberByWhatsApp,
  getCircle,
  getGroupByWhatsappId,
  getOrCreateConversation,
  ingestItineraryDocument,
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

/** A PDF/image attachment we can read as an itinerary, if the message has one. */
function extractDocument(msg: WAMessage): { mimetype: string; filename?: string; caption?: string } | null {
  const m = msg.message?.ephemeralMessage?.message ?? msg.message;
  if (!m) return null;
  const doc = m.documentMessage ?? m.documentWithCaptionMessage?.message?.documentMessage;
  const mt = doc?.mimetype;
  if (mt && (mt === 'application/pdf' || mt.startsWith('image/'))) {
    return { mimetype: mt, filename: doc?.fileName ?? undefined, caption: doc?.caption ?? undefined };
  }
  const img = m.imageMessage;
  if (img?.mimetype?.startsWith('image/')) {
    return { mimetype: img.mimetype, caption: img.caption ?? undefined };
  }
  return null;
}

const MAX_DOC_BYTES = 8 * 1024 * 1024;

/**
 * Read a PDF/image itinerary sent to a circle and apply it (auto-apply).
 * Allowed for the admin, a known member, or anyone in the circle's group chat —
 * trips are shared per-circle. Replies with the change summary.
 */
async function handleDocument(
  circleId: string,
  timezone: string,
  msg: WAMessage,
  jid: string,
  isGroup: boolean,
  senderNumber: string,
  doc: { mimetype: string; filename?: string; caption?: string },
  send: Sender,
): Promise<void> {
  const isAdmin = senderNumber ? await isAdminWhatsApp(senderNumber) : false;
  let allowed = isAdmin;
  if (!allowed) {
    if (isGroup) {
      const group = await getGroupByWhatsappId(jid);
      allowed = !!group && group.circleId === circleId;
    } else if (senderNumber) {
      allowed = !!(await findMemberByWhatsApp(circleId, senderNumber));
    }
  }
  if (!allowed) return;

  let buffer: Buffer;
  try {
    buffer = (await downloadMediaMessage(msg, 'buffer', {})) as Buffer;
  } catch (err) {
    console.error(`[wa:${circleId}] media download failed:`, err);
    await send(jid, "I couldn't download that file — please try sending it again.");
    return;
  }
  if (buffer.length > MAX_DOC_BYTES) {
    await send(jid, 'That file is too large for me to read (max 8 MB).');
    return;
  }

  await send(jid, '📎 Reading that itinerary…');
  const res = await ingestItineraryDocument({
    circleId,
    zone: timezone,
    documents: [{ data: buffer.toString('base64'), mediaType: doc.mimetype, filename: doc.filename }],
    context: doc.caption,
    source: 'whatsapp',
    replace: true, // a sent itinerary document is the trip's source of truth
  });
  await send(jid, res.message);
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
  const doc = extractDocument(msg);
  if (!text && !doc) return;

  const circle = await getCircle(circleId);
  if (!circle) return;
  if (circle.deletedAt) return; // circle scheduled for deletion — don't service it

  const isGroup = jid.endsWith('@g.us');
  const senderJid = isGroup ? (msg.key.participant ?? '') : jid;
  const senderNumber = digits(senderJid.split('@')[0] ?? '');
  const pushName = msg.pushName ?? undefined;

  // An itinerary attachment (PDF/image) — parse and apply it, then we're done.
  if (doc) {
    await handleDocument(circleId, circle.timezone, msg, jid, isGroup, senderNumber, doc, send);
    return;
  }

  const userText = (text ?? '').trim();
  if (!userText) return;

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
