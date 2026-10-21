import type { FastifyInstance, FastifyReply } from 'fastify';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import {
  eventObject,
  listChanges,
  primaryGroupId,
  toolsForSurface,
  type ScheduleScope,
  type ToolContext,
} from '@jarvis/agent';
import { prisma, type AuthUser } from '@jarvis/db';
import { accessibleCircles, resolveCircle, selfMember } from '../lib/access';
import { enqueueEventCreated } from '../queue';

// Hints drive the client's approval UX (Muse asks before destructive calls).
const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

// Same set as voice: calendar scheduling plus trips read-only. Itinerary edits and
// proposal codes stay on the web/chat surfaces.
const ANNOTATIONS: Record<string, ToolAnnotations> = {
  list_events: READ,
  find_event: READ,
  list_trips: READ,
  create_event: WRITE,
  update_event: WRITE,
  update_event_occurrence: WRITE,
  cancel_event: DESTRUCTIVE,
  cancel_event_occurrence: DESTRUCTIVE,
};
const AGENT_TOOLS = toolsForSurface('voice').filter((t) => t.spec.name in ANNOTATIONS);

// Tools that take an existing event id — must not reach another member's private event.
const BY_EVENT_ID = new Set([
  'update_event',
  'update_event_occurrence',
  'cancel_event',
  'cancel_event_occurrence',
]);

const CIRCLE_ID_PROP = {
  type: 'string',
  description: 'Circle (household) to act on, from list_circles. Omit to use the default circle.',
};

function toolList(): Tool[] {
  const listCircles: Tool = {
    name: 'list_circles',
    title: 'List circles',
    description:
      'List the circles (households) this user belongs to, with their ids and time zones. Only needed when the user is in more than one circle.',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ,
  };
  const changesTool: Tool = {
    name: 'list_event_changes',
    title: 'List event changes',
    description:
      'Changes to events and reminders (created, updated, deleted) since a cursor, oldest first, across the circles this user belongs to. Use it to react to calendar changes instead of polling list_events. Pass since=0 to start from the oldest retained change (30+ days are kept), then pass the returned next_cursor while has_more is true and on later calls. Changes to one occurrence of a repeating event carry the series id as event_id plus occurrence_start, the original start of that instance. event is the event after the change (the last known version for deletes). If the cursor has expired, start again from 0.',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'integer',
          minimum: 0,
          description: 'Sequence id to read after (exclusive). 0 = from the oldest retained change.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: CHANGES_MAX,
          description: `Maximum changes to return (default ${CHANGES_DEFAULT}).`,
        },
        circle_id: { type: 'string', description: 'Only this circle (from list_circles). Omit for all.' },
      },
      required: ['since'],
    },
    annotations: READ,
  };
  return [
    listCircles,
    changesTool,
    ...AGENT_TOOLS.map((t) => {
      const params = t.spec.parameters as { properties?: Record<string, unknown>; required?: string[] };
      return {
        name: t.spec.name,
        description: t.spec.description,
        inputSchema: {
          type: 'object' as const,
          properties: { ...(params.properties ?? {}), circle_id: CIRCLE_ID_PROP },
          ...(params.required ? { required: params.required } : {}),
        },
        annotations: ANNOTATIONS[t.spec.name],
      };
    }),
  ];
}

const text = (s: string, isError = false) => ({ content: [{ type: 'text' as const, text: s }], isError });
// Same payload as text (for clients that ignore structuredContent) and structured.
const json = (data: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  structuredContent: data,
  isError: false,
});

const CHANGES_DEFAULT = 100;
const CHANGES_MAX = 500;

async function eventChanges(user: AuthUser, args: Record<string, unknown>) {
  const since = args.since;
  if (typeof since !== 'number' || !Number.isInteger(since) || since < 0) {
    return text('since must be a non-negative integer (0 to start from the oldest change).', true);
  }
  const limit =
    typeof args.limit === 'number' && Number.isInteger(args.limit)
      ? Math.min(Math.max(args.limit, 1), CHANGES_MAX)
      : CHANGES_DEFAULT;
  let circles = await accessibleCircles(user);
  if (typeof args.circle_id === 'string') {
    circles = circles.filter((c) => c.id === args.circle_id);
    if (circles.length === 0) return text('No circle with that id for this account.', true);
  }
  const readers = await Promise.all(
    circles.map(async (c) => ({ circleId: c.id, memberId: (await selfMember(user, c.id))?.id ?? null })),
  );
  const page = await listChanges(readers, since, limit);
  if (page.expired) return text('That cursor has expired. Call again with since=0 to resync.', true);
  return json(page);
}

