// server/reminders.js
//
// Turns a single deadline into the full escalating reminder schedule:
//   - 5 days before
//   - 3 days before
//   - 1 day before
//   - several reminders spaced through the day of the deadline itself
//
// This is the one function that encodes "what reminders does a task get" —
// tune DAYS_BEFORE / DAY_OF_HOURS and every new task picks up the change.
//
// Why Luxon: the "day of" reminders need to know what 9am/1pm/5pm/8pm MEAN in
// your calendar day, not the server's. A free host's clock typically runs in
// UTC. Plain JS Date.setHours() operates in the server's local time, which
// would silently shift your "day of" reminders by hours once deployed. Luxon
// lets us pin that calculation to a named IANA zone regardless of where the
// process happens to run.

const { DateTime } = require('luxon');

const LOCAL_TIMEZONE = 'Europe/Athens'; // change this if you're ever elsewhere
const DAYS_BEFORE = [5, 3, 1];
const DAY_OF_HOURS = [9, 13, 17, 20]; // 24h clock, local time on the deadline's calendar day

/**
 * @param {string} deadlineIso - UTC ISO datetime string for the deadline
 * @param {string} [nowIso] - UTC ISO datetime to treat as "now" (defaults to actual now; overridable for tests)
 * @returns {{type: string, scheduledFor: string}[]} reminders with a UTC ISO `scheduledFor`
 */
function generateReminderSchedule(deadlineIso, nowIso = new Date().toISOString()) {
  const deadline = DateTime.fromISO(deadlineIso, { zone: 'utc' }).setZone(LOCAL_TIMEZONE);
  const now = DateTime.fromISO(nowIso, { zone: 'utc' });

  if (!deadline.isValid) {
    throw new Error(`Invalid deadline: ${deadlineIso}`);
  }

  const schedule = [];

  // Skip anything that would already be in the past — e.g. a task created two
  // days before its own deadline shouldn't get a flood of overdue "5 days
  // before" / "3 days before" pushes the moment the next cron tick runs.
  const consider = (type, dt) => {
    if (dt.toUTC() > now) {
      schedule.push({ type, scheduledFor: dt.toUTC().toISO() });
    }
  };

  for (const days of DAYS_BEFORE) {
    consider(`${days}_day${days === 1 ? '' : 's'}_before`, deadline.minus({ days }));
  }

  const dayStart = deadline.startOf('day');
  for (const hour of DAY_OF_HOURS) {
    const t = dayStart.set({ hour, minute: 0, second: 0, millisecond: 0 });
    if (t < deadline) {
      consider(`day_of_${hour}h`, t);
    }
  }

  // Always land one reminder right at the deadline moment itself, whatever time it is.
  consider('deadline_moment', deadline);

  schedule.sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1));
  return schedule;
}

/** Human-readable body text for a push notification, given a reminder type. */
function describeReminder(type) {
  const exact = {
    '5_days_before': 'Due in 5 days',
    '3_days_before': 'Due in 3 days',
    '1_day_before': 'Due tomorrow',
    deadline_moment: 'Due now',
  };
  if (exact[type]) return exact[type];
  if (type.startsWith('day_of_')) return 'Due today';
  return 'Reminder';
}

module.exports = { generateReminderSchedule, describeReminder, LOCAL_TIMEZONE, DAYS_BEFORE, DAY_OF_HOURS };
