import type { FastifyInstance } from 'fastify';

export async function registerHealth(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'jarvis-api',
    time: new Date().toISOString(),
  }));
}
