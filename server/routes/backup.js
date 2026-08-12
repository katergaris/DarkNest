const express = require('express');
const path = require('path');
const archiver = require('archiver');
const router = express.Router();

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

router.get('/', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.attachment(`darknest-backup-${stamp}.zip`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    res.status(500).end();
    console.error('Errore backup:', err);
  });
  archive.pipe(res);
  archive.file(path.join(DATA_DIR, 'darknest.db'), { name: 'darknest.db' });
  archive.directory(UPLOAD_DIR, 'uploads');
  archive.finalize();
});

module.exports = router;
