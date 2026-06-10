import { prisma } from '@jarvis/db';
import { dateKeyInZone, expandCalendar, nowIsoInZone, timeLabel } from '@jarvis/agent';
import { isConnected, sendGroupText } from './whatsapp/client';

/**
 * Maintenance job (mutable per circle): each morning, summarize each group's day
 * and post it to that group's WhatsApp chat. Runs hourly, fires at the circle's
 * local brief hour.
 */

const BRIEF_HOUR = Number(process.env.DAILY_BRIEF_HOUR ?? 7);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Avoid re-posting within the same local day (resets on restart — acceptable).
const sent = new Map<string, string>(); // groupId -> dateKey

export async function sendDailyBriefs(): Promise<void> {
  const now = new Date();
  const circles = await prisma.circle.findMany({
    include: {
      groups: { where: { whatsappGroupId: { not: null } } },
      mutedJobs: { select: { job: true } },
    },
  });

  for (const circle of circles) {
    if (circle.mutedJobs.some((m) => m.job === 'daily_brief')) continue;
    if (!isConnected(circle.id)) continue;
    const localHour = Number(nowIsoInZone(circle.timezone).slice(11, 13));
    if (localHour !== BRIEF_HOUR) continue;
    const todayKey = dateKeyInZone(now, circle.timezone);

    for (const group of circle.groups) {
      if (!group.whatsappGroupId) continue;
      if (sent.get(group.id) === todayKey) continue;
      try {
        const occ = await expandCalendar(
          { circleId: circle.id, kind: 'group', groupId: group.id },
          circle.timezone,
          new Date(now.getTime() - 24 * 3_600_000),
          new Date(now.getTime() + 48 * 3_600_000),
        );
        const today = occ
          .filter((o) => dateKeyInZone(o.start, circle.timezone) === todayKey)
          .sort((a, b) => a.start.getTime() - b.start.getTime());
        const text = buildBrief(group.name, circle.timezone, todayKey, today);
        await sendGroupText(circle.id, group.whatsappGroupId, text);
        sent.set(group.id, todayKey);
        console.log(`[daily-brief] ${circle.name} / ${group.name}`);
      } catch (err) {
        console.error(`[daily-brief] failed for ${circle.name}/${group.name}:`, err);
      }
    }
  }
}

function buildBrief(
  groupName: string,
  tz: string,
  todayKey: string,
  items: { start: Date; title: string; allDay: boolean; assigneeName: string | null }[],
): string {
  const [y, m, d] = todayKey.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const header = `☀️ Good morning, ${groupName}! Today — ${DOW[date.getUTCDay()]} ${d} ${MON[m! - 1]}:`;
  if (items.length === 0) return `${header}\nNothing scheduled. Enjoy the day! 🎉`;
  const lines = items.map((o) => {
    const when = o.allDay ? 'all day' : timeLabel(o.start, tz);
    const who = o.assigneeName ? ` (${o.assigneeName})` : '';
    return `• ${when} — ${o.title}${who}`;
  });
  return `${header}\n${lines.join('\n')}`;
}
