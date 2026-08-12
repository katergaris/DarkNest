const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');
const totp = require('./totp');

const RECOVERY_CODE_COUNT = 8;

function hasUser() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
}

function createUser(username, password) {
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
}

function getUser(username) {
  if (typeof username !== 'string') return null;
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
}

function verifyUser(username, password) {
  // bcrypt.compareSync solleva un'eccezione se gli argomenti non sono stringhe:
  // con un corpo della richiesta incompleto il login deve solo fallire.
  if (typeof username !== 'string' || typeof password !== 'string' || !password) return false;
  const user = getUser(username);
  if (!user) return false;
  return bcrypt.compareSync(password, user.password_hash);
}

function twoFactorEnabled(username) {
  const user = getUser(username);
  return !!(user && user.totp_enabled && user.totp_secret);
}

/**
 * Verifica il codice a 6 cifre dell'app di autenticazione.
 * Lo "step" appena usato viene memorizzato: lo stesso codice non puo' essere
 * riproposto finche' resta valido (protezione dal riutilizzo).
 */
function verifyTotp(username, token) {
  const user = getUser(username);
  if (!user || !user.totp_secret) return false;
  const step = totp.verify(user.totp_secret, token);
  if (step === null) return false;
  if (user.totp_last_step !== null && step <= user.totp_last_step) return false;
  db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
  return true;
}

// --- Codici di recupero ---
// Servono per rientrare se il telefono si perde o si rompe. Sono monouso e
// salvati solo come hash: se li perdi non c'e' modo di rileggerli dal database.
function formatRecoveryCode(raw) {
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function generateRecoveryCodes(userId) {
  const codes = [];
  const insert = db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)');
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
    for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
      // 10 caratteri da un alfabeto senza lettere ambigue (niente 0/O, 1/I/L).
      const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
      let raw = '';
      for (let c = 0; c < 10; c += 1) raw += alphabet[crypto.randomInt(alphabet.length)];
      codes.push(formatRecoveryCode(raw));
      insert.run(userId, bcrypt.hashSync(raw, 10));
    }
  });
  replace();
  return codes;
}

function verifyRecoveryCode(username, code) {
  const user = getUser(username);
  if (!user || typeof code !== 'string') return false;
  const clean = code.toUpperCase().replace(/[\s-]/g, '');
  if (!clean) return false;
  const rows = db.prepare('SELECT * FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').all(user.id);
  for (const row of rows) {
    if (bcrypt.compareSync(clean, row.code_hash)) {
      db.prepare("UPDATE recovery_codes SET used_at = datetime('now') WHERE id = ?").run(row.id);
      return true;
    }
  }
  return false;
}

function countUnusedRecoveryCodes(userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId).c;
}

function setTotpSecret(userId, secret) {
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_last_step = NULL WHERE id = ?').run(secret, userId);
}

function enableTotp(userId) {
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId);
}

function disableTotp(userId) {
  const clear = db.transaction(() => {
    db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE id = ?').run(userId);
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
  });
  clear();
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Non autenticato' });
}

module.exports = {
  hasUser,
  createUser,
  getUser,
  verifyUser,
  requireAuth,
  twoFactorEnabled,
  verifyTotp,
  generateRecoveryCodes,
  verifyRecoveryCode,
  countUnusedRecoveryCodes,
  setTotpSecret,
  enableTotp,
  disableTotp,
};
