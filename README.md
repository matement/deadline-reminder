# Deadlines

Self-hosted PWA for escalating deadline reminders, delivered via real Web
Push (works with the app closed and the device locked).

## How a reminder actually reaches a locked phone

Your server never talks to the phone directly — it can't, it doesn't have a
persistent connection to it. Instead:

1. When you set a deadline, the server precomputes every reminder's fire time
   into a `reminders` table (see `server/reminders.js`).
2. Once an hour (`server/scheduler.js`), it checks for due reminders.
3. For each one, `web-push` signs a message with your VAPID key and hands it
   to whichever service owns that device's subscription — Apple, Google, or
   Microsoft's push service. This is a permanent, low-power connection the OS
   itself maintains; your server doesn't need to.
4. That service relays it to the device, which wakes `service-worker.js`
   (independent of whether the app/tab is open) to show the notification.

## Why a couple of things differ from the original plan

- **`@libsql/client` instead of `better-sqlite3`.** Functionally this is still
  SQLite — same SQL, same schema. Locally, with no Turso env vars set, it
  just opens a local file exactly like `better-sqlite3` would (`db.js` falls
  back automatically). The reason for the swap: free tiers on Render/Fly.io/
  Railway either don't include a persistent disk or don't include a real
  always-on free tier at all (checked August 2026 — see chat for sources).
  Writing to local disk on Render's free tier specifically is not guaranteed
  to survive a restart. Turso's free tier is real hosted SQLite (libSQL) that
  persists independently of whichever compute instance is running your code.
- **A lightweight API key**, not a login system. See `server/auth.js`.
- **`/healthz?run=1`** exists so an external scheduler can trigger a reminder
  check directly, not just rely on the in-process hourly timer — see
  "Keeping it awake" below.

## Local setup

```bash
npm install
npm run dev          # nodemon, restarts on file changes
```

Open `http://localhost:3000`. `.env` already has a working VAPID keypair and
API key generated, and `TURSO_*` are left unset, so this runs with zero setup.
`data/app.db` is created automatically.

To reset local data: stop the server, delete `data/app.db`, restart.

## Tuning the reminder schedule

Everything about *when* reminders fire lives in `server/reminders.js`:

```js
const DAYS_BEFORE = [5, 3, 1];
const DAY_OF_HOURS = [9, 13, 17, 20]; // 24h clock, Europe/Athens
```

Change `LOCAL_TIMEZONE` there too if that's ever not the right zone.

## Deploying (so it runs even when your devices are off)

**Render (free web service) + Turso (free hosted SQLite) + a free external
cron ping.**

1. Push this repo to GitHub (`.env` is gitignored — don't commit it).
2. [render.com](https://render.com) → New → Web Service → connect the repo.
   Build command `npm install`, start command `npm start`.
3. In Render's environment variables, set everything from `.env` — copy your
   real `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` / `API_KEY`
   over. Also set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (below) — do
   **not** rely on local disk here.
4. Set up Turso (free, no credit card):
   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   turso auth login
   turso db create deadlines
   turso db show deadlines --url          # → TURSO_DATABASE_URL
   turso db tokens create deadlines       # → TURSO_AUTH_TOKEN
   ```
5. Deploy. You'll get a URL like `https://deadlines-xxxx.onrender.com`.

### Keeping it awake + as a heartbeat

Render's free web services sleep after 15 minutes with no inbound traffic,
and a sleeping process can't run the hourly cron. Fix both problems with one
free external ping:

1. [cron-job.org](https://cron-job.org) (free, no card) → create a job hitting
   `https://your-app.onrender.com/healthz?run=1` every 10–15 minutes.
2. This keeps the service warm *and* directly triggers a reminder check each
   time — so even if a sleep/wake cycle is missed, the ping itself is the
   trigger, not just a wake-up call. 24/7 uptime this way stays under
   Render's 750 free instance-hours/month.

## Testing push end-to-end

Each device: open the installed app → **Enable notifications** → grant the
permission prompt → a **Send test** button appears → tap it. A notification
should arrive within a few seconds, including if you lock the device or close
the app first.

## Installing on iPhone

Safari → Share → **Add to Home Screen** → open the app from the home screen
icon (not from Safari) → **Enable notifications** inside it.

**Read the iOS gotchas before doing this — see chat.** The short version: iOS
only allows push for installed home-screen apps, never for a regular Safari
tab, and the notification prompt has to come from inside the installed app.

## Installing on Windows

Edge or Chrome → address bar install icon (or ⋯ menu → Apps → Install this
site as an app) → **Enable notifications** inside the installed app.

For notifications to survive fully closing the browser (not just locking the
screen — locking is fine either way): Edge, `edge://settings/system` →
enable **"Startup boost"**. Chrome doesn't reliably keep receiving push once
every one of its windows (including the installed app) is closed — Edge is
the more robust choice on Windows for this reason.

## Security note

There's no login system — this is built for one person's own devices. The
`API_KEY` in `.env` is the only thing standing between your public URL and
anyone who finds it. It's proportionate for a personal task list, not meant
to be bank-grade.
