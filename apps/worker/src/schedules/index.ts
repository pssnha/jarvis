import cron from 'node-cron';
import { pollMailbox } from '../email/imap';
import { sendDueReminders } from '../reminders';

/** Register cron-scheduled jobs. */
export function startSchedules(): void {
  // Poll the Jarvis mailbox for forwarded schedules.
  const emailCron = process.env.EMAIL_POLL_CRON ?? '*/2 * * * *';
  cron.schedule(emailCron, () => {
    void pollMailbox();
  });

  // Send reminders for upcoming events.
  const reminderCron = process.env.REMINDER_CRON ?? '*/15 * * * *';
  cron.schedule(reminderCron, () => {
    void sendDueReminders();
  });

  console.log(`[scheduler] email poll "${emailCron}", reminders "${reminderCron}"`);
}
