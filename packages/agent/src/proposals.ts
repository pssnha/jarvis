import { prisma, type EmailProposal } from '@jarvis/db';
import type { AnalyzedProposal } from './extract';
import { createEvent, getGroup } from './schedule';
import { addVacationItem, createVacation } from './vacations';
import { resolveVacationImage } from './vacationImage';

export interface ProposalMeta {
  fromEmail?: string;
  subject?: string;
  messageId?: string;
}

/** Smallest positive integer not already used by this group's pending proposals. */
async function nextCode(groupId: string): Promise<string> {
  const pending = await prisma.emailProposal.findMany({
    where: { groupId, status: 'pending' },
    select: { code: true },
  });
  const used = new Set(pending.map((p) => p.code));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

/**
 * Persist detected proposals for a group (status "pending", not yet notified).
 * De-duplicates on the email Message-ID so re-polling the same mail is a no-op.
 */
export async function createProposals(
  groupId: string,
  analyzed: AnalyzedProposal[],
  meta: ProposalMeta = {},
): Promise<EmailProposal[]> {
  if (analyzed.length === 0) return [];
  if (meta.messageId) {
    const existing = await prisma.emailProposal.count({
      where: { groupId, messageId: meta.messageId },
    });
    if (existing > 0) return [];
  }

  const created: EmailProposal[] = [];
  for (const a of analyzed) {
    const code = await nextCode(groupId);
    const row = await prisma.emailProposal.create({
      data: {
        groupId,
        code,
        kind: a.kind,
        title: a.title,
        summary: a.summary,
        payload: JSON.stringify(a),
        fromEmail: meta.fromEmail ?? null,
        subject: meta.subject ?? null,
        messageId: meta.messageId ?? null,
      },
    });
    created.push(row);
  }
  return created;
}

export async function listPendingProposals(groupId: string): Promise<EmailProposal[]> {
  return prisma.emailProposal.findMany({
    where: { groupId, status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });
}

export async function markNotified(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.emailProposal.updateMany({
    where: { id: { in: ids } },
    data: { notifiedAt: new Date() },
  });
}

/** Create the entity a confirmed proposal describes, scoped to the group. */
export async function confirmProposal(groupId: string, code: string): Promise<string> {
  const p = await prisma.emailProposal.findFirst({
    where: { groupId, code, status: 'pending' },
  });
  if (!p) return `No pending proposal "${code}".`;
  const group = await getGroup(groupId);
  if (!group) return 'Group not found.';
  const zone = group.timezone;
  const a = JSON.parse(p.payload) as AnalyzedProposal;

  let confirmation: string;
  try {
    if (a.kind === 'vacation' && a.vacation) {
      const coverImageUrl = await resolveVacationImage({
        title: a.vacation.title,
        destinations: a.vacation.destinations ?? null,
      }).catch(() => null);
      const v = await createVacation(
        {
          groupId,
          title: a.vacation.title,
          destinations: a.vacation.destinations ?? null,
          startDate: a.vacation.startDate,
          endDate: a.vacation.endDate,
          description: p.subject ? `From email: ${p.subject}` : null,
          coverImageUrl,
        },
        zone,
      );
      if (a.vacation.item) {
        const it = a.vacation.item;
        await addVacationItem(
          v.id,
          {
            type: it.type,
            title: it.title,
            startsAt: it.startsAt,
            endsAt: it.endsAt ?? null,
            location: it.location ?? null,
            provider: it.provider ?? null,
            number: it.number ?? null,
            fromLabel: it.fromLabel ?? null,
            toLabel: it.toLabel ?? null,
            seat: it.seat ?? null,
            confirmation: it.confirmation ?? null,
          },
          zone,
        );
      }
      confirmation = `Created trip "${v.title}".`;
    } else if (a.draft) {
      const ev = await createEvent({
        groupId,
        draft: a.draft,
        source: 'email',
        timezone: zone,
        sourceRef: p.messageId ?? undefined,
        kind: a.kind === 'event' ? 'event' : 'reminder',
        reminderLeadMinutes: a.kind === 'event' ? (a.reminderLeadMinutes ?? null) : null,
      });
      confirmation = `Added ${a.kind} "${ev.title}".`;
    } else {
      return `Proposal "${code}" is malformed.`;
    }
  } catch (err) {
    return `Couldn't create "${p.title}": ${(err as Error).message}`;
  }

  await prisma.emailProposal.update({
    where: { id: p.id },
    data: { status: 'confirmed', decidedAt: new Date() },
  });
  return confirmation;
}

export async function rejectProposal(groupId: string, code: string): Promise<string> {
  const p = await prisma.emailProposal.findFirst({
    where: { groupId, code, status: 'pending' },
  });
  if (!p) return `No pending proposal "${code}".`;
  await prisma.emailProposal.update({
    where: { id: p.id },
    data: { status: 'rejected', decidedAt: new Date() },
  });
  return `Skipped "${p.title}".`;
}
