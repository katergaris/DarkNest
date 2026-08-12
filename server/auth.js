const bcrypt = require('bcryptjs');
const db = require('./db');

function hasUser() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
}

function createUser(username, password) {
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
}

function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return false;
  return bcrypt.compareSync(password, user.password_hash);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Non autenticato' });
}

module.exports = { hasUser, createUser, verifyUser, requireAuth };
