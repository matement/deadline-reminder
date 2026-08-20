// server/routes/tasks.js
const express = require('express');
const router = express.Router();
const { client } = require('../db');
const { generateReminderSchedule } = require('../reminders');

async function scheduleRemindersForTask(taskId, deadlineIso) {
  const schedule = generateReminderSchedule(deadlineIso);
  for (const r of schedule) {
    await client.execute({
      sql: 'INSERT INTO reminders (task_id, type, scheduled_for) VALUES (?, ?, ?)',
      args: [taskId, r.type, r.scheduledFor],
    });
  }
  return schedule.length;
}

// GET /api/tasks — every task, each with its reminder schedule attached
router.get('/', async (req, res, next) => {
  try {
    const [{ rows: tasks }, { rows: reminders }] = await Promise.all([
      client.execute('SELECT * FROM tasks ORDER BY deadline ASC'),
      client.execute('SELECT * FROM reminders ORDER BY scheduled_for ASC'),
    ]);
    const byTask = {};
    for (const r of reminders) {
      (byTask[r.task_id] ??= []).push(r);
    }
    res.json(tasks.map((t) => ({ ...t, reminders: byTask[t.id] || [] })));
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks  { title, notes?, deadline }
router.post('/', async (req, res, next) => {
  try {
    const { title, notes, deadline } = req.body || {};
    if (!title || !deadline) {
      return res.status(400).json({ error: 'title and deadline are required' });
    }
    const { rows } = await client.execute({
      sql: 'INSERT INTO tasks (title, notes, deadline) VALUES (?, ?, ?) RETURNING *',
      args: [title, notes || null, deadline],
    });
    const task = rows[0];
    await scheduleRemindersForTask(task.id, deadline);
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tasks/:id  { title?, notes?, deadline?, completed? }
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows: existingRows } = await client.execute({ sql: 'SELECT * FROM tasks WHERE id = ?', args: [id] });
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'not found' });

    const title = req.body.title ?? existing.title;
    const notes = req.body.notes ?? existing.notes;
    const deadline = req.body.deadline ?? existing.deadline;
    const completed = req.body.completed ?? existing.completed;

    await client.execute({
      sql: 'UPDATE tasks SET title = ?, notes = ?, deadline = ?, completed = ? WHERE id = ?',
      args: [title, notes, deadline, completed ? 1 : 0, id],
    });

    if (deadline !== existing.deadline) {
      await client.execute({ sql: 'DELETE FROM reminders WHERE task_id = ? AND sent = 0', args: [id] });
      await scheduleRemindersForTask(id, deadline);
    }

    const { rows } = await client.execute({ sql: 'SELECT * FROM tasks WHERE id = ?', args: [id] });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await client.execute({ sql: 'DELETE FROM tasks WHERE id = ?', args: [req.params.id] });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
