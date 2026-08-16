const express = require('express');
const db = require('../db');
const router = express.Router();

const TABLES = {
  idea: { table: 'ideas', label: (r) => r.title },
  project: { table: 'projects', label: (r) => r.title },
  vault: { table: 'vault_entries', label: (r) => r.site },
  account: { table: 'accounts', label: (r) => r.service },
  document: { table: 'documents', label: (r) => r.display_name || r.original_name },
  reminder: { table: 'reminders', label: (r) => r.label },
};

function serializeDossier(row) {
  const links = db.prepare('SELECT * FROM dossier_links WHERE dossier_id = ?').all(row.id);
  const items = links
    .map((link) => {
      const def = TABLES[link.item_type];
      if (!def) return null;
      const item = db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(link.item_id);
      if (!item || item.deleted_at) return null;
      // Non esporre mai la password cifrata nel riepilogo del fascicolo
      if (link.item_type === 'vault') delete item.password_encrypted;
      return { type: link.item_type, id: item.id, label: def.label(item) };
    })
    .filter(Boolean);
  return { ...row, items };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM dossiers WHERE deleted_at IS NULL ORDER BY updated_at DESC').all();
  res.json(rows.map(serializeDossier));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM dossiers WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fascicolo non trovato' });
  res.json(serializeDossier(row));
});

router.post('/', (req, res) => {
  const { title, description = '' } = req.body;
  if (!title) return res.status(400).json({ error: 'Il titolo e\' obbligatorio' });
  const info = db.prepare('INSERT INTO dossiers (title, description) VALUES (?, ?)').run(title, description);
  res.status(201).json(serializeDossier(db.prepare('SELECT * FROM dossiers WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM dossiers WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Fascicolo non trovato' });
  const { title, description } = req.body;
  db.prepare("UPDATE dossiers SET title = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(
    title ?? existing.title,
    description ?? existing.description,
    req.params.id
  );
  res.json(serializeDossier(db.prepare('SELECT * FROM dossiers WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare("UPDATE dossiers SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.post('/:id/restore', (req, res) => {
  db.prepare('UPDATE dossiers SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

router.post('/:id/links', (req, res) => {
  const { item_type, item_id } = req.body || {};
  const def = TABLES[item_type];
  if (!def) return res.status(400).json({ error: 'Tipo di elemento non valido' });
  const itemId = Number.parseInt(item_id, 10);
  if (!Number.isInteger(itemId)) return res.status(400).json({ error: 'Elemento non valido' });

  const dossier = db.prepare('SELECT * FROM dossiers WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!dossier) return res.status(404).json({ error: 'Fascicolo non trovato' });

  // Senza questo controllo si potevano creare collegamenti verso elementi
  // inesistenti o gia' nel cestino, che poi sparivano dal fascicolo senza spiegazione.
  const item = db.prepare(`SELECT id FROM ${def.table} WHERE id = ? AND deleted_at IS NULL`).get(itemId);
  if (!item) return res.status(404).json({ error: 'Elemento da collegare non trovato' });

  try {
    db.prepare('INSERT INTO dossier_links (dossier_id, item_type, item_id) VALUES (?, ?, ?)').run(
      dossier.id,
      item_type,
      itemId
    );
  } catch (e) {
    // Collegamento gia' presente (vincolo UNIQUE): non e' un errore.
    if (!String(e.code || '').includes('CONSTRAINT_UNIQUE')) throw e;
  }
  res.status(201).json(serializeDossier(dossier));
});

router.delete('/:id/links/:itemType/:itemId', (req, res) => {
  db.prepare('DELETE FROM dossier_links WHERE dossier_id = ? AND item_type = ? AND item_id = ?').run(
    req.params.id,
    req.params.itemType,
    req.params.itemId
  );
  res.status(204).end();
});

module.exports = router;
