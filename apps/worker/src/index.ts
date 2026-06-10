import './loadEnv';
import { startJobWorker } from './jobs';
import { startSchedules } from './schedules';
import { startAllSessions } from './whatsapp/client';

function main(): void {
  console.log('[worker] starting…');
  startJobWorker();
  startSchedules();
  // Start one WhatsApp linked-device session per circle (QRs surface per-circle
  // in the Admin page). New circles start via the `wa:control` Redis channel.
  void startAllSessions().catch((err) => console.error('[wa] failed to start sessions:', err));
}

main();
