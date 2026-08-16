const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrate');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// DB_PATH esiste solo per i test (es. ":memory:"), cosi' non toccano mai il
// database reale: in uso normale non va mai impostata.
const db = new Database(process.env.DB_PATH || path.join(DATA_DIR, 'mindkeep.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

runMigrations(db);

module.exports = db;
