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
    travelers: { id: string; name: string | null }[];
    _count?: { items: number };
  },
  zone: string,
) {
  return {
    id: v.id,
    title: v.title,
    destinations: v.destinations,
    timezone: zone,
    startDateLocal: toLocalInput(v.startDate, zone, true),
    endDateLocal: toLocalInput(v.endDate, zone, true),
    dateRangeLabel: formatEventTime(v.startDate, v.endDate, true, zone),
    itemCount: v._count?.items ?? 0,
    travelers: v.travelers.map((t) => ({ id: t.id, name: t.name })),
  };
}

/** Schedule data routes for trips — available to any authenticated user. */
export async function registerVacations(app: FastifyInstance): Promise<void> {
  // List trips (cards). ?includePast=1 to include finished trips.
  app.get('/groups/:id/vacations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { includePast } = req.query as { includePast?: string };
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });

    const vacations = await listVacations(id, { includePast: includePast === '1' });
    return vacations.map((v) => cardDTO(v, v.timezone ?? group.timezone));
  });

  // Create a trip.
  app.post('/groups/:id/vacations', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as VacationBody;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });
    if (!body.title || !body.startDate || !body.endDate) {
      return reply.code(400).send({ error: 'title, startDate and endDate are required' });
    }
    const zone = body.timezone || group.timezone;
    const v = await createVacation(
      {
        groupId: id,
        title: body.title,
        destinations: body.destinations ?? null,
        startDate: body.startDate,
        endDate: body.endDate,
        timezone: body.timezone ?? null,
        description: body.description ?? null,
        travelerIds: body.travelerIds,
      },
      zone,
    );
    return cardDTO(v, zone);
  });

  // Trip detail: trip fields + itinerary (grouped by day) + flights/hotels + travelers.
  app.get('/groups/:id/vacations/:vid', async (req, reply) => {
    const { id, vid } = req.params as { id: string; vid: string };
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });
    const v = await getVacation(id, vid);
    if (!v) return reply.code(404).send({ error: 'vacation not found' });

    const zone = v.timezone ?? group.timezone;
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
  app.patch('/groups/:id/vacations/:vid', async (req, reply) => {
    const { id, vid } = req.params as { id: string; vid: string };
    const body = (req.body ?? {}) as VacationBody;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });
    const existing = await prisma.vacation.findFirst({ where: { id: vid, groupId: id } });
    if (!existing) return reply.code(404).send({ error: 'vacation not found' });

    const zone = (body.timezone ?? existing.timezone) || group.timezone;
    const v = await updateVacation(
      id,
      vid,
      {
        title: body.title,
        destinations: body.destinations === undefined ? undefined : body.destinations || null,
        startDate: body.startDate,
        endDate: body.endDate,
        timezone: body.timezone === undefined ? undefined : body.timezone || null,
        description: body.description === undefined ? undefined : body.description || null,
        travelerIds: body.travelerIds,
      },
      zone,
    );
    if (!v) return reply.code(404).send({ error: 'vacation not found' });
    return cardDTO(v, v.timezone ?? group.timezone);
  });

  // Delete a trip (cascades items + traveler links).
  app.delete('/groups/:id/vacations/:vid', async (req, reply) => {
    const { id, vid } = req.params as { id: string; vid: string };
    const v = await deleteVacation(id, vid);
    if (!v) return reply.code(404).send({ error: 'vacation not found' });
    return { ok: true };
  });

  // Add an itinerary item.
  app.post('/groups/:id/vacations/:vid/items', async (req, reply) => {
    const { id, vid } = req.params as { id: string; vid: string };
    const body = (req.body ?? {}) as VacationItemBody;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });
    const v = await prisma.vacation.findFirst({ where: { id: vid, groupId: id } });
    if (!v) return reply.code(404).send({ error: 'vacation not found' });
    if (!body.title || !body.type || !body.startsAt) {
      return reply.code(400).send({ error: 'type, title and startsAt are required' });
    }
    const zone = v.timezone ?? group.timezone;
    return addVacationItem(vid, { ...body, type: body.type, title: body.title, startsAt: body.startsAt }, zone);
  });

  // Update an itinerary item.
  app.patch('/groups/:id/vacations/:vid/items/:itemId', async (req, reply) => {
    const { id, vid, itemId } = req.params as { id: string; vid: string; itemId: string };
    const body = (req.body ?? {}) as VacationItemBody;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });
    const v = await prisma.vacation.findFirst({ where: { id: vid, groupId: id } });
    if (!v) return reply.code(404).send({ error: 'vacation not found' });
    const zone = v.timezone ?? group.timezone;
    const item = await updateVacationItem(vid, itemId, body, zone);
    if (!item) return reply.code(404).send({ error: 'item not found' });
    return item;
  });

  // Delete an itinerary item.
  app.delete('/groups/:id/vacations/:vid/items/:itemId', async (req, reply) => {
    const { vid, itemId } = req.params as { id: string; vid: string; itemId: string };
    const item = await deleteVacationItem(vid, itemId);
    if (!item) return reply.code(404).send({ error: 'item not found' });
    return { ok: true };
  });
}
