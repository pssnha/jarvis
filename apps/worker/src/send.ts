import { sendTelegramMessage } from '@jarvis/agent';
import { isConnected, sendDirectText, sendGroupText } from './whatsapp/client';

/** A group's outbound transport identifiers (only one is set per linked group). */
export interface GroupTarget {
  circleId: string;
  whatsappGroupId: string | null;
  telegramChatId: string | null;
}

/** Can we reach this group? Telegram is always reachable once linked; WhatsApp
 *  needs its per-circle session to be up. */
export function groupConnected(g: GroupTarget): boolean {
  if (g.telegramChatId) return true;
  if (g.whatsappGroupId) return isConnected(g.circleId);
  return false;
}

/** Send to a group via whichever transport it is linked to. */
export async function sendToGroup(g: GroupTarget, text: string): Promise<void> {
  if (g.telegramChatId) return void (await sendTelegramMessage(g.telegramChatId, text));
  if (g.whatsappGroupId) return void (await sendGroupText(g.circleId, g.whatsappGroupId, text));
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
