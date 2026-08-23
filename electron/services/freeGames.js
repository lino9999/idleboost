const { EventEmitter } = require('events');

const TICK_MS = 30000;
const FETCH_INTERVAL_MS = 30 * 60000;
const MAX_PER_ACCOUNT_PER_WINDOW = 25;
const MIN_REDEEM_DELAY_SECONDS = 15;

const DEFAULTS = { enabled: true, maxPerWindow: 25, delaySeconds: 15 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FreeGames extends EventEmitter {
  constructor({ api, store, db, isStorageBot, isStandby, log }) {
    super();
    this.api = api;
    this.store = store;
    this.db = db;
    this.isStorageBot = isStorageBot || (() => false);
    this.isStandby = isStandby || (() => false);
    this.log = log || (() => {});
    const saved = store.get('freegames', {}) || {};
    this.cfg = {
      enabled: saved.enabled !== false,
      maxPerWindow: Math.min(Math.max(parseInt(saved.maxPerWindow, 10) || MAX_PER_ACCOUNT_PER_WINDOW, 1), 30),
      delaySeconds: Math.min(Math.max(parseInt(saved.delaySeconds, 10) || MIN_REDEEM_DELAY_SECONDS, 5), 300)
    };
    this.lastFetchAt = Number(saved.lastFetchAt) || 0;
    this.changeNumber = Number(saved.changeNumber) || 0;
    this.freePackages = new Set(saved.freePackages || []);
    this.redeemedThisWindow = {};
    this.windowStart = Date.now();
    this.running = false;
    this.timer = null;
    this.recent = [];
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
    return { config: this.getConfig(), running: this.running, freeCount: this.freePackages.size, recent: this.recent.slice(-40).reverse() };
  }

  setConfig(patch = {}) {
    const cfg = { ...this.cfg, ...patch };
    cfg.enabled = !!cfg.enabled;
    cfg.maxPerWindow = Math.min(Math.max(parseInt(cfg.maxPerWindow, 10) || MAX_PER_ACCOUNT_PER_WINDOW, 1), 30);
    cfg.delaySeconds = Math.min(Math.max(parseInt(cfg.delaySeconds, 10) || MIN_REDEEM_DELAY_SECONDS, 5), 300);
    this.cfg = cfg;
    this._persist();
    this._note(`Free game redemption ${cfg.enabled ? 'ENABLED' : 'DISABLED'} - max ${cfg.maxPerWindow}/bot, delay ${cfg.delaySeconds}s`);
    this.publish();
    return this.getConfig();
  }

  async tick() {
    if (!this.cfg.enabled || this.running || this.isStandby()) {
      this.publish();
      return;
    }
    if (Date.now() - this.lastFetchAt >= FETCH_INTERVAL_MS) {
      await this.fetchFreePackages();
    }
    if (this.freePackages.size > 0) {
      await this.redeemMissing();
    }
  }

  async fetchFreePackages() {
    try {
      let botName = null;
      const bots = (await this.api.getBots()) || {};
      for (const [name, bot] of Object.entries(bots)) {
        if (bot.IsConnectedAndLoggedOn) {
          botName = name;
          break;
        }
      }
      if (!botName) {
        this._note('No connected bot to query free packages');
        return;
      }
      const changes = await this.api.request('GET', `/Api/FreePackages/${encodeURIComponent(botName)}/GetChangesSince/${this.changeNumber || 1}`, undefined, 60000);
      const added = this._extractFreePackages(changes);
      let newCount = 0;
      for (const pkg of added) {
        if (!this.freePackages.has(pkg)) {
          this.freePackages.add(pkg);
          newCount += 1;
        }
      }
      if (changes && changes.ChangeNumber) this.changeNumber = Number(changes.ChangeNumber);
      this.lastFetchAt = Date.now();
      this._persist();
      this._note(`Fetched free packages - ${newCount} new (total ${this.freePackages.size})`);
    } catch (e) {
      this._note(`Failed to fetch free packages: ${e.message}`);
    }
    this.publish();
  }

  _extractFreePackages(changes) {
    const out = [];
    try {
      if (changes && typeof changes === 'object') {
        const pkgs = changes.Packages || changes.packages;
        if (pkgs && typeof pkgs === 'object') {
          for (const k of Object.keys(pkgs)) {
            const id = Number(k);
            if (Number.isFinite(id) && id > 0) out.push(`s/${id}`);
          }
        }
        const walk = (obj) => {
          if (!obj || typeof obj !== 'object') return;
          if (obj.id && obj.type && /sub|package/i.test(String(obj.type))) {
            out.push(`s/${obj.id}`);
          }
          for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (v && typeof v === 'object') walk(v);
          }
        };
        walk(changes);
      }
    } catch {
      /* best effort */
    }
    return [...new Set(out)];
  }

  async redeemMissing() {
    if (this.running) return;
    this.running = true;
    try {
      let bots;
      try {
        bots = (await this.api.getBots()) || {};
      } catch {
        this.running = false;
        return;
      }
      const now = Date.now();
      if (now - this.windowStart > 90 * 60000) {
        this.redeemedThisWindow = {};
        this.windowStart = now;
      }
      for (const [name, bot] of Object.entries(bots)) {
        if (!this.cfg.enabled || this.isStandby()) break;
        if (!bot.IsConnectedAndLoggedOn) continue;
        if (this.isStorageBot(name)) continue;
        const count = this.redeemedThisWindow[name] || 0;
        if (count >= this.cfg.maxPerWindow) continue;
        const owned = new Set(this.db.query('SELECT app_id FROM games WHERE bot = ?', [name]).map((r) => Number(r.app_id)));
        let redeemed = 0;
        for (const pkg of this.freePackages) {
          if (!this.cfg.enabled || this.isStandby()) break;
          if (redeemed >= this.cfg.maxPerWindow - count) break;
          if (this.redeemedThisWindow[name] >= this.cfg.maxPerWindow) break;
          try {
            await this.api.command(`addlicense ${name} ${pkg}`);
            this.redeemedThisWindow[name] = (this.redeemedThisWindow[name] || 0) + 1;
            redeemed += 1;
            this._note(`${name}: redeemed ${pkg}`);
          } catch (e) {
            this._note(`${name}: redeem ${pkg} failed (${e.message})`);
          }
          await sleep(this.cfg.delaySeconds * 1000);
        }
      }
    } finally {
      this.running = false;
      this.publish();
    }
  }

  _persist() {
    this.store.set('freegames', {
      ...this.cfg,
      lastFetchAt: this.lastFetchAt,
      changeNumber: this.changeNumber,
      freePackages: [...this.freePackages].slice(-2000)
    });
  }

  publish() {
    this.emit('state', this.getState());
  }

  _note(msg) {
    const line = `[FreeGames] ${msg}`;
    this.recent.push(`${new Date().toLocaleTimeString()}  ${line}`);
    if (this.recent.length > 60) this.recent.shift();
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { FreeGames };
