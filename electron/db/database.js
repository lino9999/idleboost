const fs = require('fs');
const path = require('path');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bots (
    name TEXT PRIMARY KEY,
    steam_login TEXT,
    steam_id TEXT,
    nickname TEXT,
    wallet_balance INTEGER DEFAULT 0,
    wallet_currency INTEGER DEFAULT 0,
    cards_left INTEGER DEFAULT 0,
    is_storage INTEGER DEFAULT 0,
    first_seen INTEGER,
    last_seen INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot TEXT,
    balance INTEGER,
    currency INTEGER,
    ts INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_wallet_snapshots_bot_ts ON wallet_snapshots(bot, ts)`,
  `CREATE TABLE IF NOT EXISTS games (
    bot TEXT,
    app_id INTEGER,
    name TEXT,
    cards_remaining INTEGER DEFAULT 0,
    hours_played REAL DEFAULT 0,
    updated_at INTEGER,
    PRIMARY KEY(bot, app_id)
  )`,
  `CREATE TABLE IF NOT EXISTS transfer_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot TEXT,
    storage TEXT,
    status TEXT,
    detail TEXT,
    ts INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS update_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT,
    from_version TEXT,
    to_version TEXT,
    status TEXT,
    detail TEXT,
    ts INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS redeem_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot TEXT,
    app_id INTEGER,
    game_name TEXT,
    ts INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_redeem_log_ts ON redeem_log(ts)`,
  `CREATE TABLE IF NOT EXISTS profile_state (
    bot TEXT,
    action TEXT,
    done_at INTEGER,
    PRIMARY KEY(bot, action)
  )`,
  `CREATE TABLE IF NOT EXISTS bot_stats (
    bot TEXT PRIMARY KEY,
    account_created INTEGER,
    fetched_at INTEGER
  )`
];

class LocalDatabase {
  constructor(file) {
    this.file = file;
    this.db = null;
    this.saveTimer = null;
    this.dirty = false;
  }

  async init() {
    const initSqlJs = require('sql.js');
    let options;
    try {
      const wasmBinary = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
      options = { wasmBinary };
    } catch {
      options = undefined;
    }
    const SQL = await initSqlJs(options);
    let buffer = null;
    try {
      if (fs.existsSync(this.file)) buffer = fs.readFileSync(this.file);
    } catch {
      buffer = null;
    }
    try {
      this.db = buffer ? new SQL.Database(buffer) : new SQL.Database();
    } catch {
      this.db = new SQL.Database();
    }
    for (const stmt of SCHEMA) this.db.run(stmt);
    this._ensureColumn('bots', 'avatar_url', 'TEXT');
    this._ensureColumn('bots', 'trade_link', 'TEXT');
    this._ensureColumn('bots', 'cards_left', 'INTEGER DEFAULT 0');
    // Legacy tables from the removed inventory / Steam Market features.
    for (const legacy of ['inventory_apps', 'inventory_items', 'market_log']) {
      try {
        this.db.run(`DROP TABLE IF EXISTS ${legacy}`);
      } catch {
        /* ignore */
      }
    }
    this.flush();
  }

  _ensureColumn(table, column, definition) {
    try {
      const cols = this.query(`PRAGMA table_info(${table})`).map((r) => r.name);
      if (!cols.includes(column)) this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      /* best effort */
    }
  }

  run(sql, params) {
    if (!this.db) return;
    if (params === undefined) {
      this.db.run(sql);
    } else {
      this.db.run(sql, params);
    }
    this.dirty = true;
  }

  query(sql, params) {
    if (!this.db) return [];
    const stmt = this.db.prepare(sql);
    try {
      if (params !== undefined) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  one(sql, params) {
    const rows = this.query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  getKV(key, fallback = null) {
    const row = this.one('SELECT value FROM kv WHERE key = ?', [key]);
    return row && row.value !== undefined && row.value !== null ? row.value : fallback;
  }

  setKV(key, value) {
    this.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(value)]);
  }

  incrementKV(key, by = 1) {
    const current = parseInt(this.getKV(key, '0'), 10) || 0;
    this.setKV(key, current + by);
    return current + by;
  }

  scheduleSave(delayMs = 2000) {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, delayMs);
  }

  flush() {
    if (!this.db || !this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const data = Buffer.from(this.db.export());
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch {
      /* best effort */
    }
  }

  close() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.flush();
    if (this.db) {
      try {
        this.db.close();
      } catch {
        /* already closed */
      }
      this.db = null;
    }
  }
}

module.exports = { LocalDatabase };
