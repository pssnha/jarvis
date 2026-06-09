import { prisma, type Group } from '@jarvis/db';
import { dateKeyInZone, expandCalendar, nowIsoInZone, timeLabel } from '@jarvis/agent';
import { isConnected, sendGroupText } from './whatsapp/client';

/**
 * Maintenance job: each morning, summarize the day's events for a group and
 * post them to the group's WhatsApp chat. This is NOT a user reminder — it runs
 * behind the scenes (hourly cron, fires at the group's local brief hour).
 */

const BRIEF_HOUR = Number(process.env.DAILY_BRIEF_HOUR ?? 7); // local hour (0–23)
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Avoid re-posting within the same local day (resets on restart — acceptable).
const sent = new Map<string, string>();

export async function sendDailyBriefs(): Promise<void> {
  const now = new Date();
  const groups = await prisma.group.findMany({ where: { kind: 'group' } });
  for (const g of groups) {
    try {
      const localHour = Number(nowIsoInZone(g.timezone).slice(11, 13));
      if (localHour !== BRIEF_HOUR) continue;
      const todayKey = dateKeyInZone(now, g.timezone);
      if (sent.get(g.id) === todayKey) continue;

      const occ = await expandCalendar(
        g.id,
        g.timezone,
        new Date(now.getTime() - 24 * 3_600_000),
        new Date(now.getTime() + 48 * 3_600_000),
      );
      const today = occ
        .filter((o) => dateKeyInZone(o.start, g.timezone) === todayKey)
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      const text = buildBrief(g, todayKey, today);
      if (g.whatsappGroupId && isConnected()) {
        await sendGroupText(g.whatsappGroupId, text);
        console.log(`[daily-brief→whatsapp] ${g.name}`);
      } else {
        console.log(`[daily-brief] ${g.name}: ${text}`);
      }
      sent.set(g.id, todayKey);
    } catch (err) {
      console.error(`[daily-brief] failed for ${g.name}:`, err);
    }
  }
}

function buildBrief(
  group: Group,
  todayKey: string,
  items: { start: Date; title: string; allDay: boolean; assigneeName: string | null }[],
): string {
  const [y, m, d] = todayKey.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const header = `☀️ Good morning! Here's ${group.name}'s day — ${DOW[date.getUTCDay()]} ${d} ${MON[m! - 1]}:`;
  if (items.length === 0) return `${header}\nNothing scheduled. Enjoy the day! 🎉`;
  const lines = items.map((o) => {
    const when = o.allDay ? 'all day' : timeLabel(o.start, group.timezone);
    const who = o.assigneeName ? ` (${o.assigneeName})` : '';
    return `• ${when} — ${o.title}${who}`;
  });
  return `${header}\n${lines.join('\n')}`;
}
