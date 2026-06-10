import { prisma } from '@jarvis/db';
import { decryptValue, formatEventTime, occurrencesBetween } from '@jarvis/agent';
import { isConnected, sendDirectText, sendGroupText } from './whatsapp/client';

type ReminderEvent = {
  id: string;
  circleId: string;
  title: string;
  startsAt: Date;
  rrule: string | null;
  remindedAt: Date | null;
  reminderLeadMinutes: number | null;
  group: { whatsappGroupId: string | null; name: string } | null;
  owner: { waEnc: string | null; name: string | null } | null;
  circle: { timezone: string; name: string };
};

/**
 * Fire reminders for events whose time has arrived since the last check.
 * Group events post to the linked WhatsApp group; private events DM their owner.
 */
export async function sendDueReminders(): Promise<void> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 86_400_000);

  const events = (await prisma.event.findMany({
    where: {
      OR: [
        { NOT: { rrule: null } },
        { rrule: null, remindedAt: null, startsAt: { lte: horizon } },
      ],
    },
    include: {
      group: { select: { whatsappGroupId: true, name: true } },
      owner: { select: { waEnc: true, name: true } },
      circle: { select: { timezone: true, name: true } },
    },
  })) as unknown as ReminderEvent[];

  for (const ev of events) {
    const leadMs = (ev.reminderLeadMinutes ?? 0) * 60_000;
    const tz = ev.circle.timezone;

    if (ev.rrule) {
      const after = new Date((ev.remindedAt ?? new Date(0)).getTime() + 1000);
      const occ = occurrencesBetween(
        ev.rrule,
        ev.startsAt,
        tz,
        new Date(after.getTime() + leadMs),
        new Date(now.getTime() + leadMs),
      );
      if (occ.length === 0) continue;
      await announce(ev, occ[occ.length - 1]!);
      await prisma.event.update({ where: { id: ev.id }, data: { remindedAt: now } });
    } else {
      if (ev.startsAt.getTime() - leadMs > now.getTime()) continue;
      await announce(ev, ev.startsAt);
      await prisma.event.update({ where: { id: ev.id }, data: { remindedAt: now } });
    }
  }
}

async function announce(ev: ReminderEvent, when: Date): Promise<void> {
  const lead =
    ev.reminderLeadMinutes && ev.reminderLeadMinutes > 0
      ? ` (in ${formatLead(ev.reminderLeadMinutes)})`
      : '';
  const text = `⏰ Reminder: ${ev.title} — ${formatEventTime(when, null, false, ev.circle.timezone)}${lead}`;

  if (!isConnected(ev.circleId)) {
    console.log(`[reminder] ${ev.circle.name}: ${text}`);
    return;
  }
  try {
    if (ev.group?.whatsappGroupId) {
      await sendGroupText(ev.circleId, ev.group.whatsappGroupId, text);
      return;
    }
    // Private event → DM the owner.
    const num = ev.owner?.waEnc ? decryptValue(ev.owner.waEnc) : null;
    if (num) {
      await sendDirectText(ev.circleId, num, text);
      return;
    }
  } catch (err) {
    console.error(`[reminder] WhatsApp send failed for ${ev.circle.name}:`, err);
  }
  console.log(`[reminder] ${ev.circle.name}: ${text}`);
}

function formatLead(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} min`;
}
