import { EVENT_CATEGORIES, RECURRENCE_FREQS, WEEKDAYS, type Channel, type EventDraft } from '@jarvis/shared';
import { cancelEvent, createEvent, findConflicts, findEvents, getSchedule } from '../schedule';
import { findMemberByName } from '../conversation';
import { formatEventTime } from '../datetime';
import { describeRecurrence } from '../recurrence';
import type { JsonSchema } from '../llm/schema';
import type { ToolSpec } from '../llm/types';

/** Context passed to every tool handler — scopes actions to one group. */
export interface ToolContext {
  groupId: string;
  timezone: string;
  source: Channel;
  createdById?: string;
  /** Admins get general Q&A + maintenance; non-admins are schedule-only. */
  isAdmin?: boolean;
  /** True when this turn operates on the maintenance calendar. */
  maintenance?: boolean;
}

export interface AgentTool {
  spec: ToolSpec;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

const recurrenceSchema: JsonSchema = {
  type: 'object',
  description: 'Set this to make the event repeat (a recurring reminder). Omit for one-off events.',
  properties: {
    freq: { type: 'string', enum: RECURRENCE_FREQS },
    interval: {
      type: 'integer',
      description: 'Repeat every N periods (default 1), e.g. 2 weekly = biweekly.',
    },
    byweekday: {
      type: 'array',
      items: { type: 'string', enum: WEEKDAYS },
      description: 'For weekly recurrence, the days of week, e.g. ["MO","WE","FR"].',
    },
    count: { type: 'integer', description: 'Stop after this many occurrences.' },
    until: { type: 'string', description: 'Stop on/after this local date, "YYYY-MM-DD".' },
  },
  required: ['freq'],
};

function parseRecurrence(input: unknown): EventDraft['recurrence'] {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.freq !== 'string') return undefined;
  return {
    freq: o.freq as NonNullable<EventDraft['recurrence']>['freq'],
    interval: typeof o.interval === 'number' ? o.interval : undefined,
    byweekday: Array.isArray(o.byweekday)
      ? (o.byweekday.filter((d) => typeof d === 'string') as NonNullable<
          EventDraft['recurrence']
        >['byweekday'])
      : undefined,
    count: typeof o.count === 'number' ? o.count : undefined,
    until: typeof o.until === 'string' ? o.until : undefined,
  };
}

export const tools: AgentTool[] = [
  {
    spec: {
      name: 'create_event',
      description:
        'Add something to the group schedule. There are two kinds. Use kind="reminder" (the default) for a simple, non-blocking nudge — daily briefs, birthdays, "feed Taco", take medication — these never need an end time. Use kind="event" for a real commitment that occupies time and should not double-book — meetings, appointments, trips; for these always provide an `end`, and set `remind_lead_minutes` to how early the heads-up should go out. Use local wall-clock times in the group time zone. Set `recurrence` to make it repeat.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['reminder', 'event'],
            description:
              'reminder = simple non-blocking notification (default). event = a hard, time-blocking commitment that warns on overlap.',
          },
          start: {
            type: 'string',
            description:
              'Local ISO start without offset, e.g. "2026-06-10T15:00". Use a date only "2026-06-10" for all-day. For recurring events, this is the first occurrence.',
          },
          end: {
            type: 'string',
            description: 'Local ISO end. Required for kind="event"; omit for reminders.',
          },
          remind_lead_minutes: {
            type: 'integer',
            description:
              'For kind="event": how many minutes before start to send the reminder (e.g. 15, 60). Omit/0 = at start time.',
          },
          all_day: { type: 'boolean' },
          location: { type: 'string' },
          category: { type: 'string', enum: EVENT_CATEGORIES },
          assignee: {
            type: 'string',
            description:
              'Name of the individual this event is for, if a specific person is mentioned (e.g. "Vinit"). Omit for the whole group.',
          },
          recurrence: recurrenceSchema,
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
      const kind = input.kind === 'event' ? 'event' : 'reminder';
      const reminderLeadMinutes =
        typeof input.remind_lead_minutes === 'number' ? input.remind_lead_minutes : null;
      let assigneeId: string | null = null;
      let assigneeName: string | null = null;
      if (typeof input.assignee === 'string' && input.assignee.trim()) {
        const m = await findMemberByName(ctx.groupId, input.assignee.trim());
        if (m) {
          assigneeId = m.id;
          assigneeName = m.name ?? input.assignee.trim();
        }
      }
      const ev = await createEvent({
        groupId: ctx.groupId,
        draft,
        source: ctx.source,
        timezone: ctx.timezone,
        createdById: ctx.createdById,
        assigneeId,
        kind,
        reminderLeadMinutes,
      });
      let base = `Created ${kind} "${ev.title}"${assigneeName ? ` for ${assigneeName}` : ''} — ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay, ctx.timezone)}`;
      if (ev.rrule) base += `, repeating ${describeRecurrence(ev.rrule)}`;
      let warning = '';
      if (kind === 'event' && ev.endsAt && !ev.rrule) {
        const conflicts = await findConflicts(
          ctx.groupId,
          ctx.timezone,
          ev.startsAt,
          ev.endsAt,
          ev.id,
        );
        if (conflicts.length > 0) {
          const list = conflicts
            .map((c) => `"${c.title}" (${formatEventTime(c.start, c.end, false, ctx.timezone)})`)
            .join(', ');
          warning = ` ⚠️ Heads up — this overlaps: ${list}.`;
        }
      }
      return `${base}.${warning}`;
    },
  },
  {
    spec: {
      name: 'list_events',
      description:
        'List upcoming events on the group schedule, including the next occurrence of recurring reminders.',
      parameters: {
        type: 'object',
        properties: {
          days_ahead: {
            type: 'integer',
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
          const who = it.assigneeName ? ` — for ${it.assigneeName}` : '';
          return `• ${it.event.title}${who} — ${time}${repeat}${loc} [id:${it.event.id}]`;
        })
        .join('\n');
    },
  },
  {
    spec: {
      name: 'find_event',
      description: 'Search events by title keyword to get their ids (e.g. before cancelling).',
      parameters: {
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
    spec: {
      name: 'cancel_event',
      description:
        'Cancel/remove an event (or a whole recurring series) by its id. Use find_event or list_events first if you do not have the id.',
      parameters: {
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

export const toolSpecs: ToolSpec[] = tools.map((t) => t.spec);
export const toolHandlers = new Map(tools.map((t) => [t.spec.name, t.handler]));
