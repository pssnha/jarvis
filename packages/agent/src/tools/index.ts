import { EVENT_CATEGORIES, RECURRENCE_FREQS, WEEKDAYS, type Channel, type EventDraft } from '@jarvis/shared';
import { cancelEvent, createEvent, findConflicts, findEvents, getSchedule } from '../schedule';
import { confirmProposal, rejectProposal } from '../proposals';
import {
  addVacationItem,
  deleteVacationItem,
  getVacation,
  listVacations,
  type VacationItemInput,
} from '../vacations';
import { VACATION_ITEM_TYPES } from '@jarvis/shared';
import { findMemberByName, primaryGroupId } from '../conversation';
import { formatEventTime } from '../datetime';
import { describeRecurrence } from '../recurrence';
import type { ScheduleScope } from '../scope';
import type { JsonSchema } from '../llm/schema';
import type { ToolSpec } from '../llm/types';

/** Context passed to every tool handler — scopes actions to a circle + view. */
export interface ToolContext {
  circleId: string;
  scope: ScheduleScope;
  timezone: string;
  source: Channel;
  /** Resolved member id of the speaker (for assignment / private ownership). */
  createdById?: string;
  isAdmin?: boolean;
  /** True in a group chat — tools must never read/write private events. */
  groupContext?: boolean;
}

