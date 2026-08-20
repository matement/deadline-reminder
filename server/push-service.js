// server/push-service.js
//
// Sends one push payload to every subscribed device (phone, laptop, ...).
// web-push handles the VAPID signing and routes to whichever push service
// owns that subscription's endpoint (Apple, FCM, Microsoft, Mozilla) — same
// call regardless of platform, which is the whole point of the Push API /
// VAPID being a standard rather than a per-vendor SDK.

const webpush = require('web-push');
const { client } = require('./db');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:you@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendToSubscription(sub, payload) {
  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  try {
    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // The push service is telling us this subscription is dead (browser
      // uninstalled the PWA, cleared site data, etc). Stop trying it.
      await client.execute({ sql: 'DELETE FROM push_subscriptions WHERE id = ?', args: [sub.id] });
      return { ok: false, reason: 'expired_subscription_removed' };
    }
    console.error('[push] send failed:', err.statusCode, err.body || err.message);
    return { ok: false, reason: 'send_failed' };
  }
}

/** Sends `payload` to every currently-registered device. Never throws — failures are per-device. */
async function sendToAllSubscriptions(payload) {
  const { rows } = await client.execute('SELECT * FROM push_subscriptions');
  const results = await Promise.all(rows.map((sub) => sendToSubscription(sub, payload)));
  return results;
}

module.exports = { sendToAllSubscriptions, sendToSubscription };
