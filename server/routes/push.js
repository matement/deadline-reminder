// server/routes/push.js
const express = require('express');
const router = express.Router();
const { client } = require('../db');
const { sendToAllSubscriptions } = require('../push-service');

// GET /api/push/vapid-public-key — the frontend needs this to call pushManager.subscribe()
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe  { subscription, deviceLabel? }
router.post('/subscribe', async (req, res, next) => {
  try {
    const { subscription, deviceLabel } = req.body || {};
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'invalid subscription' });
    }
    await client.execute({
      sql: `
        INSERT INTO push_subscriptions (endpoint, p256dh, auth, device_label)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          device_label = excluded.device_label
      `,
      args: [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, deviceLabel || null],
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/push/unsubscribe  { endpoint }
router.post('/unsubscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
    await client.execute({ sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?', args: [endpoint] });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/push/test — fire an immediate notification to every registered device
router.post('/test', async (req, res, next) => {
  try {
    const results = await sendToAllSubscriptions({
      title: 'Test notification',
      body: 'If you can see this, push is working.',
    });
    res.json({ ok: true, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
