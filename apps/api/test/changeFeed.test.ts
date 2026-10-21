import '../src/loadEnv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@jarvis/db';
import {
  cancelEvent,
  cancelEventOccurrence,
  createEvent,
  deleteMemberWithChanges,
  listChanges,
  updateEvent,
  updateEventOccurrence,
  type ChangeEntry,
} from '@jarvis/agent';
import { PAT_PREFIX, sha256 } from '../src/routes/oauth';

/**
 * The MCP change feed: every event mutation appends an entry, occurrence-level
 * changes are reported against the series, other members' private events stay
 * hidden, and `list_event_changes` pages by cursor over bearer auth.
 *
 * DB-gated: skipped when no database is reachable.
 */

const TZ = 'UTC';
const SUF = `chg_${Date.now()}`;
const id = (s: string) => `${SUF}_${s}`;
const C = id('C');
const TOKEN = `${PAT_PREFIX}${SUF}`;

let dbOk = false;
let app: FastifyInstance;
const reader = () => [{ circleId: C, memberId: id('me') }];

/** Entries are held back for a few seconds after insert; age ours past that. */
async function settle() {
  await prisma.eventChange.updateMany({
    where: { circleId: C },
    data: { createdAt: new Date(Date.now() - 60_000) },
  });
}

/** Everything visible to `me` after `since`, settled. */
async function changesSince(since: number): Promise<ChangeEntry[]> {
  await settle();
  const page = await listChanges(reader(), since, 500);
  if (page.expired) throw new Error('unexpected expired cursor');
  return page.changes;
}

async function cursor(): Promise<number> {
  const last = await prisma.eventChange.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  return last ? Number(last.id) : 0;
}

const group = { circleId: C, groupId: id('G'), source: 'web' as const, timezone: TZ };

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
    return;
  }
  const email = `${id('me')}@example.com`;
  await prisma.circle.create({ data: { id: C, name: id('Circle'), timezone: TZ } });
  await prisma.group.create({ data: { id: id('G'), circleId: C, name: 'Home' } });
  await prisma.member.create({ data: { id: id('me'), circleId: C, name: 'Me', email } });
  await prisma.member.create({ data: { id: id('other'), circleId: C, name: 'Other' } });
  const user = await prisma.authUser.create({ data: { email, role: 'member' } });
  await prisma.personalAccessToken.create({
    data: { authUserId: user.id, name: 'test', tokenHash: sha256(TOKEN) },
  });

  const { buildApp } = await import('../src/app');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (!dbOk) return;
  await app?.close();
  // Cascades events, members and the change feed.
  await prisma.circle.deleteMany({ where: { id: C } });
  await prisma.authUser.deleteMany({ where: { email: { contains: SUF } } });
  await prisma.$disconnect();
});

describe('change recording', () => {
  it('logs create, update and delete with the full event', async () => {
    if (!dbOk) return;
    const start = await cursor();
    const ev = await createEvent({ ...group, draft: { title: 'Dentist', start: '2026-11-02T09:00' } });
    await updateEvent(C, ev.id, { title: 'Dentist (moved)', start: '2026-11-03T10:00' }, TZ);
    await cancelEvent(C, ev.id);

    const got = await changesSince(start);
    expect(got.map((c) => c.type)).toEqual(['created', 'updated', 'deleted']);
    expect(got.every((c) => c.event_id === ev.id && c.occurrence_start === null)).toBe(true);
    expect(got[0].event.title).toBe('Dentist');
    expect(got[0].event.created_at).toBe(ev.createdAt.toISOString());
    expect(got[1].event.title).toBe('Dentist (moved)');
    expect(got[1].event.starts_at).toBe('2026-11-03T10:00:00.000Z');
    // Deletes carry the last known object.
    expect(got[2].event.title).toBe('Dentist (moved)');
    expect(got[2].seq).toBeGreaterThan(got[1].seq);
    expect(got[1].seq).toBeGreaterThan(got[0].seq);
  });

  it('reports occurrence edits and cancels against the series', async () => {
    if (!dbOk) return;
    const series = await createEvent({
      ...group,
      kind: 'event',
      draft: {
        title: 'Swim',
        start: '2026-11-02T17:00',
        end: '2026-11-02T18:00',
        recurrence: { freq: 'daily' },
      },
    });
    const start = await cursor();
    const tue = new Date('2026-11-03T17:00:00Z');
    const wed = new Date('2026-11-04T17:00:00Z');
    const moved = await updateEventOccurrence(C, series.id, tue, { start: '2026-11-03T19:00' }, TZ);
    await updateEventOccurrence(C, series.id, tue, { title: 'Swim (late)' }, TZ);
    await cancelEventOccurrence(C, series.id, wed);

    const got = await changesSince(start);
    expect(got.map((c) => c.type)).toEqual(['updated', 'updated', 'deleted']);
    expect(got.every((c) => c.event_id === series.id)).toBe(true);
    expect(got[0].occurrence_start).toBe(tue.toISOString());
    expect(got[0].event.id).toBe(moved!.id);
    expect(got[0].event.starts_at).toBe('2026-11-03T19:00:00.000Z');
    expect(got[1].event.title).toBe('Swim (late)');
    expect(got[2].occurrence_start).toBe(wed.toISOString());

    // Deleting the series logs its cascaded override as well as the series;
    // the cancelled-instance tombstone was already reported.
    const before = await cursor();
    await cancelEvent(C, series.id);
    const del = await changesSince(before);
    expect(del.map((c) => [c.type, c.event_id, c.occurrence_start])).toEqual([
      ['deleted', series.id, tue.toISOString()],
      ['deleted', series.id, null],
    ]);
  });

  it('reports removing an override as the instance reverting to the series', async () => {
    if (!dbOk) return;
    const series = await createEvent({
      ...group,
      draft: { title: 'Piano', start: '2026-11-02T15:00', recurrence: { freq: 'weekly' } },
    });
    const mon = new Date('2026-11-09T15:00:00Z');
    const override = await updateEventOccurrence(C, series.id, mon, { start: '2026-11-09T16:00' }, TZ);
    const start = await cursor();
    await cancelEvent(C, override!.id);
    const [c] = await changesSince(start);
    expect(c.type).toBe('updated');
    expect(c.event_id).toBe(series.id);
    expect(c.occurrence_start).toBe(mon.toISOString());
    expect(c.event.id).toBe(series.id);
  });

  it('logs the calendar side of deleting a member', async () => {
    if (!dbOk) return;
    await prisma.member.create({ data: { id: id('gone'), circleId: C, name: 'Gone' } });
    const assigned = await createEvent({
      ...group,
      assigneeId: id('gone'),
      draft: { title: 'Pickup', start: '2026-11-05T15:00' },
    });
    const start = await cursor();
    await deleteMemberWithChanges(id('gone'));
    const got = await changesSince(start);
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe('updated');
    expect(got[0].event_id).toBe(assigned.id);
    expect(got[0].event.assignee_id).toBeNull();
  });
});

