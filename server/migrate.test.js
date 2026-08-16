const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrate');

// Elenco atteso derivato dai file reali, non scritto a mano: cosi' il test
// non va aggiornato ad ogni nuova migrazione aggiunta al progetto.
const EXPECTED_IDS = fs
  .readdirSync(path.join(__dirname, 'migrations'))
  .filter((f) => f.endsWith('.js'))
  .sort()
  .map((f) => f.replace(/\.js$/, ''));

test('su un database vuoto crea tutte le tabelle ed esegue le migrazioni in ordine', () => {
  const db = new Database(':memory:');
  runMigrations(db);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['users', 'ideas', 'projects', 'vault_entries', 'accounts', 'documents', 'dossiers', 'dossier_links', 'recovery_codes', 'reminders']) {
    assert.ok(tables.includes(t), `manca la tabella ${t}`);
  }

  const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all().map((r) => r.id);
  assert.deepEqual(applied, EXPECTED_IDS);

  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  assert.ok(userColumns.includes('totp_secret'));
  assert.ok(userColumns.includes('totp_enabled'));

  const docColumns = db.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
  assert.ok(docColumns.includes('display_name'));
});

test('e\' idempotente: eseguirla piu\' volte non fallisce e non riapplica nulla', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  assert.doesNotThrow(() => runMigrations(db));
  const applied = db.prepare('SELECT id FROM schema_migrations').all();
  assert.equal(applied.length, EXPECTED_IDS.length);
});

test('un database pre-esistente (schema gia\' presente, creato prima di questo sistema) viene adottato senza rieseguire le migrazioni', () => {
  const db = new Database(':memory:');
  // Simula lo schema creato dal vecchio meccanismo ad-hoc: tabelle gia'
  // presenti (incluse quelle su cui le migrazioni successive faranno ALTER
  // TABLE), colonne TOTP gia' aggiunte, ma senza schema_migrations.
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
    CREATE TABLE documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      folder TEXT DEFAULT '',
      mime TEXT DEFAULT '',
      size INTEGER DEFAULT 0,
      expiry_date TEXT,
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
  `);

  // Se rieseguisse le migrazioni invece di adottarle, "ALTER TABLE ADD COLUMN
  // totp_secret" fallirebbe qui perche' la colonna esiste gia'.
  assert.doesNotThrow(() => runMigrations(db));

  const applied = db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all().map((r) => r.id);
  assert.deepEqual(applied, EXPECTED_IDS);

  // Le migrazioni successive a quelle "legacy" (qui: le scadenze) devono
  // pero' girare per davvero, anche su un database adottato ora: altrimenti
  // chi aggiorna da prima di questo sistema non si ritroverebbe mai la
  // tabella nuova.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  assert.ok(tables.includes('reminders'), 'la migrazione delle scadenze non e\' stata eseguita sul database legacy');

  const docColumns = db.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
  assert.ok(docColumns.includes('display_name'), 'la migrazione del nome personalizzato non e\' stata eseguita sul database legacy');
});
