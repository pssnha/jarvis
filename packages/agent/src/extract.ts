import type Anthropic from '@anthropic-ai/sdk';
import { EVENT_CATEGORIES, type EventDraft } from '@jarvis/shared';
import { anthropic, MODEL } from './client';
import { describeNow } from './datetime';

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'record_events',
  description: 'Record every distinct calendar event found in the text.',
  input_schema: {
    type: 'object',
    properties: {
      events: {
        type: 'array',
        description: 'All distinct calendar events found. Empty array if there are none.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short event title.' },
            start: {
              type: 'string',
              description:
                'Local start in ISO without timezone offset, e.g. "2026-06-10T15:00". For an all-day event use a date only, "2026-06-10".',
            },
            end: { type: 'string', description: 'Optional local end in the same format.' },
            all_day: { type: 'boolean' },
            location: { type: 'string' },
            category: { type: 'string', enum: EVENT_CATEGORIES },
          },
          required: ['title', 'start'],
        },
      },
    },
    required: ['events'],
  },
};

export interface ExtractOptions {
  text: string;
  timezone: string;
  /** Optional extra context, e.g. an email subject/sender line. */
  context?: string;
}

/** Use Claude to pull structured events out of free text (messages, forwarded emails). */
export async function extractEvents(opts: ExtractOptions): Promise<EventDraft[]> {
  const system = `You extract calendar events from messages and forwarded emails for a shared group schedule.
Right now it is ${describeNow(opts.timezone)} in the group's time zone (${opts.timezone}).
Resolve relative dates ("tomorrow", "next Friday", "this weekend") against that, and return local
wall-clock times without a timezone offset. If the text contains no schedulable events, record an
empty list.`;

  const userContent = opts.context ? `${opts.context}\n\n${opts.text}` : opts.text;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: 'record_events' },
    messages: [{ role: 'user', content: userContent }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) return [];

  const raw = (toolUse.input as { events?: unknown }).events;
  if (!Array.isArray(raw)) return [];

  return raw.map(normalizeDraft).filter((e): e is EventDraft => e !== null);
}

function normalizeDraft(e: unknown): EventDraft | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  if (typeof o.title !== 'string' || typeof o.start !== 'string') return null;
  return {
    title: o.title,
    start: o.start,
    end: typeof o.end === 'string' ? o.end : undefined,
    allDay: typeof o.all_day === 'boolean' ? o.all_day : undefined,
    location: typeof o.location === 'string' ? o.location : undefined,
    category:
      typeof o.category === 'string' ? (o.category as EventDraft['category']) : undefined,
  };
}
