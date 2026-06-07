import type Anthropic from '@anthropic-ai/sdk';
import { EVENT_CATEGORIES, type Channel, type EventDraft } from '@jarvis/shared';
import { cancelEvent, createEvent, findEvents, listUpcomingEvents } from '../schedule';
import { formatEventTime } from '../datetime';

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

export const tools: AgentTool[] = [
  {
    definition: {
      name: 'create_event',
      description:
        'Add an event to the group schedule (appointment, vacation, reminder, …). Use local wall-clock times in the group time zone.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          start: {
            type: 'string',
            description:
              'Local ISO start without offset, e.g. "2026-06-10T15:00". Use a date only "2026-06-10" for all-day.',
          },
          end: { type: 'string', description: 'Optional local ISO end.' },
          all_day: { type: 'boolean' },
          location: { type: 'string' },
          category: { type: 'string', enum: EVENT_CATEGORIES },
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
      };
      const ev = await createEvent({
        groupId: ctx.groupId,
        draft,
        source: ctx.source,
        timezone: ctx.timezone,
        createdById: ctx.createdById,
      });
      return `Created "${ev.title}" — ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay, ctx.timezone)}.`;
    },
  },
  {
    definition: {
      name: 'list_events',
      description: 'List upcoming events on the group schedule.',
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
      const events = await listUpcomingEvents(ctx.groupId, { to });
      if (events.length === 0) return 'No upcoming events.';
      return events
        .map(
          (e) =>
            `• ${e.title} — ${formatEventTime(e.startsAt, e.endsAt, e.allDay, ctx.timezone)}` +
            `${e.location ? ` @ ${e.location}` : ''} [id:${e.id}]`,
        )
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
            `• ${e.title} — ${formatEventTime(e.startsAt, e.endsAt, e.allDay, ctx.timezone)} [id:${e.id}]`,
        )
        .join('\n');
    },
  },
  {
    definition: {
      name: 'cancel_event',
      description:
        'Cancel/remove an event by its id. Use find_event or list_events first if you do not have the id.',
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
