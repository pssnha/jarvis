import { sendTelegramMessage } from '@jarvis/agent';
import { isConnected, sendDirectText, sendGroupText } from './whatsapp/client';

/** A group's outbound transport identifiers. A group may be linked to one or
 *  both transports (WhatsApp + Telegram) and broadcasts to every linked one. */
export interface GroupTarget {
  circleId: string;
  whatsappGroupId: string | null;
  telegramChatId: string | null;
}

/** Can we reach this group on any transport? Telegram is always reachable once
 *  linked; WhatsApp needs its per-circle session to be up. */
export function groupConnected(g: GroupTarget): boolean {
  if (g.telegramChatId) return true;
  if (g.whatsappGroupId) return isConnected(g.circleId);
  return false;
}

/** Send to every transport the group is linked to (so a unified circle group
 *  reaches both WhatsApp and Telegram). A failure on one doesn't block the other. */
export async function sendToGroup(g: GroupTarget, text: string): Promise<void> {
  if (g.telegramChatId) {
    try {
      await sendTelegramMessage(g.telegramChatId, text);
    } catch (err) {
      console.error(`[send] telegram send failed for circle ${g.circleId}:`, err);
    }
  }
  if (g.whatsappGroupId && isConnected(g.circleId)) {
    try {
      await sendGroupText(g.circleId, g.whatsappGroupId, text);
    } catch (err) {
      console.error(`[send] whatsapp send failed for circle ${g.circleId}:`, err);
    }
  }
}

/** DM a person via Telegram (preferred when linked) or WhatsApp. Returns whether sent. */
export async function sendDirect(
  circleId: string,
  to: { tgId?: string | null; waNumber?: string | null },
  text: string,
): Promise<boolean> {
  if (to.tgId) {
    await sendTelegramMessage(to.tgId, text);
    return true;
  }
  if (to.waNumber && isConnected(circleId)) {
    await sendDirectText(circleId, to.waNumber, text);
    return true;
  }
  return false;
}
