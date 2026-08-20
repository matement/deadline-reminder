// server/scheduler.js
//
// The core loop: find reminders whose time has come, push them, mark them sent.
//
// This runs two ways at once, which is deliberate:
//   1. An in-process node-cron job, once an hour, for when the server is
//      simply up and running.
//   2. checkAndSendReminders() is also exported so routes/scheduler.js can
//      expose it over HTTP — because on a free host that spins down when
//      idle, an in-process timer can't fire while the process is asleep. An
//      external ping (see README: "Keeping it awake + as a heartbeat") hits
//      that endpoint every ~10 minutes, which both wakes the service and
//      triggers a check directly, so the two mechanisms back each other up.
//
// The due-reminders query is restart-safe by construction: it selects
// anything with scheduled_for <= now that hasn't been sent yet, so a missed
// hour (server was asleep, redeploying, whatever) just gets caught on the
// next check rather than lost.

const cron = require('node-cron');
const { client } = require('./db');
const { sendToAllSubscriptions } = require('./push-service');
const { describeReminder } = require('./reminders');

async function checkAndSendReminders() {
  const nowIso = new Date().toISOString();
  const { rows: due } = await client.execute({
    sql: `
      SELECT reminders.id, reminders.type, reminders.task_id,
             tasks.title, tasks.deadline
      FROM reminders
      JOIN tasks ON tasks.id = reminders.task_id
      WHERE reminders.sent = 0
        AND reminders.scheduled_for <= ?
        AND tasks.completed = 0
    `,
    args: [nowIso],
  });

  for (const reminder of due) {
    await sendToAllSubscriptions({
      title: reminder.title,
      body: describeReminder(reminder.type),
      taskId: reminder.task_id,
    });
    await client.execute({
      sql: 'UPDATE reminders SET sent = 1, sent_at = ? WHERE id = ?',
      args: [new Date().toISOString(), reminder.id],
    });
  }

  return { checked: nowIso, sent: due.length };
}

function startScheduler() {
  checkAndSendReminders().catch((err) => console.error('[scheduler] startup check failed:', err));
  cron.schedule('0 * * * *', () => {
    checkAndSendReminders().catch((err) => console.error('[scheduler] tick failed:', err));
  });
  console.log('[scheduler] hourly job scheduled (0 * * * *)');
}

module.exports = { startScheduler, checkAndSendReminders };
