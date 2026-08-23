const { EventEmitter } = require('events');

const TICK_MS = 60000;
const MIN_SYNC_DELAY_SECONDS = 60;

function randomOf(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

class LibrarySync extends EventEmitter {
  constructor({ store, db, isStorageBot, isPublicBot, notifier, log }) {
    super();
    this.store = store;
    this.db = db;
    this.isStorageBot = isStorageBot || (() => false);
    this.isPublicBot = isPublicBot || (() => false);
    this.notifier = notifier;
    this.log = log || (() => {});
    const saved = store.get('library-sync', {}) || {};
    this.cfg = {
      syncDelaySeconds: Math.min(Math.max(parseInt(saved.syncDelaySeconds, 10) || 300, MIN_SYNC_DELAY_SECONDS), 86400)
    };
    this.lastSync = saved.lastSync || {};
    this.lastProcessedAt = Number(saved.lastProcessedAt) || 0;
    this.timer = null;
    this.running = false;
    this.baselined = new Set();
  }

  getSyncDelay() {
    return this.cfg.syncDelaySeconds;
  }

  setSyncDelay(seconds) {
    const s = Math.min(Math.max(parseInt(seconds, 10) || 300, MIN_SYNC_DELAY_SECONDS), 86400);
    this.cfg.syncDelaySeconds = s;
    this._persist();
    this._note(`Library sync delay set to ${s}s`);
    return s;
  }

  setApiKeys(keys) {
    const arr = Array.isArray(keys) ? keys.map((k) => String(k).trim()).filter(Boolean) : [];
    this.store.set('steam-api-keys', arr);
    this._note(`Steam API keys saved (${arr.length} key(s))`);
    return arr;
  }

  getApiKeys() {
    return this.store.get('steam-api-keys', []) || [];
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running) return;
    const keys = this.getApiKeys();
    if (keys.length === 0) return;
    const now = Date.now();
    // Enforce the configured delay between two consecutive account checks (not per-account staleness),
    // so accounts are checked one at a time, spaced by syncDelaySeconds.
    if (now - this.lastProcessedAt < this.cfg.syncDelaySeconds * 1000) return;

    const rows = this.db.query('SELECT name, steam_id FROM bots');
    let candidate = null;
    let oldest = Infinity;
    for (const row of rows) {
      if (!row.steam_id) continue;
      if (this.isStorageBot(row.name)) continue;
      if (!this.isPublicBot(row.name)) continue;
      const last = this.lastSync[row.name] || 0;
      if (last < oldest) {
        oldest = last;
        candidate = row;
      }
    }
    if (!candidate) return;

    this.running = true;
    this.lastProcessedAt = now;
    const name = candidate.name;
    try {
      const key = randomOf(keys);
      const games = await this._fetchOwnedGames(key, candidate.steam_id);
      if (Array.isArray(games)) {
        const hadRows = this.db.one('SELECT 1 AS x FROM games WHERE bot = ?', [name]);
        const isBaseline = !hadRows && !this.baselined.has(name);
        const fresh = [];
        for (const g of games) {
          const appId = Number(g.appid);
          if (!Number.isFinite(appId) || appId <= 0) continue;
          const exists = this.db.one('SELECT 1 AS x FROM games WHERE bot = ? AND app_id = ?', [name, appId]);
          if (!exists && !isBaseline) fresh.push({ appId, gameName: String(g.name || '') });
          this.db.run(
            `INSERT INTO games (bot, app_id, name, cards_remaining, hours_played, updated_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(bot, app_id) DO UPDATE SET name = excluded.name, hours_played = excluded.hours_played, updated_at = excluded.updated_at`,
            [name, appId, String(g.name || ''), 0, Number(g.playtime_forever) ? Math.round(g.playtime_forever / 60) : 0, now]
          );
        }
        this.baselined.add(name);
        if (fresh.length > 0) {
          this.db.incrementKV('redeemed', fresh.length);
          for (const f of fresh) {
            this.db.run('INSERT INTO redeem_log (bot, app_id, game_name, ts) VALUES (?, ?, ?, ?)', [name, f.appId, f.gameName, now]);
          }
          this._note(`${name}: ${fresh.length} new game(s) detected (redeemed)`);
          if (this.notifier) this.notifier.notify('redemption', `${name} redeemed ${fresh.length} new game(s)`);
        }
        this.db.scheduleSave();
        this._note(`${name}: library updated with ${games.length} game(s)`);
      }
    } catch (e) {
      this._note(`${name}: library sync failed (${e.message})`);
    } finally {
      this.lastSync[name] = Date.now();
      this._persist();
      this.running = false;
    }
  }

  async _fetchOwnedGames(key, steamId) {
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(steamId)}&include_appinfo=1&include_played_free_games=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.status === 429) throw new Error('Rate limited (429)');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const games = json && json.response && json.response.games;
    return Array.isArray(games) ? games : [];
  }

  _persist() {
    this.store.set('library-sync', { lastSync: this.lastSync, syncDelaySeconds: this.cfg.syncDelaySeconds, lastProcessedAt: this.lastProcessedAt });
  }

  _note(msg) {
    const line = `[LibrarySync] ${msg}`;
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { LibrarySync };
