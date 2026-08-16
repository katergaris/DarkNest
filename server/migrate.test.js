const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrate');

test('su un database vuoto crea tutte le tabelle ed esegue le migrazioni in ordine', () => {
  const db = new Database(':memory:');
  runMigrations(db);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['users', 'ideas', 'projects', 'vault_entries', 'accounts', 'documents', 'dossiers', 'dossier_links', 'recovery_codes']) {
    assert.ok(tables.includes(t), `manca la tabella ${t}`);
  }

  const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all().map((r) => r.id);
  assert.deepEqual(applied, ['001_initial_schema', '002_totp_columns']);

  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  assert.ok(userColumns.includes('totp_secret'));
  assert.ok(userColumns.includes('totp_enabled'));
});

test('e\' idempotente: eseguirla piu\' volte non fallisce e non riapplica nulla', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  assert.doesNotThrow(() => runMigrations(db));
  const applied = db.prepare('SELECT id FROM schema_migrations').all();
  assert.equal(applied.length, 2);
});

test('un database pre-esistente (schema gia\' presente, creato prima di questo sistema) viene adottato senza rieseguire le migrazioni', () => {
  const db = new Database(':memory:');
  // Simula lo schema creato dal vecchio meccanismo ad-hoc: tabella "users" gia'
  // presente, colonne TOTP gia' aggiunte, ma senza schema_migrations.
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      totp_last_step INTEGER
    );
  `);

  // Se rieseguisse le migrazioni invece di adottarle, "ALTER TABLE ADD COLUMN
  // totp_secret" fallirebbe qui perche' la colonna esiste gia'.
  assert.doesNotThrow(() => runMigrations(db));

  const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all().map((r) => r.id);
  assert.deepEqual(applied, ['001_initial_schema', '002_totp_columns']);
});
