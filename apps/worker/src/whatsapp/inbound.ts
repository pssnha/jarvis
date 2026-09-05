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
  type ToolContext,
} from '@jarvis/agent';

type Sender = (jid: string, text: string) => Promise<void>;

function digits(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * The sender's PHONE number, resolving WhatsApp LID addressing.
 *
 * WhatsApp increasingly delivers a "LID" (`<id>@lid`, a hidden-number
 * identifier) as the sender JID instead of the phone-number JID. Its digits are
 * NOT a phone number, so using them breaks admin detection and spawns a phantom
 * member — which routes the owner's own DM into individual scope (private
 * events, no proposals). Baileys carries the real phone-number JID alongside it
 * in `remoteJidAlt`/`participantAlt`; prefer that whenever the primary is a LID.
 */
function senderPhone(msg: WAMessage, isGroup: boolean): string {
  const key = msg.key;
  const primary = (isGroup ? key.participant : key.remoteJid) ?? '';
  const alt = (isGroup ? key.participantAlt : key.remoteJidAlt) ?? '';
  const pnJid = primary.includes('@lid') && alt ? alt : primary;
  return digits((pnJid.split('@')[0] ?? ''));
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

/** An attachment downloaded and ready to feed the LLM as vision input. */
type InlineDoc = { data: string; mediaType: string; filename?: string };

/**
 * Download a PDF/image attachment for a served sender and pings "reading".
 * Returns the inline doc, null (no attachment), or 'error' when it already
 * replied with a failure (caller should stop).
 */
async function downloadDoc(
  circleId: string,
  meta: { mimetype: string; filename?: string } | null,
  msg: WAMessage,
  jid: string,
  send: Sender,
): Promise<InlineDoc | null | 'error'> {
  if (!meta) return null;
  let buffer: Buffer;
  try {
    buffer = (await downloadMediaMessage(msg, 'buffer', {})) as Buffer;
  } catch (err) {
    console.error(`[wa:${circleId}] media download failed:`, err);
    await send(jid, "I couldn't download that file — please try sending it again.");
    return 'error';
  }
  if (buffer.length > MAX_DOC_BYTES) {
    await send(jid, 'That file is too large for me to read (max 8 MB).');
    return 'error';
  }
  await send(jid, '📎 Reading that…');
  return { data: buffer.toString('base64'), mediaType: meta.mimetype, filename: meta.filename };
}

/**
 * Produce and send one reply for a served turn (text and/or an attachment).
 *
 * A document is first offered to the specialised itinerary ingester (trips are
 * shared per-circle); only when it isn't a travel itinerary do we fall back to
 * the vision-enabled agent, which reads the image and applies schedule changes
 * with its full toolset. Either way the turn is logged to the conversation so
 * follow-ups keep context.
 */
async function respond(opts: {
  circleId: string;
  timezone: string;
  jid: string;
  send: Sender;
  convoId: string;
  ctx: ToolContext;
  authorName?: string;
  userText: string;
  doc: InlineDoc | null;
  pending: { code: string; kind: string; summary: string }[];
  trips: ReturnType<typeof tripContext>;
}): Promise<void> {
  if (opts.doc) {
    try {
      const res = await ingestItineraryDocument({
        circleId: opts.circleId,
        zone: opts.timezone,
        documents: [opts.doc],
        context: opts.userText || undefined,
        source: 'whatsapp',
        replace: true, // a sent itinerary document is the trip's source of truth
      });
      if (res.ok) {
        await appendMessages(
          opts.convoId,
          opts.userText || '[shared an itinerary document]',
          res.message,
          opts.authorName,
        );
        await opts.send(opts.jid, res.message);
        return;
      }
    } catch (err) {
      console.error(`[wa:${opts.circleId}] itinerary ingest failed:`, err);
    }
  }

  const history = await loadHistory(opts.convoId);
  const agentText =
    opts.userText ||
    (opts.doc
      ? 'I sent an image — read it and update the schedule accordingly (add, change, or remove items). Ask one short question only if it is genuinely unclear.'
      : '');
  const { reply } = await runAgent({
    ctx: opts.ctx,
    history,
    userText: agentText,
    documents: opts.doc ? [opts.doc] : undefined,
    authorName: opts.authorName,
    pendingProposals: opts.pending,
    trips: opts.trips,
  });
  const logUser = opts.userText || (opts.doc ? '[sent an image]' : agentText);
  await appendMessages(opts.convoId, logUser, reply, opts.authorName);
  await opts.send(opts.jid, reply);
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
  const docMeta = extractDocument(msg);
  if (!text && !docMeta) return;

  const circle = await getCircle(circleId);
  if (!circle) return;
  if (circle.deletedAt) return; // circle scheduled for deletion — don't service it

  const isGroup = jid.endsWith('@g.us');
  // Resolve LID → phone number so the owner's DM is recognised (not treated as a
  // phantom member). Replies still go to `jid` (the original chat JID).
  const senderNumber = senderPhone(msg, isGroup);
  const pushName = msg.pushName ?? undefined;
  const userText = (text ?? '').trim();
  const pendingFor = (p: { code: string; kind: string; summary: string }) => ({
    code: p.code,
    kind: p.kind,
    summary: p.summary,
  });

  if (isGroup) {
    const group = await getGroupByWhatsappId(jid);
    if (!group || group.circleId !== circleId) return; // not this circle's group

    const isAdmin = senderNumber ? await isAdminWhatsApp(senderNumber) : false;
    const member = await resolveMember(circleId, { waId: senderNumber, name: pushName });
    if (member) await ensureGroupMember(group.id, member.id);
    const convo = await getOrCreateConversation(circleId, 'whatsapp', { groupId: group.id });
    const pending = await listPendingProposals(circleId);
    const vacs = await listVacations(circleId, { includePast: false });

    const doc = await downloadDoc(circleId, docMeta, msg, jid, send);
    if (doc === 'error') return;
    if (!userText && !doc) return;

    await respond({
      circleId,
      timezone: circle.timezone,
      jid,
      send,
      convoId: convo.id,
      ctx: {
        circleId,
        scope: { circleId, kind: 'group', groupId: group.id },
        timezone: circle.timezone,
        source: 'whatsapp',
        createdById: member?.id,
        isAdmin,
        groupContext: true,
      },
      authorName: member?.name ?? pushName,
      userText,
      doc,
      pending: pending.map(pendingFor),
      trips: tripContext(vacs, circle.timezone),
    });
    return;
  }

  // Direct (1:1) message.
  const isAdmin = senderNumber ? await isAdminWhatsApp(senderNumber) : false;

  if (isAdmin) {
    // Admin owner DM → manage the circle + confirm email proposals here.
    const convo = await getOrCreateConversation(circleId, 'whatsapp', {});
    const pending = await listPendingProposals(circleId);
    const vacs = await listVacations(circleId, { includePast: false });

    const doc = await downloadDoc(circleId, docMeta, msg, jid, send);
    if (doc === 'error') return;
    if (!userText && !doc) return;

    await respond({
      circleId,
      timezone: circle.timezone,
      jid,
      send,
      convoId: convo.id,
      ctx: {
        circleId,
        scope: { circleId, kind: 'circle' },
        timezone: circle.timezone,
        source: 'whatsapp',
        isAdmin: true,
        groupContext: false,
      },
      userText,
      doc,
      pending: pending.map(pendingFor),
      trips: tripContext(vacs, circle.timezone),
    });
    return;
  }

  // A known member of this circle → serve their own merged calendar privately.
  const member = senderNumber ? await findMemberByWhatsApp(circleId, senderNumber) : null;
  if (member) {
    const convo = await getOrCreateConversation(circleId, 'whatsapp', { memberId: member.id });
    const vacs = await listVacations(circleId, { includePast: false });
    // Email proposals are the circle's shared inbox: their notifications are DM'd
    // to whoever admins the circle, and that reply can land in a member DM (admin
    // detection is number-based and brittle). Surface pending items here too so
    // "add 1", "add all", etc. resolve against the real list — not stale history.
    const pending = await listPendingProposals(circleId);

    const doc = await downloadDoc(circleId, docMeta, msg, jid, send);
    if (doc === 'error') return;
    if (!userText && !doc) return;

    await respond({
      circleId,
      timezone: circle.timezone,
      jid,
      send,
      convoId: convo.id,
      ctx: {
        circleId,
        scope: { circleId, kind: 'individual', memberId: member.id },
        timezone: circle.timezone,
        source: 'whatsapp',
        createdById: member.id,
        isAdmin: false,
        groupContext: false,
      },
      authorName: member.name ?? pushName,
      userText,
      doc,
      pending: pending.map(pendingFor),
      trips: tripContext(vacs, circle.timezone),
    });
    return;
  }

  // Not a member of this circle. Ignore attachments from strangers.
  await send(
    jid,
    "Hi! I'm Jarvis, the schedule assistant for this circle. I don't recognise this number yet — ask the circle admin to add you.",
  );
}
