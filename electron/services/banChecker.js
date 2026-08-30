const { EventEmitter } = require('events');

const TICK_MS = 5000;
const DEFAULTS = { autoCheck: false, useProxy: false, delaySeconds: 1, minDelaySeconds: 1 };

function clampNum(value, lo, hi, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function randomOf(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

class BanChecker extends EventEmitter {
  constructor({ api, store, notifier, db, log }) {
    super();
    this.api = api;
    this.store = store;
    this.notifier = notifier;
    this.db = db || null;
    this.log = log || (() => {});
    const saved = store.get('ban-checker', {}) || {};
    // Migrate the old minute-based setting to seconds.
    let delaySeconds = Number(saved.delaySeconds);
    if (!Number.isFinite(delaySeconds) && Number.isFinite(Number(saved.delayMinutes))) {
      delaySeconds = Number(saved.delayMinutes) * 60;
    }
    this.cfg = {
      autoCheck: !!saved.autoCheck,
      useProxy: !!saved.useProxy,
      delaySeconds: clampNum(delaySeconds, DEFAULTS.minDelaySeconds, 86400, DEFAULTS.delaySeconds)
    };
    this.status = saved.status || {};
    this.running = false;
    this.rotor = 0;
    this.timer = null;
    this.stopRequested = false;
    this._wake = null;
    this.lastCheckAt = Number(saved.lastCheckAt) || 0;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getConfig() {
    return { ...this.cfg };
  }

  getState() {
    return {
      config: this.getConfig(),
      running: this.running,
      status: { ...this.status },
      lastCheckAt: this.lastCheckAt,
      hasApiKeys: (this.store.get('steam-api-keys', []) || []).length > 0,
      hasProxies: Object.keys(this.store.get('proxies', {}) || {}).length > 0
    };
  }

  setConfig(patch = {}) {
    const cfg = { ...this.cfg, ...patch };
    cfg.autoCheck = !!cfg.autoCheck;
    cfg.useProxy = !!cfg.useProxy;
    cfg.delaySeconds = clampNum(cfg.delaySeconds, DEFAULTS.minDelaySeconds, 86400, DEFAULTS.delaySeconds);
    const wasAuto = this.cfg.autoCheck;
    this.cfg = cfg;
    if (wasAuto && !cfg.autoCheck) {
      this.stopRequested = true;
      if (this._wake) this._wake();
    }
    this._persist();
    this._note(`Ban checker ${cfg.autoCheck ? 'ENABLED' : 'DISABLED'} - delay ${cfg.delaySeconds}s, proxy ${cfg.useProxy ? 'on' : 'off'}`);
    this.publish();
    return this.getConfig();
  }

  async checkAllNow() {
    if (this.running) return { skipped: true };
    const bots = await this._getBotList();
    if (bots.length === 0) return { done: true, total: 0 };

    this.running = true;
    this.stopRequested = false;
    this.publish();
    this._note(`Ban check sweep started: ${bots.length} account(s), one every ${this.cfg.delaySeconds}s`);

    // Fire-and-forget so the UI is not blocked for the whole (long) sweep.
    this._runSweep(bots).finally(() => {
      this.running = false;
      this.stopRequested = false;
      this.lastCheckAt = Date.now();
      this._persist();
      this.publish();
      this._note('Ban check sweep finished');
    });

    return { started: true, total: bots.length };
  }

  async _runSweep(bots) {
    for (let i = 0; i < bots.length; i++) {
      if (this.stopRequested) {
        this._note('Ban check sweep stopped');
        break;
      }
      await this._checkBot(bots[i]);
      const isLast = i === bots.length - 1;
      if (!isLast && !this.stopRequested) {
        await this._sleepInterruptible(this.cfg.delaySeconds * 1000);
      }
    }
  }

  _sleepInterruptible(ms) {
    return new Promise((resolve) => {
      let timer = null;
      this._wake = () => {
        this._wake = null;
        if (timer) clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(() => {
        this._wake = null;
        resolve();
      }, ms);
    });
  }

  stopAll() {
    this.stopRequested = true;
    if (this._wake) this._wake();
    if (this.cfg.autoCheck) {
      this.cfg.autoCheck = false;
      this._persist();
      this._note('Ban checker DISABLED');
    }
    this.publish();
    return { ok: true };
  }

  async tick() {
    if (!this.cfg.autoCheck || this.running) {
      this.publish();
      return;
    }
    const keys = this.store.get('steam-api-keys', []) || [];
    if (keys.length === 0) {
      this.publish();
      return;
    }
    if (Date.now() - this.lastCheckAt < this.cfg.delaySeconds * 1000) {
      this.publish();
      return;
    }
    this.running = true;
    this.publish();
    try {
      const bots = await this._getBotList();
      if (bots.length > 0) {
        this.rotor = this.rotor % bots.length;
        const bot = bots[this.rotor];
        this.rotor = (this.rotor + 1) % bots.length;
        await this._checkBot(bot);
        this.lastCheckAt = Date.now();
      }
    } finally {
      this.running = false;
      this._persist();
      this.publish();
    }
  }

  // Builds the list of accounts to check. Every imported account is included
  // even when it is disabled / not connected to ASF: the SteamID is taken from
  // the running bot when available, otherwise from the local database (stored
  // after the first successful sync), and as a last resort it is resolved from
  // the login name via the Steam Web API.
  async _getBotList() {
    const steamIds = new Map();
    const logins = new Map();

    try {
      const bots = (await this.api.getBots()) || {};
      for (const [name, bot] of Object.entries(bots)) {
        const sid = bot && bot.SteamID ? String(bot.SteamID) : '';
        steamIds.set(name, sid && sid !== '0' ? sid : '');
        const login = bot && bot.BotConfig && bot.BotConfig.SteamLogin ? String(bot.BotConfig.SteamLogin) : '';
        if (login) logins.set(name, login);
      }
    } catch {
      /* ASF not reachable - fall back to the local database below */
    }

    if (this.db) {
      try {
        const rows = this.db.query('SELECT name, steam_login, steam_id FROM bots');
        for (const row of rows || []) {
          if (!row || !row.name) continue;
          if (!steamIds.has(row.name)) steamIds.set(row.name, '');
          const sid = row.steam_id ? String(row.steam_id) : '';
          if (sid && sid !== '0' && !steamIds.get(row.name)) steamIds.set(row.name, sid);
          if (!logins.get(row.name) && row.steam_login) logins.set(row.name, String(row.steam_login));
        }
      } catch {
        /* db optional */
      }
    }

    const keys = this.store.get('steam-api-keys', []) || [];
    const unknown = [...steamIds.entries()].filter(([, sid]) => !sid).map(([name]) => name);
    if (unknown.length > 0 && keys.length > 0) {
      this._note(`Resolving the SteamID of ${unknown.length} account(s) that never connected...`);
      for (const name of unknown) {
        if (this.stopRequested) break;
        const login = logins.get(name);
        if (!login) continue;
        try {
          const key = randomOf(keys);
          const res = await fetch(
            `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(key)}&vanityurl=${encodeURIComponent(login)}`,
            { signal: AbortSignal.timeout(15000) }
          );
          const json = await res.json();
          const sid = json && json.response && json.response.success === 1 ? String(json.response.steamid) : '';
          if (sid) {
            steamIds.set(name, sid);
            this._persistSteamId(name, login, sid);
          } else {
            this._note(`${name}: Steam still does not resolve this login to a SteamID - skipped`);
          }
        } catch (e) {
          this._note(`${name}: SteamID resolution failed (${e.message}) - skipped`);
        }
      }
    }

    return [...steamIds.entries()]
      .filter(([, sid]) => !!sid)
      .map(([name, steamId]) => ({ name, steamId }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  _persistSteamId(name, login, steamId) {
    if (!this.db) return;
    try {
      const existing = this.db.one('SELECT name FROM bots WHERE name = ?', [name]);
      if (existing) {
        this.db.run('UPDATE bots SET steam_id = ? WHERE name = ?', [steamId, name]);
      } else {
        const now = Date.now();
        this.db.run(
          'INSERT INTO bots (name, steam_login, steam_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)',
          [name, login, steamId, now, now]
        );
      }
      this.db.scheduleSave && this.db.scheduleSave();
    } catch {
      /* not critical */
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

  // Shared Steam Web API fetch with the configured proxy + a timeout. Returns parsed JSON.
  async _fetchSteamApi(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const proxyUrl = this._pickProxy();
    let fetchOpts = { signal: controller.signal };
    if (proxyUrl) {
      try {
        const isSocks = /^socks/i.test(proxyUrl);
        const Agent = isSocks ? require('socks-proxy-agent').SocksProxyAgent : require('https-proxy-agent').HttpProxyAgent;
        fetchOpts = { ...fetchOpts, agent: new Agent(proxyUrl) };
      } catch {
        fetchOpts = { signal: controller.signal };
      }
    }
    try {
      const res = await fetch(url, fetchOpts);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async _checkBot(bot) {
    const keys = this.store.get('steam-api-keys', []) || [];
    if (keys.length === 0) return;
    const key = randomOf(keys);
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${encodeURIComponent(key)}&steamids=${encodeURIComponent(bot.steamId)}`;
    try {
      const json = await this._fetchSteamApi(url);
      const player = json && json.players && json.players[0];
      if (!player) {
        this.status[bot.name] = { state: 'error', detail: 'No ban data returned', at: Date.now() };
        return;
      }
      const banned =
        player.CommunityBanned === true ||
        player.VACBanned === true ||
        Number(player.NumberOfVACBans) > 0 ||
        Number(player.NumberOfGameBans) > 0 ||
        (player.EconomyBan && player.EconomyBan !== 'none');
      if (banned) {
        const wasClean = !this.status[bot.name] || this.status[bot.name].state !== 'banned';
        this.status[bot.name] = {
          state: 'banned',
          community: player.CommunityBanned === true,
          vac: player.VACBanned === true,
          vacBans: Number(player.NumberOfVACBans) || 0,
          gameBans: Number(player.NumberOfGameBans) || 0,
          economy: player.EconomyBan || 'none',
          at: Date.now()
        };
        if (wasClean) {
          this._note(`${bot.name}: BAN DETECTED (VAC:${player.VACBanned} Community:${player.CommunityBanned} Economy:${player.EconomyBan})`);
          if (this.notifier) {
            this.notifier.notify('ban', `BAN detected on ${bot.name} (VAC:${player.VACBanned}, Community:${player.CommunityBanned}, Economy:${player.EconomyBan})`);
          }
        }
      } else {
        this.status[bot.name] = {
          state: 'clear',
          vacBans: Number(player.NumberOfVACBans) || 0,
          gameBans: Number(player.NumberOfGameBans) || 0,
          at: Date.now()
        };
        this._note(`${bot.name}: clear`);
      }
      await this._collectAccountAge(bot, key);
    } catch (e) {
      this.status[bot.name] = { state: 'error', detail: e.message, at: Date.now() };
      this._note(`${bot.name}: ban check failed (${e.message})`);
    }
    this._persist();
    this.publish();
  }

  // Fetches just the account creation date (GetPlayerSummaries) so the dashboard
  // can show the account age. Runs through the API key (and the optional proxy).
  async _collectAccountAge(bot, key) {
    if (!this.db) return;
    try {
      const summaryUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(key)}&steamids=${encodeURIComponent(bot.steamId)}`;
      const sj = await this._fetchSteamApi(summaryUrl);
      const p = sj && sj.response && Array.isArray(sj.response.players) ? sj.response.players[0] : null;
      const created = p ? Number(p.timecreated) || null : null;
      if (created) this._saveAccountAge(bot.name, created);
    } catch {
      /* non-critical - the ban result is already recorded */
    }
  }

  _saveAccountAge(name, created) {
    try {
      const existing = this.db.one('SELECT fetched_at FROM bot_stats WHERE bot = ?', [name]);
      if (existing) {
        this.db.run('UPDATE bot_stats SET account_created = ?, fetched_at = ? WHERE bot = ?', [created, Date.now(), name]);
      } else {
        this.db.run('INSERT INTO bot_stats (bot, account_created, fetched_at) VALUES (?, ?, ?)', [name, created, Date.now()]);
      }
      this.db.scheduleSave && this.db.scheduleSave();
    } catch {
      /* non-critical */
    }
  }

  _persist() {
    this.store.set('ban-checker', { ...this.cfg, status: this.status, lastCheckAt: this.lastCheckAt });
  }

  publish() {
    this.emit('state', this.getState());
  }

  _note(msg) {
    const line = `[BanChecker] ${msg}`;
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { BanChecker };

