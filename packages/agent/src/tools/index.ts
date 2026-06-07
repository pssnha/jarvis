import type Anthropic from '@anthropic-ai/sdk';
import {
  EVENT_CATEGORIES,
  RECURRENCE_FREQS,
  WEEKDAYS,
  type Channel,
  type EventDraft,
  type Recurrence,
} from '@jarvis/shared';
import { cancelEvent, createEvent, findEvents, getSchedule } from '../schedule';
import { formatEventTime } from '../datetime';
import { describeRecurrence } from '../recurrence';

/** Context passed to every tool handler — scopes actions to one group. */
export interface ToolContext {
  groupId: string;
  timezone: string;
  /** Which channel this turn arrived on. */
  source: Channel;
  /** Member id of the speaker, if known. */
  createdById?: string;
}

export interface AgentTool {
  definition: Anthropic.Tool;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

function parseRecurrence(input: unknown): Recurrence | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.freq !== 'string') return undefined;
  return {
    freq: o.freq as Recurrence['freq'],
    interval: typeof o.interval === 'number' ? o.interval : undefined,
    byweekday: Array.isArray(o.byweekday)
      ? (o.byweekday.filter((d) => typeof d === 'string') as Recurrence['byweekday'])
      : undefined,
    count: typeof o.count === 'number' ? o.count : undefined,
    until: typeof o.until === 'string' ? o.until : undefined,
  };
}

export const tools: AgentTool[] = [
  {
    definition: {
      name: 'create_event',
      description:
        'Add an event to the group schedule (appointment, vacation, reminder, …). Use local wall-clock times in the group time zone. Set `recurrence` to make it repeat.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          start: {
            type: 'string',
            description:
              'Local ISO start without offset, e.g. "2026-06-10T15:00". Use a date only "2026-06-10" for all-day. For a recurring event, this is the first occurrence.',
          },
          end: { type: 'string', description: 'Optional local ISO end.' },
          all_day: { type: 'boolean' },
          location: { type: 'string' },
          category: { type: 'string', enum: EVENT_CATEGORIES },
          recurrence: {
            type: 'object',
            description:
              'Set this to make the event repeat (a recurring reminder). Omit for one-off events.',
            properties: {
              freq: { type: 'string', enum: RECURRENCE_FREQS },
              interval: {
                type: 'number',
                description: 'Repeat every N periods (default 1), e.g. 2 with freq "weekly" = biweekly.',
              },
              byweekday: {
                type: 'array',
                items: { type: 'string', enum: WEEKDAYS },
                description: 'For weekly recurrence, the days of week, e.g. ["MO","WE","FR"].',
              },
              count: { type: 'number', description: 'Stop after this many occurrences.' },
              until: {
                type: 'string',
                description: 'Stop on/after this local date, "YYYY-MM-DD".',
              },
            },
            required: ['freq'],
          },
        },
        required: ['title', 'start'],
      },
    },
    handler: async (input, ctx) => {
      const draft: EventDraft = {
        title: String(input.title),
        start: String(input.start),
        end: typeof input.end === 'string' ? input.end : undefined,
        allDay: typeof input.all_day === 'boolean' ? input.all_day : undefined,
        location: typeof input.location === 'string' ? input.location : undefined,
        category:
          typeof input.category === 'string'
            ? (input.category as EventDraft['category'])
            : undefined,
        recurrence: parseRecurrence(input.recurrence),
      };
      const ev = await createEvent({
        groupId: ctx.groupId,
        draft,
        source: ctx.source,
        timezone: ctx.timezone,
        createdById: ctx.createdById,
      });
      const base = `Created "${ev.title}" — ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay, ctx.timezone)}`;
      return ev.rrule ? `${base}, repeating ${describeRecurrence(ev.rrule)}.` : `${base}.`;
    },
  },
  {
    definition: {
      name: 'list_events',
      description:
        'List upcoming events on the group schedule, including the next occurrence of recurring reminders.',
      input_schema: {
        type: 'object',
        properties: {
          days_ahead: {
            type: 'number',
            description: 'Only include events within this many days from now.',
          },
        },
      },
    },
    handler: async (input, ctx) => {
      const days = typeof input.days_ahead === 'number' ? input.days_ahead : undefined;
      const to = days ? new Date(Date.now() + days * 86_400_000) : undefined;
      const items = await getSchedule(ctx.groupId, ctx.timezone, { to });
      if (items.length === 0) return 'No upcoming events.';
      return items
        .map((it) => {
          const end = it.recurrence ? null : it.event.endsAt;
          const time = formatEventTime(it.when, end, it.event.allDay, ctx.timezone);
          const repeat = it.recurrence ? ` (repeats ${it.recurrence})` : '';
          const loc = it.event.location ? ` @ ${it.event.location}` : '';
          return `• ${it.event.title} — ${time}${repeat}${loc} [id:${it.event.id}]`;
        })
        .join('\n');
    },
  },
  {
    definition: {
      name: 'find_event',
      description: 'Search events by title keyword to get their ids (e.g. before cancelling).',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    handler: async (input, ctx) => {
      const events = await findEvents(ctx.groupId, String(input.query));
      if (events.length === 0) return 'No matching events.';
      return events
        .map(
          (e) =>
            `• ${e.title} — ${formatEventTime(e.startsAt, e.endsAt, e.allDay, ctx.timezone)}` +
            `${e.rrule ? ` (repeats ${describeRecurrence(e.rrule)})` : ''} [id:${e.id}]`,
        )
        .join('\n');
    },
  },
  {
    definition: {
      name: 'cancel_event',
      description:
        'Cancel/remove an event (or a whole recurring series) by its id. Use find_event or list_events first if you do not have the id.',
      input_schema: {
        type: 'object',
        properties: { event_id: { type: 'string' } },
        required: ['event_id'],
      },
    },
    handler: async (input, ctx) => {
      const ev = await cancelEvent(ctx.groupId, String(input.event_id));
      return ev ? `Cancelled "${ev.title}".` : 'No event with that id in this group.';
    },
  },
];

export const toolDefinitions: Anthropic.Tool[] = tools.map((t) => t.definition);
export const toolHandlers = new Map(tools.map((t) => [t.definition.name, t.handler]));
