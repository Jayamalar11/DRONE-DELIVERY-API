const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "../../data/drone_delivery.db");

let _db = null;

function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
  }
  return _db;
}

module.exports = { getDb };
