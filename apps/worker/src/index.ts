import './loadEnv';
import { startJobWorker } from './jobs';
import { startSchedules } from './schedules';
import { startWhatsApp } from './whatsapp/client';

function main(): void {
  console.log('[worker] starting…');
  startJobWorker();
  startSchedules();
  // Start the WhatsApp linked-device client (QR surfaces in the Admin page).
  void startWhatsApp().catch((err) => console.error('[wa] failed to start:', err));
}

main();
