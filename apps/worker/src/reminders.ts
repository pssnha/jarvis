import { prisma } from '@jarvis/db';

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000; // remind for events within the next 24h

/**
 * Find events starting soon that haven't been reminded yet and notify the group.
 * For now this logs and marks them reminded; once the WhatsApp business number is
 * live, swap the log for a group message via the Cloud API.
 */
export async function sendDueReminders(): Promise<void> {
  const now = new Date();
  const until = new Date(now.getTime() + REMINDER_WINDOW_MS);

  const events = await prisma.event.findMany({
    where: { startsAt: { gte: now, lte: until }, remindedAt: null },
    include: { group: true },
    orderBy: { startsAt: 'asc' },
  });

  for (const ev of events) {
    // TODO: send to ev.group.whatsappGroupId via the WhatsApp Groups API.
    console.log(
      `[reminder] ${ev.group.name}: "${ev.title}" at ${ev.startsAt.toISOString()}`,
    );
    await prisma.event.update({ where: { id: ev.id }, data: { remindedAt: new Date() } });
  }
}
