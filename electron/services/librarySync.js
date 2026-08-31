const { EventEmitter } = require('events');

const TICK_MS = 60000;
const MIN_SYNC_DELAY_SECONDS = 60;
// GetOwnedGames accepts a single SteamID per call, so "batching" here means
// fetching up to this many accounts IN PARALLEL (random API key + random proxy
// per request) instead of one account at a time.
const MAX_PARALLEL = 15;

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
    // Enforce the configured delay between two consecutive sync runs. Within a
    // run, up to MAX_PARALLEL accounts are fetched in parallel.
    if (now - this.lastProcessedAt < this.cfg.syncDelaySeconds * 1000) return;

    const rows = this.db.query('SELECT name, steam_id FROM bots');
    // Oldest-synced accounts first, capped at MAX_PARALLEL per run.
    const candidates = rows
      .filter((row) => row.steam_id && !this.isStorageBot(row.name) && this.isPublicBot(row.name))
      .sort((a, b) => (this.lastSync[a.name] || 0) - (this.lastSync[b.name] || 0))
      .slice(0, MAX_PARALLEL);
    if (candidates.length === 0) return;

    this.running = true;
    this.lastProcessedAt = now;
    this._note(`Library sync started - ${candidates.length} account(s) in parallel`);
    try {
      await Promise.all(candidates.map((candidate) => this._syncOne(candidate, keys, now)));
    } finally {
      this._persist();
      this.running = false;
    }
  }

  async _syncOne(candidate, keys, now) {
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
    }
  }

  _pickProxy() {
    const proxies = this.store.get('proxies', {}) || {};
    const list = Object.values(proxies);
    if (list.length === 0) return null;
    const p = randomOf(list);
    if (!p || !p.host) return null;
    return `${p.scheme || 'http'}://${p.username ? `${p.username}:${p.password || ''}@` : ''}${p.host}:${p.port}`;
  }

  async _fetchOwnedGames(key, steamId) {
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(steamId)}&include_appinfo=1&include_played_free_games=1`;
    const fetchOpts = { signal: AbortSignal.timeout(15000) };
    const proxyUrl = this._pickProxy();
    if (proxyUrl) {
      try {
        const isSocks = /^socks/i.test(proxyUrl);
        const Agent = isSocks ? require('socks-proxy-agent').SocksProxyAgent : require('https-proxy-agent').HttpProxyAgent;
        fetchOpts.agent = new Agent(proxyUrl);
      } catch {
        /* fall back to a direct request */
      }
    }
    const res = await fetch(url, fetchOpts);
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
