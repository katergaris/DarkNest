module.exports = function up(db) {
  db.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT`);
  db.exec(`ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0`);
  db.exec(`ALTER TABLE users ADD COLUMN totp_last_step INTEGER`);
};
