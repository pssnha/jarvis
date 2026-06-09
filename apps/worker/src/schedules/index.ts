import cron from 'node-cron';
import { pollMailbox } from '../email/imap';
import { pollGroupMailboxes } from '../email/groupPoll';
import { sendDueReminders } from '../reminders';
import { sendDailyBriefs } from '../dailyBrief';

/** Register cron-scheduled jobs. */
export function startSchedules(): void {
  // Poll the Jarvis mailbox for forwarded schedules (legacy global IMAP).
  const emailCron = process.env.EMAIL_POLL_CRON ?? '*/2 * * * *';
  cron.schedule(emailCron, () => {
    void pollMailbox();
  });

  // Poll each group's dedicated mailbox and propose detected items.
  const groupEmailCron = process.env.EMAIL_GROUP_POLL_CRON ?? '0 */2 * * *';
  cron.schedule(groupEmailCron, () => {
    void pollGroupMailboxes();
  });

  // Fire reminders as each (possibly recurring) occurrence comes due.
  const reminderCron = process.env.REMINDER_CRON ?? '* * * * *';
  cron.schedule(reminderCron, () => {
    void sendDueReminders();
  });

  // Daily brief: hourly tick; posts each group's day at its local brief hour.
  cron.schedule('0 * * * *', () => {
    void sendDailyBriefs();
  });

  console.log(
    `[scheduler] email poll "${emailCron}", group email "${groupEmailCron}", reminders "${reminderCron}", daily brief hourly`,
  );
}
