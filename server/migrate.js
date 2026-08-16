const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Le uniche migrazioni che corrispondono esattamente a cio' che il vecchio
// sistema ad-hoc (CREATE TABLE IF NOT EXISTS + addColumn dentro db.js) gia'
// creava prima che esistesse questo file. Qualsiasi migrazione aggiunta dopo
// non e' mai stata creata ad-hoc: deve sempre girare per davvero, anche su
// un database "legacy" adottato ora — altrimenti una tabella nuova (es.
// "reminders") non verrebbe mai creata su chi aggiorna da prima di questo sistema.
const LEGACY_MIGRATIONS = new Set(['001_initial_schema', '002_totp_columns']);

function ensureMigrationsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function runMigrations(db) {
  ensureMigrationsTable(db);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.js')).sort();
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));

  // Un database creato prima che esistesse questo sistema ha gia' lo schema
  // "legacy" (tabelle/colonne che venivano gestite a mano): quelle migrazioni
  // vanno segnate come applicate senza rieseguirle, altrimenti un "ALTER
  // TABLE ADD COLUMN" su una colonna gia' esistente farebbe fallire l'avvio.
  const isLegacyDb = applied.size === 0 && tableExists(db, 'users');

  const markApplied = db.prepare('INSERT INTO schema_migrations (id) VALUES (?)');
  for (const file of files) {
    const id = file.replace(/\.js$/, '');
    if (applied.has(id)) continue;
    if (!(isLegacyDb && LEGACY_MIGRATIONS.has(id))) {
      require(path.join(MIGRATIONS_DIR, file))(db);
    }
    markApplied.run(id);
  }
}

module.exports = { runMigrations };
