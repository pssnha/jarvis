import './loadEnv';
import { startJobWorker } from './jobs';
import { startSchedules } from './schedules';
import { startEmailControl } from './email/circlePoll';
import { startAllSessions } from './whatsapp/client';

function main(): void {
  console.log('[worker] starting…');
  startJobWorker();
  startSchedules();
  startEmailControl(); // ad-hoc "Poll now" requests from the Admin page
  // Start one WhatsApp linked-device session per circle (QRs surface per-circle
  // in the Admin page). New circles start via the `wa:control` Redis channel.
  void startAllSessions().catch((err) => console.error('[wa] failed to start sessions:', err));
}

main();