describe('visibility and paging', () => {
  it("hides other members' private events but shows the reader's own", async () => {
    if (!dbOk) return;
    const start = await cursor();
    const mine = await createEvent({
      circleId: C,
      ownerMemberId: id('me'),
      source: 'web',
      timezone: TZ,
      draft: { title: 'My physio', start: '2026-11-06T08:00' },
    });
    await createEvent({
      circleId: C,
      ownerMemberId: id('other'),
      source: 'web',
      timezone: TZ,
      draft: { title: 'Their secret', start: '2026-11-06T08:00' },
    });
    const got = await changesSince(start);
    expect(got.map((c) => c.event_id)).toEqual([mine.id]);
    // A reader with no member row (admin-only access) sees no private events.
    await settle();
    const anon = await listChanges([{ circleId: C, memberId: null }], start, 500);
    expect(!anon.expired && anon.changes).toEqual([]);
  });

  it('pages by cursor and holds back unsettled entries', async () => {
    if (!dbOk) return;
    const start = await cursor();
    for (const n of [1, 2, 3]) {
      await createEvent({ ...group, draft: { title: `Page ${n}`, start: '2026-11-07T09:00' } });
    }
    await settle();
    const p1 = await listChanges(reader(), start, 2);
    if (p1.expired) throw new Error('expired');
    expect(p1.changes.map((c) => c.event.title)).toEqual(['Page 1', 'Page 2']);
    expect(p1.has_more).toBe(true);
    expect(p1.next_cursor).toBe(p1.changes[1].seq);
    const p2 = await listChanges(reader(), p1.next_cursor, 2);
    if (p2.expired) throw new Error('expired');
    expect(p2.changes.map((c) => c.event.title)).toEqual(['Page 3']);
    expect(p2.has_more).toBe(false);

    // A change from a moment ago isn't returned yet; the cursor stays put.
    await createEvent({ ...group, draft: { title: 'Fresh', start: '2026-11-07T10:00' } });
    const p3 = await listChanges(reader(), p2.next_cursor, 2);
    expect(p3).toEqual({ expired: false, changes: [], next_cursor: p2.next_cursor, has_more: false });
  });
});

describe('MCP', () => {
  async function call(name: string, args: Record<string, unknown>, token = TOKEN) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('lists the new tool alongside the existing ones', async () => {
    if (!dbOk) return;
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    const names = (res.json().result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain('list_event_changes');
    expect(names).toContain('list_events');
  });

  it('serves list_event_changes over bearer auth', async () => {
    if (!dbOk) return;
    const start = await cursor();
    const ev = await createEvent({ ...group, draft: { title: 'Via MCP', start: '2026-11-08T09:00' } });
    await settle();
    const { body } = await call('list_event_changes', { since: start });
    const data = body.result.structuredContent;
    expect(body.result.isError).toBe(false);
    expect(data.changes.map((c: ChangeEntry) => c.event_id)).toEqual([ev.id]);
    expect(data.next_cursor).toBe(data.changes[0].seq);
    expect(data.has_more).toBe(false);
    expect(JSON.parse(body.result.content[0].text)).toEqual(data);

    expect((await call('list_event_changes', { since: -1 })).body.result.isError).toBe(true);
    expect((await call('list_event_changes', { since: 0 }, 'jvs_pat_nope')).status).toBe(401);
  });

  it('reports a cursor older than the retained window as expired', async () => {
    if (!dbOk) return;
    const oldest = await prisma.eventChange.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
    if (!oldest || oldest.id < 3n) return; // fresh DB: nothing has been pruned below us
    const { body } = await call('list_event_changes', { since: Number(oldest.id) - 2 });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/expired/);
  });

  it('adds event objects with timestamps to existing tools, text unchanged', async () => {
    if (!dbOk) return;
    const ev = await createEvent({ ...group, draft: { title: 'Haircut zq', start: '2030-01-02T09:00' } });
    const { body } = await call('find_event', { query: 'Haircut zq' });
    expect(body.result.content[0].text).toMatch(/^• Haircut zq — .*\[id:/);
    const [obj] = body.result.structuredContent.events;
    expect(obj.id).toBe(ev.id);
    expect(obj.created_at).toBe(ev.createdAt.toISOString());
    expect(obj.updated_at).toBe(ev.updatedAt.toISOString());
  });
});