/** Where a newly created event lands, given the active scope. */
async function eventTarget(
  ctx: ToolContext,
): Promise<{ groupId: string | null; ownerMemberId: string | null }> {
  if (ctx.scope.kind === 'group') return { groupId: ctx.scope.groupId, ownerMemberId: null };
  if (ctx.scope.kind === 'individual') return { groupId: null, ownerMemberId: ctx.scope.memberId };
  // circle (admin) → the circle's primary group.
  return { groupId: await primaryGroupId(ctx.circleId), ownerMemberId: null };
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
        const m = await findMemberByName(ctx.circleId, input.assignee.trim());
        if (m) {
          assigneeId = m.id;
          assigneeName = m.name ?? input.assignee.trim();
        }
      }
      const target = await eventTarget(ctx);
      const ev = await createEvent({
        circleId: ctx.circleId,
        groupId: target.groupId,
        ownerMemberId: target.ownerMemberId,
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
          ctx.scope,
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
      const items = await getSchedule(ctx.scope, ctx.timezone, { to });
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
      const events = await findEvents(ctx.scope, String(input.query));
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
      const ev = await cancelEvent(ctx.circleId, String(input.event_id));
      return ev ? `Cancelled "${ev.title}".` : 'No event with that id in this group.';
    },
  },
  {
    spec: {
      name: 'confirm_proposal',
      description:
        'Approve a pending email proposal by its code, creating the reminder/event/trip. Use when the user agrees to add a proposed item from an email.',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: 'The proposal code, e.g. "1".' } },
        required: ['code'],
      },
    },
    handler: async (input, ctx) => confirmProposal(ctx.circleId, String(input.code)),
  },
  {
    spec: {
      name: 'reject_proposal',
      description:
        'Skip/decline a pending email proposal by its code. Use when the user does not want a proposed item added.',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: 'The proposal code, e.g. "1".' } },
        required: ['code'],
      },
    },
    handler: async (input, ctx) => rejectProposal(ctx.circleId, String(input.code)),
  },
  {
    spec: {
      name: 'list_trips',
      description:
        "List the group's trips/vacations with their ids, dates, and current itinerary items (flights, hotels, activities). Use this to find a trip id before adding or removing a trip item.",
      parameters: { type: 'object', properties: {} },
    },
    handler: async (_input, ctx) => {
      const trips = await listVacations(ctx.circleId, { includePast: true });
      if (trips.length === 0) return 'No trips planned.';
      const lines: string[] = [];
      for (const t of trips) {
        const zone = t.timezone ?? ctx.timezone;
        const dates = formatEventTime(t.startDate, t.endDate, true, zone);
        lines.push(
          `• ${t.title}${t.destinations ? ` (${t.destinations})` : ''} — ${dates} [trip:${t.id}]`,
        );
        const full = await getVacation(ctx.circleId, t.id);
        for (const it of full?.items ?? []) {
          lines.push(
            `    - ${it.type}: ${it.title} — ${formatEventTime(it.startsAt, it.endsAt, it.allDay, zone)} [item:${it.id}]`,
          );
        }
      }
      return lines.join('\n');
    },
  },
  {
    spec: {
      name: 'add_trip_item',
      description:
        'Add an itinerary item (activity, flight, hotel, transport, meal, or note) to a trip. Call list_trips first to get the trip id. Use local wall-clock times in the trip time zone.',
      parameters: {
        type: 'object',
        properties: {
          trip_id: { type: 'string', description: 'The trip id from list_trips.' },
          type: { type: 'string', enum: VACATION_ITEM_TYPES },
          title: { type: 'string' },
          starts_at: {
            type: 'string',
            description:
              'Local ISO start without offset, e.g. "2026-06-26T14:00" (flight=departure, hotel=check-in). Date only for all-day.',
          },
          ends_at: { type: 'string', description: 'Local ISO end (flight=arrival, hotel=check-out).' },
          location: { type: 'string' },
          provider: { type: 'string', description: 'Airline / hotel / operator.' },
          number: { type: 'string', description: 'Flight or booking number.' },
          from_label: { type: 'string', description: 'Departure airport / pickup.' },
          to_label: { type: 'string', description: 'Arrival airport / dropoff.' },
          from_timezone: {
            type: 'string',
            description:
              'For flights/transport crossing time zones: the IANA zone of the departure (e.g. infer "America/Los_Angeles" from SFO). starts_at is then that local time.',
          },
          to_timezone: {
            type: 'string',
            description: 'IANA zone of the arrival (e.g. "Europe/Lisbon" from LIS). ends_at is that local time.',
          },
          seat: { type: 'string', description: 'Seat / room.' },
          confirmation: { type: 'string', description: 'PNR / confirmation code.' },
          notes: { type: 'string' },
        },
        required: ['trip_id', 'type', 'title', 'starts_at'],
      },
    },
    handler: async (input, ctx) => {
      const tripId = String(input.trip_id);
      const v = await getVacation(ctx.circleId, tripId);
      if (!v) return 'No trip with that id — call list_trips for valid ids.';
      const zone = v.timezone ?? ctx.timezone;
      const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
      const draft: VacationItemInput = {
        type: (VACATION_ITEM_TYPES as readonly string[]).includes(String(input.type))
          ? (input.type as VacationItemInput['type'])
          : 'activity',
        title: String(input.title),
        startsAt: String(input.starts_at),
        endsAt: str('ends_at') ?? null,
        location: str('location') ?? null,
        provider: str('provider') ?? null,
        number: str('number') ?? null,
        fromLabel: str('from_label') ?? null,
        toLabel: str('to_label') ?? null,
        fromTimezone: str('from_timezone') ?? null,
        toTimezone: str('to_timezone') ?? null,
        seat: str('seat') ?? null,
        confirmation: str('confirmation') ?? null,
        notes: str('notes') ?? null,
      };
      const item = await addVacationItem(tripId, draft, zone);
      return `Added ${item.type} "${item.title}" to "${v.title}".`;
    },
  },
  {
    spec: {
      name: 'cancel_trip_item',
      description: 'Remove an itinerary item from a trip by its item id (from list_trips).',
      parameters: {
        type: 'object',
        properties: { trip_id: { type: 'string' }, item_id: { type: 'string' } },
        required: ['trip_id', 'item_id'],
      },
    },
    handler: async (input, ctx) => {
      const v = await getVacation(ctx.circleId, String(input.trip_id));
      if (!v) return 'No trip with that id.';
      const removed = await deleteVacationItem(String(input.trip_id), String(input.item_id));
      return removed ? `Removed "${removed.title}".` : 'No item with that id on this trip.';
    },
  },
];

export const toolSpecs: ToolSpec[] = tools.map((t) => t.spec);
export const toolHandlers = new Map(tools.map((t) => [t.spec.name, t.handler]));

/** Which surface (page) the assistant is acting on, to avoid cross-editing. */
export type ToolSurface = 'calendar' | 'vacations' | 'general';

const SURFACE_TOOLS: Record<'calendar' | 'vacations', string[]> = {
  // Calendar page: events only — never trips.
  calendar: ['create_event', 'list_events', 'find_event', 'cancel_event', 'confirm_proposal', 'reject_proposal'],
  // Vacations page: trip itineraries only — never calendar events.
  vacations: ['list_trips', 'add_trip_item', 'cancel_trip_item', 'confirm_proposal', 'reject_proposal'],
};

/** The tools available on a given surface (all of them for "general"). */
export function toolsForSurface(surface?: ToolSurface): AgentTool[] {
  if (!surface || surface === 'general') return tools;
  const allow = SURFACE_TOOLS[surface];
  return tools.filter((t) => allow.includes(t.spec.name));
}
