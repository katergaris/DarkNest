const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(16).toString('hex');
    // L'estensione arriva dal client: la accettiamo solo se e' davvero
    // un'estensione semplice, per non costruire nomi di file inattesi.
    const ext = path.extname(path.basename(file.originalname || ''));
    cb(null, unique + (/^\.[A-Za-z0-9]{1,12}$/.test(ext) ? ext.toLowerCase() : ''));
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function serialize(row) {
  return { ...row, tags: JSON.parse(row.tags || '[]') };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
  res.json(rows.map(serialize));
});

router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
  const { folder = '', tags = '[]', expiry_date = null } = req.body;
  let parsedTags = [];
  try {
    parsedTags = JSON.parse(tags);
  } catch (e) {
    parsedTags = [];
  }
  const info = db
    .prepare(
      'INSERT INTO documents (original_name, stored_name, folder, mime, size, expiry_date, tags) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(req.file.originalname, req.file.filename, folder, req.file.mimetype, req.file.size, expiry_date || null, JSON.stringify(parsedTags));
  res.status(201).json(serialize(db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid)));
});

router.get('/:id/download', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Documento non trovato' });
  const filePath = path.join(UPLOAD_DIR, path.basename(doc.stored_name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File mancante su disco' });
  res.download(filePath, doc.original_name);
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Documento non trovato' });
  const { folder, tags, expiry_date } = req.body;
  db.prepare('UPDATE documents SET folder = ?, tags = ?, expiry_date = ? WHERE id = ?').run(
    folder ?? existing.folder,
    JSON.stringify(tags ?? JSON.parse(existing.tags || '[]')),
    expiry_date !== undefined ? expiry_date : existing.expiry_date,
    req.params.id
  );
  res.json(serialize(db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare("UPDATE documents SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

router.post('/:id/restore', (req, res) => {
  db.prepare('UPDATE documents SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
