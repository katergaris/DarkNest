const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const db = require('../db');
const { encrypt, decrypt } = require('../crypto');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function serialize(row, { reveal = false } = {}) {
  const base = { ...row, tags: JSON.parse(row.tags || '[]') };
  delete base.password_encrypted;
  if (reveal) {
    try {
      base.password = decrypt(row.password_encrypted);
    } catch (e) {
      base.password = null;
    }
  }
  return base;
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM vault_entries WHERE deleted_at IS NULL ORDER BY updated_at DESC').all();
  res.json(rows.map((r) => serialize(r)));
});

router.get('/:id/reveal', (req, res) => {
  const row = db.prepare('SELECT * FROM vault_entries WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Voce non trovata' });
  res.json(serialize(row, { reveal: true }));
});

router.post('/', (req, res) => {
  const { site, username = '', password, url = '', notes = '', tags = [] } = req.body;
  if (!site || !password) return res.status(400).json({ error: 'Sito e password sono obbligatori' });
  const info = db
    .prepare('INSERT INTO vault_entries (site, username, password_encrypted, url, notes, tags) VALUES (?, ?, ?, ?, ?, ?)')
    .run(site, username, encrypt(password), url, notes, JSON.stringify(tags));
  res.status(201).json(serialize(db.prepare('SELECT * FROM vault_entries WHERE id = ?').get(info.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM vault_entries WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Voce non trovata' });
  const { site, username, password, url, notes, tags } = req.body;
  db.prepare(
    "UPDATE vault_entries SET site = ?, username = ?, password_encrypted = ?, url = ?, notes = ?, tags = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    site ?? existing.site,
    username ?? existing.username,
    password ? encrypt(password) : existing.password_encrypted,
    url ?? existing.url,
    notes ?? existing.notes,
    JSON.stringify(tags ?? JSON.parse(existing.tags || '[]')),
    req.params.id
  );
  res.json(serialize(db.prepare('SELECT * FROM vault_entries WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare("UPDATE vault_entries SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.post('/:id/restore', (req, res) => {
  db.prepare('UPDATE vault_entries SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// Import da CSV. Riconosce automaticamente le intestazioni piu' comuni
// (esportazioni da browser o altri password manager): site/name/title,
// username/login/email, password, url/link, notes/note.
const HEADER_MAP = {
  site: ['site', 'name', 'title'],
  username: ['username', 'login', 'email', 'user'],
  password: ['password', 'pass'],
  url: ['url', 'link', 'website'],
  notes: ['notes', 'note', 'comment'],
};

function mapHeaders(headers) {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const mapping = {};
  for (const [field, aliases] of Object.entries(HEADER_MAP)) {
    const idx = lower.findIndex((h) => aliases.includes(h));
    if (idx !== -1) mapping[field] = headers[idx];
  }
  return mapping;
}

router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });

  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return res.status(400).json({ error: 'CSV non valido: ' + e.message });
  }
  if (!records.length) return res.status(400).json({ error: 'Il file CSV e\' vuoto' });

  const mapping = mapHeaders(Object.keys(records[0]));
  if (!mapping.site || !mapping.password) {
    return res.status(400).json({
      error:
        'Non trovo colonne riconoscibili per sito e password. Intestazioni attese: site/name/title, password.',
    });
  }

  const insert = db.prepare(
    'INSERT INTO vault_entries (site, username, password_encrypted, url, notes, tags) VALUES (?, ?, ?, ?, ?, ?)'
  );
  let imported = 0;
  let skipped = 0;

  const runImport = db.transaction((rows) => {
    for (const row of rows) {
      const site = mapping.site ? row[mapping.site] : '';
      const password = mapping.password ? row[mapping.password] : '';
      if (!site || !password) {
        skipped += 1;
        continue;
      }
      insert.run(
        site,
        mapping.username ? row[mapping.username] || '' : '',
        encrypt(password),
        mapping.url ? row[mapping.url] || '' : '',
        mapping.notes ? row[mapping.notes] || '' : '',
        JSON.stringify(['importato-csv'])
      );
      imported += 1;
    }
  });
  runImport(records);

  res.json({ imported, skipped, total: records.length });
});

module.exports = router;
