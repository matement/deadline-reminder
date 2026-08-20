// public/app.js — runs only while the app/tab is open. Push delivery itself
// is handled by service-worker.js, which runs independently of this file.

const API_KEY_STORAGE = 'deadlines.apiKey';

const els = {
  addForm: document.getElementById('add-form'),
  titleInput: document.getElementById('title-input'),
  deadlineInput: document.getElementById('deadline-input'),
  notesInput: document.getElementById('notes-input'),
  toggleNotesBtn: document.getElementById('toggle-notes-btn'),
  taskList: document.getElementById('task-list'),
  completedSection: document.getElementById('completed-section'),
  completedList: document.getElementById('completed-list'),
  completedToggle: document.getElementById('completed-toggle'),
  completedCount: document.getElementById('completed-count'),
  rowTemplate: document.getElementById('task-row-template'),
  notifBtn: document.getElementById('notif-btn'),
  testPushBtn: document.getElementById('test-push-btn'),
  notifStatus: document.getElementById('notif-status'),
};

// ---------- API key (see server/auth.js) ----------
// A normal web app would use cookies/sessions here. This one uses a single
// static key entered once and stored in localStorage, because there's no
// login system — just one person's own devices talking to their own server.

function getApiKey() {
  let key = localStorage.getItem(API_KEY_STORAGE);
  if (key === null) {
    key = window.prompt(
      'API key (set on the server as API_KEY — leave blank if you haven\u2019t set one):'
    ) || '';
    localStorage.setItem(API_KEY_STORAGE, key);
  }
  return key;
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': getApiKey(),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem(API_KEY_STORAGE); // wrong/stale key — ask again next call
    throw new Error('Unauthorized — check your API key');
  }
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

// ---------- Countdown formatting ----------

function formatCountdown(deadlineIso) {
  const diffMs = new Date(deadlineIso).getTime() - Date.now();
  const diffH = diffMs / 3_600_000;

  if (diffMs <= 0) {
    const overdueH = Math.abs(diffH);
    const text = overdueH < 24 ? 'Overdue' : `Overdue \u00b7 ${Math.floor(overdueH / 24)}d`;
    return { text, urgency: 'overdue' };
  }
  if (diffH <= 24) {
    const h = Math.max(1, Math.round(diffH));
    return { text: h === 1 ? 'Due in 1h' : `Due in ${h}h`, urgency: 'urgent' };
  }
  if (diffH <= 72) {
    return { text: `Due in ${Math.round(diffH / 24)}d`, urgency: 'watch' };
  }
  return { text: `Due in ${Math.round(diffH / 24)}d`, urgency: 'calm' };
}

function formatReminderLabel(reminder) {
  const when = new Date(reminder.scheduled_for).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return when;
}

// ---------- Rendering ----------

let tasks = [];

async function loadTasks() {
  tasks = await api('/tasks');
  render();
}

function render() {
  const active = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);

  els.taskList.replaceChildren(...active.map(renderTaskRow));

  els.completedSection.hidden = completed.length === 0;
  els.completedCount.textContent = completed.length;
  els.completedList.replaceChildren(...completed.map((t) => renderTaskRow(t, true)));
}

function renderTaskRow(task, isCompleted = false) {
  const node = els.rowTemplate.content.firstElementChild.cloneNode(true);
  const { text, urgency } = formatCountdown(task.deadline);

  node.classList.toggle('completed', isCompleted);
  node.style.setProperty('--urgency', `var(--${isCompleted ? 'calm' : urgency})`);
  node.querySelector('.task-title').textContent = task.title;
  node.querySelector('.task-countdown').textContent = isCompleted ? 'Done' : text;

  const notesEl = node.querySelector('.task-notes');
  if (task.notes) {
    notesEl.textContent = task.notes;
    notesEl.hidden = false;
  }

  const reminderList = node.querySelector('.reminder-list');
  reminderList.replaceChildren(
    ...task.reminders.map((r) => {
      const li = document.createElement('li');
      li.className = r.sent ? 'sent' : '';
      const dot = document.createElement('span');
      dot.className = 'dot';
      li.append(dot, `${formatReminderLabel(r)} \u2014 ${r.sent ? 'sent' : 'pending'}`);
      return li;
    })
  );
  if (task.reminders.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'None (deadline was already close when this task was created)';
    reminderList.append(li);
  }

  node.querySelector('.task-complete').addEventListener('click', () => toggleComplete(task));
  node.querySelector('.task-delete').addEventListener('click', () => deleteTask(task));

  return node;
}

