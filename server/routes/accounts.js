const express = require('express');
const db = require('../db');
const router = express.Router();

function serialize(row) {
  return { ...row, tags: JSON.parse(row.tags || '[]') };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY updated_at DESC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { service, email = '', plan = '', renewal_date = null, notes = '', tags = [] } = req.body;
  if (!service) return res.status(400).json({ error: 'Il servizio e\' obbligatorio' });
  const info = db
    .prepare('INSERT INTO accounts (service, email, plan, renewal_date, notes, tags) VALUES (?, ?, ?, ?, ?, ?)')
    .run(service, email, plan, renewal_date, notes, JSON.stringify(tags));
  res.status(201).json(serialize(db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Account non trovato' });
  const { service, email, plan, renewal_date, notes, tags } = req.body;
  db.prepare(
    "UPDATE accounts SET service = ?, email = ?, plan = ?, renewal_date = ?, notes = ?, tags = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    service ?? existing.service,
    email ?? existing.email,
    plan ?? existing.plan,
    renewal_date !== undefined ? renewal_date : existing.renewal_date,
    notes ?? existing.notes,
    JSON.stringify(tags ?? JSON.parse(existing.tags)),
    req.params.id
  );
  res.json(serialize(db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare("UPDATE accounts SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.post('/:id/restore', (req, res) => {
  db.prepare('UPDATE accounts SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
