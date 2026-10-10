import { prisma } from '@jarvis/db';
import { decryptValue, describeRecurrence, formatEventTime } from '@jarvis/agent';
import { groupConnected, sendDirect, sendToGroup } from './send';

export interface EventCreatedJob {
  eventId: string;
  addedBy: string | null;
  via: string;
}

/**
 * Tell the family about an event an external agent (Muse) just added: post to
 * the event's group on every linked channel, or DM the owner for a private one.
 * Throws when the channel is down so the queue retries.
 */
export async function announceCreatedEvent(job: EventCreatedJob): Promise<void> {
  const ev = await prisma.event.findUnique({
    where: { id: job.eventId },
    include: {
      group: { select: { whatsappGroupId: true, telegramChatId: true } },
      owner: { select: { waEnc: true, tgId: true } },
      assignee: { select: { name: true } },
      circle: { select: { timezone: true, name: true, deletedAt: true } },
    },
  });
  // Deleted before we got to it (or circle gone) — nothing to announce.
  if (!ev || ev.cancelled || ev.circle.deletedAt) return;

  const tz = ev.circle.timezone;
  const when = formatEventTime(ev.startsAt, ev.endsAt, ev.allDay, tz);
  const repeat = ev.rrule ? ` (repeats ${describeRecurrence(ev.rrule)})` : '';
  const loc = ev.location ? ` @ ${ev.location}` : '';
  const who = ev.assignee?.name ? ` for ${ev.assignee.name}` : '';
  const by = job.addedBy ? `Added by ${job.addedBy} via ${job.via}` : `Added via ${job.via}`;
  const text = `📅 New: ${ev.title}${who} — ${when}${repeat}${loc}\n${by}`;

  if (ev.group) {
    const target = { circleId: ev.circleId, ...ev.group };
    if (!target.whatsappGroupId && !target.telegramChatId) return; // no channel linked
    if (!groupConnected(target)) throw new Error(`group channel down for circle ${ev.circle.name}`);
    await sendToGroup(target, text);
    return;
  }
  const waNumber = ev.owner?.waEnc ? decryptValue(ev.owner.waEnc) : null;
  if (!ev.owner?.tgId && !waNumber) return; // owner has no reachable channel
  const sent = await sendDirect(ev.circleId, { tgId: ev.owner?.tgId, waNumber }, text);
  if (!sent) throw new Error(`owner channel down for circle ${ev.circle.name}`);
}
