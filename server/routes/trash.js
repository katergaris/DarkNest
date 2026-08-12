const express = require('express');
const db = require('../db');
const router = express.Router();

const RESOURCES = {
  idea: { table: 'ideas', label: (r) => r.title },
  project: { table: 'projects', label: (r) => r.title },
  vault: { table: 'vault_entries', label: (r) => r.site },
  account: { table: 'accounts', label: (r) => r.service },
  document: { table: 'documents', label: (r) => r.original_name },
  dossier: { table: 'dossiers', label: (r) => r.title },
};

router.get('/', (req, res) => {
  const items = [];
  for (const [type, def] of Object.entries(RESOURCES)) {
    const rows = db.prepare(`SELECT * FROM ${def.table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all();
    rows.forEach((r) => items.push({ type, id: r.id, label: def.label(r), deleted_at: r.deleted_at }));
  }
  items.sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
  res.json(items);
});

router.post('/:type/:id/restore', (req, res) => {
  const def = RESOURCES[req.params.type];
  if (!def) return res.status(400).json({ error: 'Tipo non valido' });
  db.prepare(`UPDATE ${def.table} SET deleted_at = NULL WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

router.delete('/:type/:id', (req, res) => {
  const def = RESOURCES[req.params.type];
  if (!def) return res.status(400).json({ error: 'Tipo non valido' });
  db.prepare(`DELETE FROM ${def.table} WHERE id = ? AND deleted_at IS NOT NULL`).run(req.params.id);
  res.status(204).end();
});

module.exports = router;
