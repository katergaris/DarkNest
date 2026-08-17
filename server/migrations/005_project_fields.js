module.exports = function up(db) {
  db.exec(`
    ALTER TABLE projects ADD COLUMN deadline TEXT;
    ALTER TABLE projects ADD COLUMN contacts TEXT DEFAULT '[]';
    ALTER TABLE projects ADD COLUMN budget TEXT DEFAULT '[]';
  `);
};
