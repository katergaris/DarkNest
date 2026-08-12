const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  if (!q || q === '%%') return res.json([]);

  const results = [];

  db.prepare("SELECT id, title FROM ideas WHERE deleted_at IS NULL AND (title LIKE ? OR body LIKE ? OR tags LIKE ?)")
    .all(q, q, q)
    .forEach((r) => results.push({ type: 'idea', id: r.id, label: r.title }));

  db.prepare("SELECT id, title FROM projects WHERE deleted_at IS NULL AND (title LIKE ? OR description LIKE ? OR tags LIKE ?)")
    .all(q, q, q)
    .forEach((r) => results.push({ type: 'project', id: r.id, label: r.title }));

  db.prepare("SELECT id, site FROM vault_entries WHERE deleted_at IS NULL AND (site LIKE ? OR username LIKE ? OR notes LIKE ? OR tags LIKE ?)")
    .all(q, q, q, q)
    .forEach((r) => results.push({ type: 'vault', id: r.id, label: r.site }));

  db.prepare("SELECT id, service FROM accounts WHERE deleted_at IS NULL AND (service LIKE ? OR email LIKE ? OR notes LIKE ? OR tags LIKE ?)")
    .all(q, q, q, q)
    .forEach((r) => results.push({ type: 'account', id: r.id, label: r.service }));

  db.prepare("SELECT id, original_name FROM documents WHERE deleted_at IS NULL AND (original_name LIKE ? OR folder LIKE ? OR tags LIKE ?)")
    .all(q, q, q)
    .forEach((r) => results.push({ type: 'document', id: r.id, label: r.original_name }));

  db.prepare("SELECT id, title FROM dossiers WHERE deleted_at IS NULL AND (title LIKE ? OR description LIKE ?)")
    .all(q, q)
    .forEach((r) => results.push({ type: 'dossier', id: r.id, label: r.title }));

  res.json(results);
});

// Elementi con scadenza vicina (account e documenti), usati per i promemoria
router.get('/reminders/upcoming', (req, res) => {
  const days = parseInt(req.query.days, 10) || 30;
  const limit = `+${days} days`;

  const accounts = db
    .prepare(
      "SELECT id, service AS label, renewal_date AS date FROM accounts WHERE deleted_at IS NULL AND renewal_date IS NOT NULL AND date(renewal_date) <= date('now', ?) ORDER BY renewal_date ASC"
    )
    .all(limit)
    .map((r) => ({ ...r, type: 'account' }));

  const documents = db
    .prepare(
      "SELECT id, original_name AS label, expiry_date AS date FROM documents WHERE deleted_at IS NULL AND expiry_date IS NOT NULL AND date(expiry_date) <= date('now', ?) ORDER BY expiry_date ASC"
    )
    .all(limit)
    .map((r) => ({ ...r, type: 'document' }));

  res.json([...accounts, ...documents].sort((a, b) => (a.date > b.date ? 1 : -1)));
});

module.exports = router;
