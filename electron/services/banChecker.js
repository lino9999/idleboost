const { EventEmitter } = require('events');

const TICK_MS = 30000;
const DEFAULTS = { autoCheck: false, useProxy: false, delayMinutes: 5, minDelayMinutes: 5 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNum(value, lo, hi, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function randomOf(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

class BanChecker extends EventEmitter {
  constructor({ api, store, notifier, log }) {
    super();
    this.api = api;
    this.store = store;
    this.notifier = notifier;
    this.log = log || (() => {});
    const saved = store.get('ban-checker', {}) || {};
    this.cfg = {
      autoCheck: !!saved.autoCheck,
      useProxy: !!saved.useProxy,
      delayMinutes: clampNum(saved.delayMinutes, DEFAULTS.minDelayMinutes, 10080, DEFAULTS.delayMinutes)
    };
    this.status = saved.status || {};
    this.running = false;
    this.rotor = 0;
    this.timer = null;
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
    cfg.delayMinutes = clampNum(cfg.delayMinutes, DEFAULTS.minDelayMinutes, 10080, DEFAULTS.delayMinutes);
    this.cfg = cfg;
    this._persist();
    this._note(`Ban checker ${cfg.autoCheck ? 'ENABLED' : 'DISABLED'} - delay ${cfg.delayMinutes}min, proxy ${cfg.useProxy ? 'on' : 'off'}`);
    this.publish();
    return this.getConfig();
  }

  async checkAllNow() {
    if (this.running) return { skipped: true };
    this.running = true;
    this.publish();
    try {
      const bots = await this._getBotList();
      for (let i = 0; i < bots.length; i++) {
        await this._checkBot(bots[i]);
        await sleep(1500);
      }
    } finally {
      this.running = false;
      this.publish();
    }
    return { done: true };
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
    if (Date.now() - this.lastCheckAt < this.cfg.delayMinutes * 60000) {
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

  async _getBotList() {
    try {
      const bots = (await this.api.getBots()) || {};
      return Object.entries(bots)
        .filter(([, bot]) => bot.SteamID && String(bot.SteamID) !== '0')
        .map(([name, bot]) => ({ name, steamId: String(bot.SteamID) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
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

  async _checkBot(bot) {
    const keys = this.store.get('steam-api-keys', []) || [];
    if (keys.length === 0) return;
    const key = randomOf(keys);
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${encodeURIComponent(key)}&steamids=${encodeURIComponent(bot.steamId)}`;
    try {
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
      const res = await fetch(url, fetchOpts);
      clearTimeout(timeout);
      if (!res.ok) {
        this.status[bot.name] = { state: 'error', detail: `HTTP ${res.status}`, at: Date.now() };
        this._note(`${bot.name}: ban check failed (HTTP ${res.status})`);
        return;
      }
      const json = await res.json();
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
    } catch (e) {
      this.status[bot.name] = { state: 'error', detail: e.message, at: Date.now() };
      this._note(`${bot.name}: ban check failed (${e.message})`);
    }
    this._persist();
    this.publish();
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
