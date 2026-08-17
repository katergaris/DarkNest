const express = require('express');
const db = require('../db');
const router = express.Router();

const VALID_STATUSES = ['da_fare', 'in_corso', 'fatto'];

function serialize(row) {
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    checklist: JSON.parse(row.checklist || '[]'),
    contacts: JSON.parse(row.contacts || '[]'),
    budget: JSON.parse(row.budget || '[]'),
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { title, description = '', status = 'da_fare', checklist = [], tags = [], deadline = null, contacts = [], budget = [] } = req.body;
  if (!title) return res.status(400).json({ error: 'Il titolo e\' obbligatorio' });
  const finalStatus = VALID_STATUSES.includes(status) ? status : 'da_fare';
  const info = db
    .prepare('INSERT INTO projects (title, description, status, checklist, tags, deadline, contacts, budget) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(title, description, finalStatus, JSON.stringify(checklist), JSON.stringify(tags), deadline || null, JSON.stringify(contacts), JSON.stringify(budget));
  res.status(201).json(serialize(db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Progetto non trovato' });
  const { title, description, status, checklist, tags, deadline, contacts, budget } = req.body;
  const finalStatus = status && VALID_STATUSES.includes(status) ? status : existing.status;
  db.prepare(
    "UPDATE projects SET title = ?, description = ?, status = ?, checklist = ?, tags = ?, deadline = ?, contacts = ?, budget = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    title ?? existing.title,
    description ?? existing.description,
    finalStatus,
    JSON.stringify(checklist ?? JSON.parse(existing.checklist || '[]')),
    JSON.stringify(tags ?? JSON.parse(existing.tags || '[]')),
    deadline !== undefined ? (deadline || null) : existing.deadline,
    JSON.stringify(contacts ?? JSON.parse(existing.contacts || '[]')),
    JSON.stringify(budget ?? JSON.parse(existing.budget || '[]')),
    req.params.id
  );
  res.json(serialize(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare("UPDATE projects SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.post('/:id/restore', (req, res) => {
  db.prepare('UPDATE projects SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
