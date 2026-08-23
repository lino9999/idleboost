const { EventEmitter } = require('events');

const CHECK_INTERVAL_MS = 30000;
const OWNED_CACHE_MS = 6 * 3600000;
const DEFAULT_DELAY_MINUTES = 5;

function clampNum(value, lo, hi, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

class PluginScheduler extends EventEmitter {
  constructor({ api, store, db, isStandby, isStorageBot, log }) {
    super();
    this.api = api;
    this.store = store;
    this.db = db;
    this.isStandby = isStandby || (() => false);
    this.isStorageBot = isStorageBot || (() => false);
    this.log = log || (() => {});
    const saved = store.get('achievement-scheduler', {}) || {};
    this.cfg = {
      enabled: !!saved.enabled,
      delayMinutes: clampNum(saved.delayMinutes, 1, 1440, DEFAULT_DELAY_MINUTES)
    };
    this.standby = false;
    this.running = false;
    this.lastUnlockAt = Number(saved.lastUnlockAt) || 0;
    this.unlocked = saved.unlocked && typeof saved.unlocked === 'object' ? saved.unlocked : {};
    this.rotor = Number(saved.rotor) || 0;
    this.ownedCache = {};
    this.stats = {
      unlockOps: Number(saved.stats && saved.stats.unlockOps) || 0,
      runs: Number(saved.stats && saved.stats.runs) || 0
    };
    this.lastAction = null;
    this.pendingCount = Number(saved.pendingCount) || 0;
    this.recent = [];
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.check().catch(() => {}), CHECK_INTERVAL_MS);
    this.check().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setStandby(on) {
    if (this.standby === on) return;
    this.standby = on;
    this._note(on ? 'Standby engaged - achievement unlocker paused' : 'Standby lifted - achievement unlocker resumed');
    this.publish();
  }

  setConfig(patch = {}) {
    const cfg = { ...this.cfg, ...patch };
    cfg.enabled = !!cfg.enabled;
    cfg.delayMinutes = clampNum(cfg.delayMinutes, 1, 1440, DEFAULT_DELAY_MINUTES);
    this.cfg = cfg;
    this._persist();
    this._note(`Auto-unlock ${cfg.enabled ? 'ENABLED' : 'DISABLED'} - one game per account every ${cfg.delayMinutes} minute(s)`);
    this.publish();
    return this.getConfig();
  }

  getConfig() {
    return { ...this.cfg };
  }

  getFullState() {
    return { config: this.getConfig(), ...this._state() };
  }

  _ownedAppsCached(bot) {
    const cached = this.ownedCache[bot];
    if (cached && Date.now() - cached.at < OWNED_CACHE_MS) return cached.ids;
    try {
      const rows = this.db ? this.db.query('SELECT app_id FROM games WHERE bot = ?', [bot]) : [];
      const ids = rows
        .map((r) => Number(r.app_id))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
      this.ownedCache[bot] = { at: Date.now(), ids };
      return ids;
    } catch {
      return cached ? cached.ids : [];
    }
  }

  _isUnlocked(bot, appId) {
    const set = this.unlocked[bot];
    return !!(set && set.includes(appId));
  }

  _markUnlocked(bot, appId) {
    if (!this.unlocked[bot]) this.unlocked[bot] = [];
    if (!this.unlocked[bot].includes(appId)) this.unlocked[bot].push(appId);
  }

  async check() {
    if (!this.cfg.enabled || this.running) {
      this.publish();
      return;
    }
    if (this.standby || this.isStandby()) {
      this.publish();
      return;
    }
    if (Date.now() - this.lastUnlockAt < this.cfg.delayMinutes * 60000) {
      this.publish();
      return;
    }
    await this._unlockOne();
  }

  async _unlockOne() {
    if (this.running) return;
    this.running = true;
    this.publish();
    try {
      let bots;
      try {
        bots = (await this.api.getBots()) || {};
      } catch (e) {
        this._note(`Cannot reach ASF IPC: ${e.message}`);
        this.running = false;
        this.publish();
        return;
      }

      const connected = Object.keys(bots)
        .filter((n) => bots[n].IsConnectedAndLoggedOn)
        .filter((n) => (bots[n].BotConfig ? bots[n].BotConfig.Enabled !== false : true))
        .filter((n) => !this.isStorageBot(n))
        .sort((a, b) => a.localeCompare(b));

      if (connected.length === 0) {
        this._note('No connected bots available - unlock skipped');
        this.running = false;
        this.publish();
        return;
      }

      this.rotor = this.rotor % connected.length;
      let target = null;
      let targetApp = null;
      for (let i = 0; i < connected.length; i++) {
        const idx = (this.rotor + i) % connected.length;
        const bot = connected[idx];
        const owned = await this._ownedAppsCached(bot);
        const pending = owned.filter((id) => !this._isUnlocked(bot, id));
        if (pending.length > 0) {
          target = bot;
          targetApp = pending[0];
          this.rotor = (idx + 1) % connected.length;
          break;
        }
      }

      if (!target) {
        this.pendingCount = 0;
        this._note('All owned games already unlocked on every connected bot - nothing to do');
        this.lastUnlockAt = Date.now();
        this._persist();
        this.running = false;
        this.publish();
        return;
      }

      this.lastAction = { bot: target, appId: targetApp };
      this.publish();
      try {
        await this.api.command(`aset ${target} ${targetApp} *`);
        this._markUnlocked(target, targetApp);
        this.stats.unlockOps += 1;
        this._note(`Unlocked all achievements for ${target} - app ${targetApp}`);
      } catch (e) {
        this._note(`aset ${target} ${targetApp} failed: ${e.message}`);
      }
      this.stats.runs += 1;
      this.lastUnlockAt = Date.now();
      this._persist();
    } catch (e) {
      this._note(`Unlock cycle error: ${e.message}`);
    }
    this.running = false;
    this.publish();
  }

  _state() {
    const next = this.cfg.enabled ? this.lastUnlockAt + this.cfg.delayMinutes * 60000 : null;
    return {
      standby: this.standby,
      running: this.running,
      progress: this.lastAction,
      lastResult: this.lastAction ? { at: this.lastUnlockAt, bot: this.lastAction.bot, appId: this.lastAction.appId } : null,
      stats: { ...this.stats },
      nextRunAt: next,
      recent: this.recent.slice(-30).reverse()
    };
  }

  publish() {
    this.emit('state', { config: this.getConfig(), ...this._state() });
  }

  _persist() {
    this.store.set('achievement-scheduler', {
      ...this.cfg,
      lastUnlockAt: this.lastUnlockAt,
      unlocked: this.unlocked,
      rotor: this.rotor,
      pendingCount: this.pendingCount,
      stats: this.stats
    });
  }

  _note(msg) {
    const line = `[AutoUnlock] ${msg}`;
    this.recent.push(`${new Date().toLocaleTimeString()}  ${line}`);
    if (this.recent.length > 60) this.recent.shift();
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { PluginScheduler };
