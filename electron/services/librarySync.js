const { EventEmitter } = require('events');

const TICK_MS = 60000;
const DEFAULTS = { useProxy: true, maxParallel: 15, delaySeconds: 300 };

function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

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
      useProxy: saved.useProxy !== false,
      maxParallel: clampInt(saved.maxParallel, 1, 50, DEFAULTS.maxParallel),
      // Legacy key (syncDelaySeconds) is migrated transparently.
      delaySeconds: clampInt(saved.delaySeconds ?? saved.syncDelaySeconds, 1, 86400, DEFAULTS.delaySeconds)
    };
    this.lastSync = saved.lastSync || {};
    this.lastProcessedAt = Number(saved.lastProcessedAt) || 0;
    this.timer = null;
    this.running = false;
    this.baselined = new Set();
  }

  getConfig() {
    return { ...this.cfg };
  }

  setConfig(patch = {}) {
    const cfg = { ...this.cfg, ...patch };
    cfg.useProxy = !!cfg.useProxy;
    cfg.maxParallel = clampInt(cfg.maxParallel, 1, 50, DEFAULTS.maxParallel);
    cfg.delaySeconds = clampInt(cfg.delaySeconds, 1, 86400, DEFAULTS.delaySeconds);
    this.cfg = cfg;
    this._persist();
    this._note(
      `Library sync settings saved - ${cfg.maxParallel} account(s) at a time, ${cfg.delaySeconds}s between batches, proxy ${cfg.useProxy ? 'on' : 'off'}`
    );
    return this.getConfig();
  }

  getSyncDelay() {
    return this.cfg.delaySeconds;
  }

  setSyncDelay(seconds) {
    return this.setConfig({ delaySeconds: seconds }).delaySeconds;
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
    // GetOwnedGames accepts a single SteamID per call: each run fetches up to
    // cfg.maxParallel accounts in parallel (random API key + random proxy per
    // request when the proxy is enabled), then waits cfg.delaySeconds before the
    // next run.
    if (now - this.lastProcessedAt < this.cfg.delaySeconds * 1000) return;

    const rows = this.db.query('SELECT name, steam_id FROM bots');
    // Oldest-synced accounts first, capped at maxParallel per run.
    const candidates = rows
      .filter((row) => row.steam_id && !this.isStorageBot(row.name) && this.isPublicBot(row.name))
      .sort((a, b) => (this.lastSync[a.name] || 0) - (this.lastSync[b.name] || 0))
      .slice(0, this.cfg.maxParallel);
    if (candidates.length === 0) return;

    this.running = true;
    this.lastProcessedAt = now;
    this._note(`Library sync started - ${candidates.length} account(s) in parallel (proxy ${this.cfg.useProxy ? 'on' : 'off'})`);
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
    if (!this.cfg.useProxy) return null;
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
    this.store.set('library-sync', {
      lastSync: this.lastSync,
      useProxy: this.cfg.useProxy,
      maxParallel: this.cfg.maxParallel,
      delaySeconds: this.cfg.delaySeconds,
      lastProcessedAt: this.lastProcessedAt
    });
  }

  _note(msg) {
    const line = `[LibrarySync] ${msg}`;
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { LibrarySync };
