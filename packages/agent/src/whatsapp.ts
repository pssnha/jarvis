const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v21.0';

/** Whether WhatsApp Cloud API credentials are present. */
export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

async function postMessage(payload: Record<string, unknown>): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('WhatsApp credentials are not configured');

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${await res.text()}`);
}

/**
 * Create/host a WhatsApp group via the Groups API and return its id + invite link.
 *
 * NOTE: the Groups API request/response shape is not fully documented publicly;
 * the endpoint and field names below are best-effort and should be confirmed
 * against your account's API. Falls back to throwing so the admin UI can offer
 * manual onboarding (paste an existing group id + invite link).
 */
export async function provisionWhatsAppGroup(
  subject: string,
): Promise<{ groupId: string; inviteLink?: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('WhatsApp credentials are not configured');

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/groups`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', subject }),
  });
  if (!res.ok) {
    throw new Error(`WhatsApp group creation failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { id?: string; group_id?: string; invite_link?: string };
  const groupId = data.group_id ?? data.id;
  if (!groupId) throw new Error('WhatsApp group creation returned no id');
  return { groupId, inviteLink: data.invite_link };
}

/** Send a text message to a 1:1 recipient (phone / wa_id). */
export async function sendWhatsAppText(to: string, text: string): Promise<void> {
  await postMessage({ to, type: 'text', text: { body: text } });
}

/**
 * Send a text message to a Jarvis-hosted group.
 * NOTE: confirm the group recipient shape against the WhatsApp Groups API once
 * your business number has Groups access.
 */
export async function sendWhatsAppGroupText(groupId: string, text: string): Promise<void> {
  await postMessage({ recipient_type: 'group', to: groupId, type: 'text', text: { body: text } });
}
