import type { FastifyInstance } from 'fastify';
import { prisma } from '@jarvis/db';
import {
  addVacationItem,
  createVacation,
  deleteVacation,
  deleteVacationItem,
  expandItinerary,
  formatEventTime,
  getVacation,
  listVacations,
  resolveVacationImage,
  toItineraryItemDTO,
  toLocalInput,
  updateVacation,
  updateVacationItem,
  type ItineraryItemDTO,
  type VacationItemInput,
} from '@jarvis/agent';
import type { VacationItemType } from '@jarvis/shared';

interface VacationBody {
  title?: string;
  destinations?: string | null;
  startDate?: string;
  endDate?: string;
  timezone?: string | null;
  description?: string | null;
  travelerIds?: string[];
  coverImageUrl?: string | null;
}

interface VacationItemBody extends Partial<VacationItemInput> {
  type?: VacationItemType;
  title?: string;
  startsAt?: string;
}

/** Card-level summary for the trip list. */
function cardDTO(
  v: {
    id: string;
    title: string;
    destinations: string | null;
    startDate: Date;
    endDate: Date;
    timezone: string | null;
    coverImageUrl: string | null;
    travelers: { id: string; name: string | null }[];
    _count?: { items: number };
  },
  zone: string,
) {
  return {
    id: v.id,
    title: v.title,
    destinations: v.destinations,
    coverImageUrl: v.coverImageUrl,
    timezone: zone,
    startDateLocal: toLocalInput(v.startDate, zone, true),
    endDateLocal: toLocalInput(v.endDate, zone, true),
    dateRangeLabel: formatEventTime(v.startDate, v.endDate, true, zone),
    itemCount: v._count?.items ?? 0,
    travelers: v.travelers.map((t) => ({ id: t.id, name: t.name })),
  };
}

/** Trip routes. Circle access is enforced by the requireCircleParam preHandler
 *  (see app.ts) for every `:cid` route here. */
export async function registerVacations(app: FastifyInstance): Promise<void> {
  // List trips (cards). ?includePast=1 to include finished trips.
  app.get('/circles/:cid/vacations', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    const { includePast } = req.query as { includePast?: string };
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });

    const vacations = await listVacations(cid, { includePast: includePast === '1' });
    return vacations.map((v) => cardDTO(v, v.timezone ?? circle.timezone));
  });

  // Create a trip.
  app.post('/circles/:cid/vacations', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    const body = (req.body ?? {}) as VacationBody;
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    if (!body.title || !body.startDate || !body.endDate) {
      return reply.code(400).send({ error: 'title, startDate and endDate are required' });
    }
    const zone = body.timezone || circle.timezone;
    // Best-effort: let the LLM pick a destination cover photo (never blocks creation).
    let coverImageUrl = body.coverImageUrl ?? null;
    if (!coverImageUrl) {
      coverImageUrl = await resolveVacationImage({
        title: body.title,
        destinations: body.destinations ?? null,
      }).catch(() => null);
    }
    const v = await createVacation(
      {
        circleId: cid,
        title: body.title,
        destinations: body.destinations ?? null,
        startDate: body.startDate,
        endDate: body.endDate,
        timezone: body.timezone ?? null,
        description: body.description ?? null,
        travelerIds: body.travelerIds,
        coverImageUrl,
      },
      zone,
    );
    return cardDTO(v, zone);
  });

  // Trip detail: trip fields + itinerary (grouped by day) + flights/hotels + travelers.
  app.get('/circles/:cid/vacations/:vid', async (req, reply) => {
    const { cid, vid } = req.params as { cid: string; vid: string };
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    const v = await getVacation(cid, vid);
    if (!v) return reply.code(404).send({ error: 'vacation not found' });

    const zone = v.timezone ?? circle.timezone;
    const itinerary = await expandItinerary(vid, zone);
    const allItems: ItineraryItemDTO[] = v.items.map((it) => toItineraryItemDTO(it, zone));

    return {
      ...cardDTO(v, zone),
      description: v.description,
      itinerary,
      flights: allItems.filter((i) => i.type === 'flight'),
      hotels: allItems.filter((i) => i.type === 'hotel'),
    };
  });

  // Update a trip.
  app.patch('/circles/:cid/vacations/:vid', async (req, reply) => {
    const { cid, vid } = req.params as { cid: string; vid: string };
    const body = (req.body ?? {}) as VacationBody;
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    const existing = await prisma.vacation.findFirst({ where: { id: vid, circleId: cid } });
    if (!existing) return reply.code(404).send({ error: 'vacation not found' });

    const zone = (body.timezone ?? existing.timezone) || circle.timezone;
    const v = await updateVacation(
      cid,
      vid,
      {
        title: body.title,
        destinations: body.destinations === undefined ? undefined : body.destinations || null,
        startDate: body.startDate,
        endDate: body.endDate,
        timezone: body.timezone === undefined ? undefined : body.timezone || null,
        description: body.description === undefined ? undefined : body.description || null,
        travelerIds: body.travelerIds,
        coverImageUrl: body.coverImageUrl === undefined ? undefined : body.coverImageUrl || null,
      },
      zone,
    );
    if (!v) return reply.code(404).send({ error: 'vacation not found' });
    return cardDTO(v, v.timezone ?? circle.timezone);
  });

  // Delete a trip (cascades items + traveler links).
  app.delete('/circles/:cid/vacations/:vid', async (req, reply) => {
    const { cid, vid } = req.params as { cid: string; vid: string };
    const v = await deleteVacation(cid, vid);
    if (!v) return reply.code(404).send({ error: 'vacation not found' });
    return { ok: true };
  });

  // Add an itinerary item.
  app.post('/circles/:cid/vacations/:vid/items', async (req, reply) => {
    const { cid, vid } = req.params as { cid: string; vid: string };
    const body = (req.body ?? {}) as VacationItemBody;
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    const v = await prisma.vacation.findFirst({ where: { id: vid, circleId: cid } });
    if (!v) return reply.code(404).send({ error: 'vacation not found' });
    if (!body.title || !body.type || !body.startsAt) {
      return reply.code(400).send({ error: 'type, title and startsAt are required' });
    }
    const zone = v.timezone ?? circle.timezone;
    return addVacationItem(vid, { ...body, type: body.type, title: body.title, startsAt: body.startsAt }, zone);
  });

  // Update an itinerary item.
  app.patch('/circles/:cid/vacations/:vid/items/:itemId', async (req, reply) => {
    const { cid, vid, itemId } = req.params as { cid: string; vid: string; itemId: string };
    const body = (req.body ?? {}) as VacationItemBody;
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    const v = await prisma.vacation.findFirst({ where: { id: vid, circleId: cid } });
    if (!v) return reply.code(404).send({ error: 'vacation not found' });
    const zone = v.timezone ?? circle.timezone;
    const item = await updateVacationItem(vid, itemId, body, zone);
    if (!item) return reply.code(404).send({ error: 'item not found' });
    return item;
  });

  // Delete an itinerary item.
  app.delete('/circles/:cid/vacations/:vid/items/:itemId', async (req, reply) => {
    const { cid, vid, itemId } = req.params as { cid: string; vid: string; itemId: string };
    // Scope the item to the circle via its trip before deleting.
    const v = await prisma.vacation.findFirst({ where: { id: vid, circleId: cid } });
    if (!v) return reply.code(404).send({ error: 'vacation not found' });
    const item = await deleteVacationItem(vid, itemId);
    if (!item) return reply.code(404).send({ error: 'item not found' });
    return { ok: true };
  });
}
