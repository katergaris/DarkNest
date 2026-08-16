const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

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

  // Un database creato prima che esistesse questo sistema ha gia' tutto lo
  // schema (le tabelle/colonne venivano gestite a mano in db.js): le
  // migrazioni corrispondenti vanno segnate come applicate senza rieseguirle,
  // altrimenti un "ALTER TABLE ADD COLUMN" su una colonna gia' esistente
  // farebbe fallire l'avvio.
  const isPreExistingDb = applied.size === 0 && tableExists(db, 'users');

  const markApplied = db.prepare('INSERT INTO schema_migrations (id) VALUES (?)');
  for (const file of files) {
    const id = file.replace(/\.js$/, '');
    if (applied.has(id)) continue;
    if (!isPreExistingDb) {
      require(path.join(MIGRATIONS_DIR, file))(db);
    }
    markApplied.run(id);
  }
}

module.exports = { runMigrations };
