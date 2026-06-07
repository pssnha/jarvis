import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  appendMessages,
  getGroupByWhatsappId,
  getOrCreateConversation,
  loadHistory,
  resolveMember,
  runAgent,
} from '@jarvis/agent';
import { env } from '../config/env';
import { verifySignature } from './verify';
import { sendWhatsAppGroupText } from './send';

interface RawBodyRequest extends FastifyRequest {
  rawBody?: Buffer;
}

export async function registerWhatsApp(app: FastifyInstance): Promise<void> {
  // Webhook verification handshake (Meta calls this when you save the webhook).
  app.get('/whatsapp/webhook', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === env.WHATSAPP_VERIFY_TOKEN) {
      return reply.code(200).send(q['hub.challenge']);
    }
    return reply.code(403).send('Forbidden');
  });

  // Inbound messages.
  app.post('/whatsapp/webhook', async (req: RawBodyRequest, reply) => {
    if (env.WHATSAPP_APP_SECRET) {
      const ok = verifySignature(
        env.WHATSAPP_APP_SECRET,
        req.rawBody ?? Buffer.from(''),
        req.headers['x-hub-signature-256'] as string | undefined,
      );
      if (!ok) return reply.code(401).send('Invalid signature');
    }

    // Acknowledge quickly — Meta retries deliveries that don't get a fast 200.
    reply.code(200).send('EVENT_RECEIVED');

    try {
      await handleInbound(req.body);
    } catch (err) {
      req.log.error({ err }, 'WhatsApp inbound handling failed');
    }
  });
}

async function handleInbound(body: unknown): Promise<void> {
  for (const m of extractGroupMessages(body)) {
    const group = await getGroupByWhatsappId(m.groupId);
    if (!group) {
      console.warn(`[whatsapp] message for unknown group ${m.groupId}, ignoring`);
      continue;
    }

    const member = await resolveMember(group.id, { waId: m.from });
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
      userText: m.text,
      authorName: member?.name ?? undefined,
    });

    await appendMessages(convo.id, m.text, reply, member?.name ?? undefined);
    if (group.whatsappGroupId) {
      await sendWhatsAppGroupText(group.whatsappGroupId, reply);
    }
  }
}

interface InboundGroupMessage {
  groupId: string;
  from: string;
  text: string;
}

/**
 * Pull group text messages out of a WhatsApp webhook payload.
 *
 * NOTE: the exact location of the group id in group webhooks is not finalized in
 * the public docs. We check the most likely fields; confirm and adjust once your
 * number has Groups API access. Non-group (1:1) messages are ignored.
 */
function extractGroupMessages(body: unknown): InboundGroupMessage[] {
  const out: InboundGroupMessage[] = [];
  const entries = (body as any)?.entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const groupIdFromValue = value?.metadata?.group_id ?? value?.group_id;
      for (const msg of value?.messages ?? []) {
        if (msg?.type !== 'text' || !msg?.text?.body) continue;
        const groupId = msg.group_id ?? groupIdFromValue;
        if (!groupId) continue; // ignore 1:1 messages for now
        out.push({
          groupId: String(groupId),
          from: String(msg.from),
          text: String(msg.text.body),
        });
      }
    }
  }
  return out;
}
