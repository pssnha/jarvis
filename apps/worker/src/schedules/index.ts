import cron from 'node-cron';

/** Register cron-scheduled jobs. */
export function startSchedules(): void {
  // Example: runs every minute. Replace with real scheduled work.
  cron.schedule('* * * * *', () => {
    console.log(`[scheduler] tick at ${new Date().toISOString()}`);
  });
}
