// server/auth.js
//
// This app has no login system — it's built for one person, on their own
// devices. But once it's deployed, it sits at a public URL. Without anything
// checking requests, anyone who finds that URL could read your task list or
// register their own device to your push subscriptions. This is a single
// shared-secret check, not real auth — proportionate to what's actually at
// stake (a personal task list), not a login system you didn't ask for.
//
// If API_KEY isn't set at all, this is a no-op — convenient for local dev on
// localhost. Set API_KEY once you deploy somewhere public.

function requireApiKey(req, res, next) {
  if (!process.env.API_KEY) return next();
  if (req.header('X-API-Key') !== process.env.API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

module.exports = { requireApiKey };