async function callTool(user: AuthUser, name: string, args: Record<string, unknown>) {
  if (name === 'list_circles') {
    const circles = await accessibleCircles(user);
    if (circles.length === 0) return text('This account is not a member of any circle.', true);
    const rows = await prisma.circle.findMany({
      where: { id: { in: circles.map((c) => c.id) } },
      select: { id: true, name: true, timezone: true },
      orderBy: { name: 'asc' },
    });
    return text(rows.map((c) => `• ${c.name} — ${c.timezone} [circle:${c.id}]`).join('\n'));
  }
  if (name === 'list_event_changes') return eventChanges(user, args);

  const tool = AGENT_TOOLS.find((t) => t.spec.name === name);
  if (!tool) return text(`Unknown tool: ${name}`, true);

  const { circle_id: circleId, ...input } = args;
  const circle = await resolveCircle(user, typeof circleId === 'string' ? circleId : undefined);
  if (!circle) return text('This account is not a member of any circle.', true);
  const me = await selfMember(user, circle.id);

  // Reads cover the whole family calendar (every shared group) plus the user's own
  // private events; other members' private events never leave for a third party.
  const circleScope: ScheduleScope = { circleId: circle.id, kind: 'circle' };
  const readScope: ScheduleScope = { circleId: circle.id, kind: 'family', memberId: me?.id ?? null };
  // Creates go on a shared calendar the user is in (the primary one if they are),
  // so what Muse adds is visible to it afterwards. Admin-only access → primary.
  let writeScope: ScheduleScope = circleScope;
  if (me && name === 'create_event') {
    const [primary, mine] = await Promise.all([
      primaryGroupId(circle.id),
      prisma.groupMember.findMany({
        where: { memberId: me.id },
        select: { groupId: true },
        orderBy: { group: { createdAt: 'asc' } },
      }),
    ]);
    const ids = mine.map((g) => g.groupId);
    const groupId = primary && ids.includes(primary) ? primary : ids[0];
    if (groupId) writeScope = { circleId: circle.id, kind: 'group', groupId };
  }

  if (BY_EVENT_ID.has(name) && typeof input.event_id === 'string') {
    const ev = await prisma.event.findFirst({
      where: { id: input.event_id, circleId: circle.id },
      select: { ownerMemberId: true },
    });
    if (ev?.ownerMemberId && ev.ownerMemberId !== me?.id) {
      return text('No event with that id in this group.', true);
    }
  }

  const events: Record<string, unknown>[] = [];
  const ctx: ToolContext = {
    circleId: circle.id,
    scope: name === 'create_event' ? writeScope : readScope,
    timezone: circle.timezone,
    source: 'mcp',
    createdById: me?.id,
    isAdmin: user.role === 'admin',
    groupContext: false,
    // Announce Muse-created events on the family's channels. A queue hiccup must
    // not fail the create Muse already asked for.
    onEventCreated: async (eventId) => {
      try {
        await enqueueEventCreated({ eventId, addedBy: me?.name ?? user.name ?? null, via: 'Muse' });
      } catch (err) {
        console.error('[mcp] failed to enqueue event announcement', err);
      }
    },
    onEvents: (rows) => {
      for (const r of rows) {
        events.push({ ...eventObject(r.event), ...(r.when ? { next_start: r.when.toISOString() } : {}) });
      }
    },
  };
  const reply = await tool.handler(input, ctx);
  // Text stays exactly what every other surface gets; MCP clients also get the
  // event objects (with created_at/updated_at) as structured content.
  return events.length > 0 ? { ...text(reply), structuredContent: { events } } : text(reply);
}

/** MCP server (streamable HTTP, stateless) for external agents such as a Meta
 *  Muse custom connector. Bearer-authenticated by the caller's preHandler; every
 *  request gets a fresh server bound to that user, so no session state is kept. */
export async function registerMcp(api: FastifyInstance): Promise<void> {
  api.post('/mcp', async (req, reply) => {
    const user = req.authUser!;
    const server = new Server(
      { name: 'jarvis', version: '1.0.0' },
      {
        capabilities: { tools: {} },
        instructions:
          "Jarvis manages a household's shared calendar and trips. Times are local wall-clock in the circle's time zone. Get event ids from list_events or find_event before updating or cancelling. To follow calendar changes, page through list_event_changes with its cursor instead of polling list_events.",
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      try {
        return await callTool(user, r.params.name, r.params.arguments ?? {});
      } catch (err) {
        req.log.error({ err, tool: r.params.name }, 'mcp tool failed');
        return text('Something went wrong running that tool.', true);
      }
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // Stateless: no server-initiated stream and no sessions to terminate.
  const notAllowed = async (_req: unknown, reply: FastifyReply) =>
    reply.code(405).header('Allow', 'POST').send({ error: 'method_not_allowed' });
  api.get('/mcp', notAllowed);
  api.delete('/mcp', notAllowed);
}
