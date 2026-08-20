require('dotenv').config();
const path = require('path');
const express = require('express');

const { initDb } = require('./db');
const { requireApiKey } = require('./auth');
const { startScheduler, checkAndSendReminders } = require('./scheduler');
const tasksRouter = require('./routes/tasks');
const pushRouter = require('./routes/push');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json());

// Unauthenticated, unprefixed: cheap for an external uptime/cron pinger to hit
// with no headers. Also the endpoint that keeps a free-tier host from
// sleeping and (via /healthz?run=1) directly triggers a reminder check — see
// README "Keeping it awake + as a heartbeat".
app.get('/healthz', async (req, res, next) => {
  try {
    if (req.query.run === '1') {
      console.log('[healthz] scheduler check triggered');
      const result = await checkAndSendReminders();
      console.log('[healthz] scheduler check finished:', JSON.stringify(result));
      return res.json({ ok: true, ranScheduler: true, ...result });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[healthz] scheduler check threw:', err);
    next(err);
  }
});

app.use('/api', requireApiKey);
app.use('/api/tasks', tasksRouter);
app.use('/api/push', pushRouter);

// Static frontend — same origin as the API, so no CORS setup needed.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] listening on http://localhost:${PORT}`);
      startScheduler();
    });
  })
  .catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
