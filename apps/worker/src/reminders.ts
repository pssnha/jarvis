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
  // Look ahead enough to fire events with a lead time (default cap: 7 days).
  const horizon = new Date(now.getTime() + 7 * 86_400_000);

  const events = await prisma.event.findMany({
    where: {
      OR: [
        { NOT: { rrule: null } }, // recurring: always a candidate
        { rrule: null, remindedAt: null, startsAt: { lte: horizon } }, // one-off, upcoming, unsent
      ],
    },
    include: { group: true },
  });

  for (const ev of events) {
    const leadMs = (ev.reminderLeadMinutes ?? 0) * 60_000;

    if (ev.rrule) {
      // Fire when an occurrence's (start − lead) falls in (lastSent, now].
      const after = new Date((ev.remindedAt ?? new Date(0)).getTime() + 1000);
      const occ = occurrencesBetween(
        ev.rrule,
        ev.startsAt,
        ev.group.timezone,
        new Date(after.getTime() + leadMs),
        new Date(now.getTime() + leadMs),
      );
      if (occ.length === 0) continue;
      await announce(ev.group, ev.title, occ[occ.length - 1]!, ev.reminderLeadMinutes);
      await prisma.event.update({ where: { id: ev.id }, data: { remindedAt: now } });
    } else {
      // One-off: due when start − lead has passed.
      if (ev.startsAt.getTime() - leadMs > now.getTime()) continue;
      await announce(ev.group, ev.title, ev.startsAt, ev.reminderLeadMinutes);
      await prisma.event.update({ where: { id: ev.id }, data: { remindedAt: now } });
    }
  }
}

async function announce(
  group: Group,
  title: string,
  when: Date,
  leadMinutes?: number | null,
): Promise<void> {
  const lead = leadMinutes && leadMinutes > 0 ? ` (in ${formatLead(leadMinutes)})` : '';
  const text = `⏰ Reminder: ${title} — ${formatEventTime(when, null, false, group.timezone)}${lead}`;

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

function formatLead(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} min`;
}
