import { prisma, type Group } from '@jarvis/db';
import { formatEventTime, occurrencesBetween } from '@jarvis/agent';
import { isConnected, sendGroupText } from './whatsapp/client';

/**
 * Fire reminders for events whose time has arrived since the last check —
 * including each occurrence of a recurring reminder. Announcements go to the
 * group's linked WhatsApp group when connected; otherwise they are logged.
 */
export async function sendDueReminders(): Promise<void> {
  const now = new Date();

  const events = await prisma.event.findMany({
    where: {
      OR: [
        { NOT: { rrule: null } }, // recurring: always a candidate
        { rrule: null, remindedAt: null, startsAt: { lte: now } }, // one-off, due, unsent
      ],
    },
    include: { group: true },
  });

  for (const ev of events) {
    if (ev.rrule) {
      const after = new Date((ev.remindedAt ?? new Date(0)).getTime() + 1000);
      if (after > now) continue;
      const occ = occurrencesBetween(ev.rrule, ev.startsAt, ev.group.timezone, after, now);
      if (occ.length === 0) continue;
      await announce(ev.group, ev.title, occ[occ.length - 1]!);
      await prisma.event.update({ where: { id: ev.id }, data: { remindedAt: now } });
    } else {
      await announce(ev.group, ev.title, ev.startsAt);
      await prisma.event.update({ where: { id: ev.id }, data: { remindedAt: now } });
    }
  }
}

async function announce(group: Group, title: string, when: Date): Promise<void> {
  const text = `⏰ Reminder: ${title} — ${formatEventTime(when, null, false, group.timezone)}`;

  if (group.whatsappGroupId && isConnected()) {
    try {
      await sendGroupText(group.whatsappGroupId, text);
      console.log(`[reminder→whatsapp] ${group.name}: ${title}`);
      return;
    } catch (err) {
      console.error(`[reminder] WhatsApp send failed for ${group.name}:`, err);
    }
  }
  console.log(`[reminder] ${group.name}: ${text}`);
}
