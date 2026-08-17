const express = require('express');
const db = require('../db');
const router = express.Router();

// In LIKE i caratteri % e _ sono jolly: senza escape cercare "100%" o "a_b"
// restituiva risultati non pertinenti (o addirittura tutto il contenuto).
function likePattern(raw) {
  return `%${raw.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

router.get('/', (req, res) => {
  const raw = String(req.query.q || '').trim();
  if (!raw) return res.json([]);
  const q = likePattern(raw);

  const results = [];

  db.prepare("SELECT id, title FROM ideas WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
    .all(q, q, q)
    .forEach((r) => results.push({ type: 'idea', id: r.id, label: r.title }));

  db.prepare("SELECT id, title FROM projects WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
    .all(q, q, q)
    .forEach((r) => results.push({ type: 'project', id: r.id, label: r.title }));

  db.prepare("SELECT id, site FROM vault_entries WHERE deleted_at IS NULL AND (site LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
    .all(q, q, q, q)
    .forEach((r) => results.push({ type: 'vault', id: r.id, label: r.site }));

  db.prepare("SELECT id, service FROM accounts WHERE deleted_at IS NULL AND (service LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
    .all(q, q, q, q)
    .forEach((r) => results.push({ type: 'account', id: r.id, label: r.service }));

  db.prepare("SELECT id, original_name, display_name FROM documents WHERE deleted_at IS NULL AND (original_name LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR folder LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')")
    .all(q, q, q, q)
    .forEach((r) => results.push({ type: 'document', id: r.id, label: r.display_name || r.original_name }));

  db.prepare("SELECT id, title FROM dossiers WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')")
    .all(q, q)
    .forEach((r) => results.push({ type: 'dossier', id: r.id, label: r.title }));

  db.prepare("SELECT id, label FROM reminders WHERE deleted_at IS NULL AND (label LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')")
    .all(q, q)
    .forEach((r) => results.push({ type: 'reminder', id: r.id, label: r.label }));

  res.json(results);
});

// Elementi con scadenza vicina (account e documenti), usati per i promemoria
router.get('/reminders/upcoming', (req, res) => {
  const parsed = parseInt(req.query.days, 10);
  // Un valore assente, negativo o assurdo rendeva la query priva di senso
  // (finestra al passato o interrogazione senza limite).
  const days = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 3650) : 30;
  const limit = `+${days} days`;

  const accounts = db
    .prepare(
      "SELECT id, service AS label, renewal_date AS date FROM accounts WHERE deleted_at IS NULL AND renewal_date IS NOT NULL AND date(renewal_date) <= date('now', ?) ORDER BY renewal_date ASC"
    )
    .all(limit)
    .map((r) => ({ ...r, type: 'account' }));

  const documents = db
    .prepare(
      "SELECT id, COALESCE(NULLIF(display_name, ''), original_name) AS label, expiry_date AS date FROM documents WHERE deleted_at IS NULL AND expiry_date IS NOT NULL AND date(expiry_date) <= date('now', ?) ORDER BY expiry_date ASC"
    )
    .all(limit)
    .map((r) => ({ ...r, type: 'document' }));

  const reminders = db
    .prepare(
      "SELECT id, label, date FROM reminders WHERE deleted_at IS NULL AND date(date) <= date('now', ?) ORDER BY date ASC"
    )
    .all(limit)
    .map((r) => ({ ...r, type: 'reminder' }));

  const projects = db
    .prepare(
      "SELECT id, title AS label, deadline AS date FROM projects WHERE deleted_at IS NULL AND deadline IS NOT NULL AND date(deadline) <= date('now', ?) ORDER BY deadline ASC"
    )
    .all(limit)
    .map((r) => ({ ...r, type: 'project' }));

  res.json([...accounts, ...documents, ...reminders, ...projects].sort((a, b) => (a.date > b.date ? 1 : -1)));
});

module.exports = router;