async function toggleComplete(task) {
  await api(`/tasks/${task.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ completed: task.completed ? 0 : 1 }),
  });
  await loadTasks();
}

async function deleteTask(task) {
  await api(`/tasks/${task.id}`, { method: 'DELETE' });
  await loadTasks();
}

// ---------- Add form ----------

els.toggleNotesBtn.addEventListener('click', () => {
  els.notesInput.hidden = !els.notesInput.hidden;
  if (!els.notesInput.hidden) els.notesInput.focus();
});

els.addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = els.titleInput.value.trim();
  const deadlineLocal = els.deadlineInput.value; // e.g. "2026-08-24T14:00" — no timezone
  if (!title || !deadlineLocal) return;

  // The browser interprets this naive string as *local* time, which is what
  // we want since the person typing it is in that local time. toISOString()
  // then converts it to UTC for storage.
  const deadlineIso = new Date(deadlineLocal).toISOString();

  await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title, deadline: deadlineIso, notes: els.notesInput.value.trim() || undefined }),
  });

  els.addForm.reset();
  els.notesInput.hidden = true;
  await loadTasks();
});

// ---------- Push subscription ----------

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function guessDeviceLabel() {
  const ua = navigator.userAgent;
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/edg\//i.test(ua)) return 'Windows (Edge)';
  if (/chrome/i.test(ua)) return 'Windows (Chrome)';
  return 'Unknown device';
}

async function updateNotifButton() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    els.notifBtn.hidden = true;
    return;
  }
  if (isIos() && !isStandalone()) {
    els.notifBtn.textContent = 'Add to Home Screen to enable notifications';
    els.notifBtn.disabled = true;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  els.notifBtn.textContent = sub ? 'Notifications on' : 'Enable notifications';
  els.testPushBtn.hidden = !sub;
}

async function subscribeToPush() {
  const reg = await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    els.notifStatus.hidden = false;
    els.notifStatus.textContent = 'Notifications are blocked for this app in your browser/OS settings.';
    return;
  }

  const { publicKey } = await api('/push/vapid-public-key');
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await api('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription, deviceLabel: guessDeviceLabel() }),
  });

  await updateNotifButton();
}

els.notifBtn.addEventListener('click', async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe();
      await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: existing.endpoint }) });
    } else {
      await subscribeToPush();
    }
  } catch (err) {
    els.notifStatus.hidden = false;
    els.notifStatus.textContent = err.message;
  }
  await updateNotifButton();
});

els.testPushBtn.addEventListener('click', async () => {
  els.testPushBtn.textContent = 'Sending\u2026';
  try {
    await api('/push/test', { method: 'POST' });
    els.testPushBtn.textContent = 'Sent';
  } catch (err) {
    els.testPushBtn.textContent = 'Failed';
    console.error(err);
  } finally {
    setTimeout(() => (els.testPushBtn.textContent = 'Send test'), 2000);
  }
});

els.completedToggle.addEventListener('click', () => {
  els.completedList.hidden = !els.completedList.hidden;
});

// ---------- Boot ----------

async function boot() {
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('/service-worker.js');
  }
  await updateNotifButton();
  await loadTasks();
  setInterval(render, 60_000); // keep countdowns fresh without a full refetch
}

boot();
