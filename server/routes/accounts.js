const express = require('express');
const db = require('../db');
const router = express.Router();

const VALID_TYPES = ['digitale', 'cartaceo'];

function serialize(row) {
  return { ...row, tags: JSON.parse(row.tags || '[]') };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY updated_at DESC').all();
  res.json(rows.map(serialize));
});

router.post('/', (req, res) => {
  const { service, type = 'digitale', email = '', plan = '', location = '', payment_method = '', renewal_date = null, notes = '', tags = [] } = req.body;
  if (!service) return res.status(400).json({ error: 'Il servizio e\' obbligatorio' });
  const finalType = VALID_TYPES.includes(type) ? type : 'digitale';
  const info = db
    .prepare('INSERT INTO accounts (service, type, email, plan, location, payment_method, renewal_date, notes, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(service, finalType, email, plan, location, payment_method, renewal_date, notes, JSON.stringify(tags));
  res.status(201).json(serialize(db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Account non trovato' });
  const { service, type, email, plan, location, payment_method, renewal_date, notes, tags } = req.body;
  const finalType = type && VALID_TYPES.includes(type) ? type : existing.type;
  db.prepare(
    "UPDATE accounts SET service = ?, type = ?, email = ?, plan = ?, location = ?, payment_method = ?, renewal_date = ?, notes = ?, tags = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    service ?? existing.service,
    finalType,
    email ?? existing.email,
    plan ?? existing.plan,
    location ?? existing.location,
    payment_method ?? existing.payment_method,
    renewal_date !== undefined ? renewal_date : existing.renewal_date,
    notes ?? existing.notes,
    JSON.stringify(tags ?? JSON.parse(existing.tags || '[]')),
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
