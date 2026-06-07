import './loadEnv';
import { startJobWorker } from './jobs';
import { startSchedules } from './schedules';

function main(): void {
  console.log('[worker] starting…');
  startJobWorker();
  startSchedules();
}

main();
