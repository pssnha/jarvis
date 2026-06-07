import { env } from '../config/env';

async function postMessage(payload: Record<string, unknown>): Promise<void> {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('WhatsApp credentials are not configured');
  }

  const url = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });

  if (!res.ok) {
    throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
  }
}

/** Send a text message to a 1:1 recipient (phone / wa_id). */
export async function sendWhatsAppText(to: string, text: string): Promise<void> {
  await postMessage({ to, type: 'text', text: { body: text } });
}

/**
 * Send a text message to a Jarvis-hosted group.
 *
 * NOTE: confirm the exact group send shape against the WhatsApp Groups API once
 * your business number has Groups access — the `recipient_type`/group-id contract
 * is not finalized in the public docs yet.
 */
export async function sendWhatsAppGroupText(groupId: string, text: string): Promise<void> {
  await postMessage({ recipient_type: 'group', to: groupId, type: 'text', text: { body: text } });
}
