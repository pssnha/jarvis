import cron from 'node-cron';
import { pollCircleMailboxes } from '../email/circlePoll';
import { sendDueReminders } from '../reminders';
import { sendDailyBriefs } from '../dailyBrief';
import { runHealthCheck } from '../maintenance';

/** Register cron-scheduled jobs (all maintenance jobs are mutable per circle). */
export function startSchedules(): void {
  // Poll each circle's dedicated mailbox and propose detected items.
  const emailCron = process.env.EMAIL_POLL_CRON ?? '*/2 * * * *';
  cron.schedule(emailCron, () => {
    void pollCircleMailboxes();
  });

  // Fire reminders as each (possibly recurring) occurrence comes due.
  const reminderCron = process.env.REMINDER_CRON ?? '* * * * *';
  cron.schedule(reminderCron, () => {
    void sendDueReminders();
  });

  // Daily brief: hourly tick; posts each group's day at its circle's local brief hour.
  cron.schedule('0 * * * *', () => {
    void sendDailyBriefs();
  });

  // Health check: every 30 minutes, verify DB/Redis/WhatsApp and log the result.
  const healthCron = process.env.HEALTH_CHECK_CRON ?? '*/30 * * * *';
  cron.schedule(healthCron, () => {
    void runHealthCheck();
  });

  console.log(
    `[scheduler] email poll "${emailCron}", reminders "${reminderCron}", daily brief hourly, health "${healthCron}"`,
  );
}
