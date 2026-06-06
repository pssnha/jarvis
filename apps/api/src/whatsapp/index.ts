import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  appendMessages,
  getOrCreateConversation,
  getOrCreateUserByWaId,
  loadHistory,
  runAgent,
} from '@jarvis/agent';
import { env } from '../config/env';
import { verifySignature } from './verify';
import { sendWhatsAppText } from './send';

interface RawBodyRequest extends FastifyRequest {
  rawBody?: Buffer;
}

export async function registerWhatsApp(app: FastifyInstance): Promise<void> {
  // Webhook verification handshake (Meta calls this when you save the webhook).
  app.get('/whatsapp/webhook', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const mode = q['hub.mode'];
    const token = q['hub.verify_token'];
    const challenge = q['hub.challenge'];
    if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
      return reply.code(200).send(challenge);
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
  for (const m of extractTextMessages(body)) {
    const user = await getOrCreateUserByWaId(m.from);
    const convo = await getOrCreateConversation(user.id, 'whatsapp');
    const history = await loadHistory(convo.id);
    const { reply } = await runAgent({ ctx: { userId: user.id }, history, userText: m.text });
    await appendMessages(convo.id, m.text, reply);
    await sendWhatsAppText(m.from, reply);
  }
}

interface InboundText {
  from: string;
  text: string;
}

/** Pull text messages out of a WhatsApp webhook payload. */
function extractTextMessages(body: unknown): InboundText[] {
  const out: InboundText[] = [];
  const entries = (body as any)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      for (const msg of change?.value?.messages ?? []) {
        if (msg?.type === 'text' && msg?.text?.body) {
          out.push({ from: String(msg.from), text: String(msg.text.body) });
        }
      }
    }
  }
  return out;
}
