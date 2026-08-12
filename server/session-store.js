const session = require('express-session');
const db = require('./db');

// Store di sessione su SQLite: senza questo express-session userebbe il
// MemoryStore di default, che perde tutte le sessioni a ogni riavvio del
// container (logout a sorpresa) e accumula memoria senza mai liberarla.
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const selectStmt = db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires_at > ?');
const upsertStmt = db.prepare(
  'INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at'
);
const deleteStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
const pruneStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

function expiryOf(sess) {
  if (sess && sess.cookie && sess.cookie.expires) {
    const ts = new Date(sess.cookie.expires).getTime();
    if (!Number.isNaN(ts)) return ts;
  }
  return Date.now() + DEFAULT_TTL_MS;
}

class SqliteStore extends session.Store {
  constructor() {
    super();
    this.prune();
    // Pulizia periodica delle sessioni scadute; unref() per non tenere vivo il processo.
    this.timer = setInterval(() => this.prune(), 1000 * 60 * 60);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  prune() {
    try {
      pruneStmt.run(Date.now());
    } catch (e) {
      console.error('Pulizia sessioni fallita:', e.message);
    }
  }

  get(sid, cb) {
    try {
      const row = selectStmt.get(sid, Date.now());
      if (!row) return cb(null, null);
      return cb(null, JSON.parse(row.data));
    } catch (e) {
      return cb(e);
    }
  }

  set(sid, sess, cb) {
    try {
      upsertStmt.run(sid, JSON.stringify(sess), expiryOf(sess));
      return cb(null);
    } catch (e) {
      return cb(e);
    }
  }

  touch(sid, sess, cb) {
    return this.set(sid, sess, cb);
  }

  destroy(sid, cb) {
    try {
      deleteStmt.run(sid);
      return cb(null);
    } catch (e) {
      return cb(e);
    }
  }
}

module.exports = SqliteStore;
