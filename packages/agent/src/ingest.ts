import type { Channel } from '@jarvis/shared';
import { extractEvents } from './extract';
import { createEvent, getGroup } from './schedule';
import { findGroupByMemberEmail } from './conversation';

export interface EmailIngestInput {
  fromEmail: string;
  subject?: string;
  text: string;
  messageId?: string;
}

export interface IngestResult {
  matched: boolean;
  groupId?: string;
  createdCount: number;
  titles: string[];
}

/**
 * Ingest a forwarded email: match the sender to a group member, extract any
 * events from the body, and add them to that group's schedule.
 */
export async function ingestForwardedEmail(input: EmailIngestInput): Promise<IngestResult> {
  const match = await findGroupByMemberEmail(input.fromEmail.toLowerCase());
  if (!match) return { matched: false, createdCount: 0, titles: [] };

  const group = await getGroup(match.groupId);
  if (!group) return { matched: false, createdCount: 0, titles: [] };

  const drafts = await extractEvents({
    text: input.text,
    timezone: group.timezone,
    context: input.subject ? `Email subject: ${input.subject}` : undefined,
  });

  const titles: string[] = [];
  for (const draft of drafts) {
    const ev = await createEvent({
      groupId: group.id,
      draft,
      source: 'email' as Channel,
      timezone: group.timezone,
      sourceRef: input.messageId,
      rawText: input.text,
      createdById: match.member.id,
    });
    titles.push(ev.title);
  }

  return { matched: true, groupId: group.id, createdCount: titles.length, titles };
}
