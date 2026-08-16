module.exports = function up(db) {
  db.exec(`ALTER TABLE documents ADD COLUMN display_name TEXT`);
};
