module.exports = function up(db) {
  db.exec(`
    ALTER TABLE accounts ADD COLUMN type TEXT NOT NULL DEFAULT 'digitale';
    ALTER TABLE accounts ADD COLUMN location TEXT DEFAULT '';
    ALTER TABLE accounts ADD COLUMN payment_method TEXT DEFAULT '';
  `);
};
