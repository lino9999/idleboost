const { EventEmitter } = require('events');
const home = require('../core/asfHome');

const TICK_MS = 15000;
const CONNECT_GRACE_MS = 5 * 60000;
const DISCONNECT_GRACE_MS = 3 * 60000;
const RETRY_COOLDOWN_MS = 10 * 60000;
const MAX_IDLE_GAMES = 32;
const STOP_STAGGER_MS = 1000;
const DEFAULTS = { enabled: false, maxActiveBots: 50, minHours: 4, maxHours: 6 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rand(min, max) {
  return min + Math.random() * Math.max(0, max - min);
}

function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function clampNum(value, lo, hi, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

class RotationEngine extends EventEmitter {
  constructor({ api, store, db, getAsfDir, isStandby, isStorageBot, notifier, log }) {
    super();
    this.api = api;
    this.store = store;
    this.db = db;
    this.getAsfDir = getAsfDir;
    this.isStandby = isStandby || (() => false);
    this.isStorageBot = isStorageBot || (() => false);
    this.notifier = notifier;
    this.log = log || (() => {});
    const savedCfg = store.get('rotation', {}) || {};
    this.cfg = { ...DEFAULTS, ...savedCfg, enabled: false };
    store.set('rotation', this.cfg);
    // On a fresh program start ASF is restarted too, so no bot can still be running: any session
    // persisted from the previous run is stale and would block Start / show ghost timers.
    this.sessions = {};
    store.set('rotation-sessions', this.sessions);
    // Bots started manually from the dashboard (name -> { startedAt }). Not persisted across restarts.
    this.manualActive = {};
    this.queueOrder = store.get('rotation-queue', []) || [];
    this.timer = null;
    this.lastBots = {};
    this.recent = [];
    this.standby = false;
    this.startCooldown = {};
    this.stoppingAll = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
    this.tick().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setStandby(on) {
    if (this.standby === on) return;
    this.standby = on;
    const now = Date.now();
    for (const s of Object.values(this.sessions)) {
      if (on) {
        s.remainingMs = Math.max(0, s.expiresAt - now);
      } else if (typeof s.remainingMs === 'number') {
        s.expiresAt = now + s.remainingMs;
        delete s.remainingMs;
      }
    }
    this._persist();
    this._note(on ? 'Standby engaged - rotation timers paused' : 'Standby lifted - rotation timers resumed');
    this.publish();
  }

  setConfig(patch = {}) {
    const cfg = { ...this.cfg, ...patch };
    cfg.maxActiveBots = clampInt(cfg.maxActiveBots, 1, 500, DEFAULTS.maxActiveBots);
    cfg.minHours = clampNum(cfg.minHours, 0.1, 240, DEFAULTS.minHours);
    cfg.maxHours = clampNum(cfg.maxHours, cfg.minHours, 240, Math.max(cfg.minHours, DEFAULTS.maxHours));
    cfg.enabled = !!cfg.enabled;
    this.cfg = cfg;
    this.store.set('rotation', cfg);

    if (patch.stopActive === true) {
      this.sessions = {};
      this.manualActive = {};
      this._persist();
      this._note('Stopping ALL bots');
      this._stopAllStaggered().catch(() => {});
    }

    this._note(
      `Settings saved - ${cfg.enabled ? 'ENABLED' : 'DISABLED'}, max ${cfg.maxActiveBots} active bots, uptime ${cfg.minHours}-${cfg.maxHours}h`
    );
    this.publish();
    return this.getConfig();
  }

  getConfig() {
    return { ...this.cfg };
  }

  activeCount() {
    // Storage accounts are started on demand and do not count toward the warming cap.
    const manualNonStorage = Object.keys(this.manualActive).filter((n) => !this.isStorageBot(n)).length;
    return Object.keys(this.sessions).length + manualNonStorage;
  }

  isManuallyActive(name) {
    return !!this.manualActive[name];
  }

  async startManual(name) {
    let bots = {};
    try {
      bots = (await this.api.getBots()) || {};
    } catch {
      bots = {};
    }
    const bot = bots[name];
    if (bot && ((bot.RequiredInput || 0) > 0)) throw new Error(`${name} needs login input before it can start`);
    const isStorage = this.isStorageBot(name);
    if (!isStorage && this.activeCount() >= this.cfg.maxActiveBots) {
      throw new Error(`Active sessions are full (${this.activeCount()}/${this.cfg.maxActiveBots}) - stop a bot first`);
    }
    try {
      await this.api.setBotEnabled(name, true);
    } catch (e) {
      throw new Error(`Could not start ${name}: ${e.message}`);
    }
    this.manualActive[name] = { startedAt: Date.now() };
    this.queueOrder = this.queueOrder.filter((x) => x !== name);
    this._persist();
    this._note(isStorage ? `Started ${name} (storage) manually` : `Started ${name} manually`);
    this.publish();
    return { ok: true };
  }

  async stopManual(name) {
    try {
      await this.api.setBotEnabled(name, false);
    } catch (e) {
      this._note(`Failed to stop ${name}: ${e.message}`);
    }
    delete this.manualActive[name];
    this._persist();
    this._note(`Stopped ${name} manually`);
    this.publish();
    return { ok: true };
  }

  // Stops every enabled bot one at a time with a fixed delay in between, so the
  // accounts do not all drop offline in the same instant (looks suspicious to Steam).
  async _stopAllStaggered() {
    if (this.stoppingAll) return;
    let names = [];
    try {
      const bots = (await this.api.getBots()) || {};
      names = Object.keys(bots)
        .filter((n) => bots[n] && bots[n].BotConfig && bots[n].BotConfig.Enabled !== false)
        .sort((a, b) => a.localeCompare(b));
    } catch (e) {
      this._note(`Failed to list bots for staggered stop: ${e.message}`);
      return;
    }
    if (names.length === 0) {
      this._note('No enabled bots to stop');
      this.publish();
      return;
    }
    this.stoppingAll = { stopped: 0, total: names.length };
    this.publish();
    this._note(`Stopping ${names.length} bot(s) one by one (${Math.round(STOP_STAGGER_MS / 1000)}s apart)...`);
    try {
      for (const name of names) {
        if (!this.stoppingAll) break;
        try {
          await this.api.setBotEnabled(name, false);
        } catch (e) {
          this._note(`Failed to stop ${name}: ${e.message}`);
        }
        if (!this.stoppingAll) break;
        this.stoppingAll.stopped += 1;
        this.publish();
        await sleep(STOP_STAGGER_MS);
      }
      if (this.stoppingAll) {
        this._note(`Staggered stop finished - ${this.stoppingAll.stopped}/${names.length} bot(s) disabled`);
      }
    } finally {
      this.stoppingAll = null;
      this.publish();
    }
  }

  stopStaggered() {
    // Interrupts an in-progress staggered stop.
    this.stoppingAll = null;
    this.publish();
    return { ok: true };
  }

  getFullState() {
    return { config: this.getConfig(), ...this._state() };
  }

  async prepareForStart() {
    const result = { checked: [], missingProxy: [], updatedIdle: [] };
    let bots = {};
    try {
      bots = (await this.api.getBots()) || {};
    } catch {
      bots = {};
    }
    const asfDir = this.getAsfDir ? this.getAsfDir() : null;
    if (!asfDir) return result;

    const names = Object.keys(bots).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      if (this.isStorageBot(name)) continue;
      this.emit('prepare-progress', { name });
      const cfg = home.readBotConfig(asfDir, name);
      if (!cfg) {
        result.checked.push(name);
        continue;
      }
      const bot = bots[name] || {};
      const botCfgProxy = bot.BotConfig && bot.BotConfig.WebProxy ? String(bot.BotConfig.WebProxy) : '';
      const fileProxy = cfg.WebProxy ? String(cfg.WebProxy) : '';
      if (!botCfgProxy && !fileProxy) result.missingProxy.push(name);

      const current = Array.isArray(cfg.GamesPlayedWhileIdle) ? cfg.GamesPlayedWhileIdle.map(Number).filter((n) => n > 0) : [];
      if (current.length < MAX_IDLE_GAMES) {
        const owned = await this._ownedGamesFor(name, bot);
        const missing = owned.filter((id) => !current.includes(id));
        const merged = [...current, ...missing].slice(0, MAX_IDLE_GAMES);
        if (merged.length > current.length) {
          cfg.GamesPlayedWhileIdle = merged;
          try {
            home.writeBotConfig(asfDir, name, cfg);
            result.updatedIdle.push({ name, added: merged.length - current.length });
            this._note(`${name}: filled GamesPlayedWhileIdle to ${merged.length} game(s)`);
          } catch {
            /* skip */
          }
        }
      }
      result.checked.push(name);
    }
    return result;
  }

  async _ownedGamesFor(name) {
    try {
      if (this.db) {
        const rows = this.db.query('SELECT app_id FROM games WHERE bot = ? ORDER BY updated_at DESC', [name]);
        if (rows && rows.length > 0) {
          return rows.map((r) => Number(r.app_id)).filter((n) => n > 0);
        }
      }
    } catch {
      /* fall through */
    }
    return [];
  }

  async tick() {
    let fresh = false;
    try {
      const fetched = (await this.api.getBots()) || {};
      this.lastBots = fetched;
      fresh = true;
    } catch {
      /* keep previous snapshot */
    }

    // Drop manually-started bots that were disabled or removed (works even when the engine is off).
    for (const name of Object.keys(this.manualActive)) {
      const bot = this.lastBots[name];
      if (!bot || (bot.BotConfig && bot.BotConfig.Enabled === false)) {
        delete this.manualActive[name];
      }
    }

    if (!this.cfg.enabled) {
      this.publish();
      return;
    }
    if (this.standby || this.isStandby()) {
      this.publish();
      return;
    }
    if (!fresh) {
      this.publish();
      return;
    }

    const bots = this.lastBots;
    const now = Date.now();
    let changed = false;

    for (const name of Object.keys(this.sessions)) {
      const bot = bots[name];
      if (!bot) {
        delete this.sessions[name];
        continue;
      }
      if (this.isStorageBot(name)) {
        delete this.sessions[name];
        continue;
      }
      if (bot.IsConnectedAndLoggedOn) {
        this.sessions[name].connectedEver = true;
        delete this.sessions[name].disconnectedSince;
        continue;
      }
      if (this.sessions[name].disconnectedSince === undefined) {
        this.sessions[name].disconnectedSince = now;
      }
      const stuckOnInput = (bot.RequiredInput || 0) > 0;
      const neverConnected = !this.sessions[name].connectedEver && now - this.sessions[name].startedAt > CONNECT_GRACE_MS;
      const droppedTooLong = !!this.sessions[name].connectedEver && now - this.sessions[name].disconnectedSince > DISCONNECT_GRACE_MS;
      if (stuckOnInput || neverConnected || droppedTooLong) {
        const reason = stuckOnInput
          ? 'waiting for login input'
          : neverConnected
            ? 'never connected within the grace period'
            : 'disconnected and did not come back';
        this.api.setBotEnabled(name, false).catch((e) => this._note(`Failed to stop ${name}: ${e.message}`));
        this._note(`Stopped ${name} - ${reason}; it will rejoin the queue`);
        delete this.sessions[name];
        this.startCooldown[name] = now;
        this.queueOrder = this.queueOrder.filter((x) => x !== name);
        this.queueOrder.push(name);
        changed = true;
      }
    }

    const names = Object.keys(bots).filter((n) => !this.isStorageBot(n));
    const nameSet = new Set(names);
    this.queueOrder = this.queueOrder.filter((n) => nameSet.has(n));
    for (const n of names.sort((a, b) => a.localeCompare(b))) {
      if (!this.queueOrder.includes(n)) this.queueOrder.push(n);
    }

    const expired = Object.keys(this.sessions).filter((n) => this.sessions[n].expiresAt <= now);
    if (expired.length) {
      for (const n of expired) {
        try {
          await this.api.setBotEnabled(n, false);
        } catch (e) {
          this._note(`Failed to stop ${n}: ${e.message}`);
        }
      }
      this._note(`Stopped ${expired.join(', ')} - uptime timer expired`);
      for (const n of expired) {
        delete this.sessions[n];
        this.queueOrder = this.queueOrder.filter((x) => x !== n);
        this.queueOrder.push(n);
      }
      changed = true;
    }

    const expiredSet = new Set(expired);
    const externallyActive = names.filter(
      (n) =>
        !this.sessions[n] &&
        !this.manualActive[n] &&
        !expiredSet.has(n) &&
        (bots[n].IsConnectedAndLoggedOn || bots[n].KeepRunning === true)
    );
    let slots =
      this.cfg.maxActiveBots -
      Object.keys(this.sessions).length -
      Object.keys(this.manualActive).length -
      externallyActive.length;

    if (slots > 0) {
      for (const name of this.queueOrder) {
        if (slots <= 0) break;
        const bot = bots[name];
        if (!bot) continue;
        if (this.sessions[name]) continue;
        if (this.manualActive[name]) continue;
        if ((bot.RequiredInput || 0) > 0) continue;
        if (bot.IsConnectedAndLoggedOn || bot.KeepRunning === true) continue;
        if (this.startCooldown[name] && now - this.startCooldown[name] < RETRY_COOLDOWN_MS) continue;
        try {
          await this.api.setBotEnabled(name, true);
          const hours = rand(this.cfg.minHours, this.cfg.maxHours);
          this.sessions[name] = {
            startedAt: Date.now(),
            expiresAt: Date.now() + Math.round(hours * 3600000),
            hours,
            connectedEver: false
          };
          this._note(`Started ${name} - uptime ${hours.toFixed(1)}h`);
          if (this.notifier) this.notifier.notify('warming', `${name} started warming (uptime ${hours.toFixed(1)}h)`);
          slots -= 1;
          changed = true;
        } catch (e) {
          this._note(`Could not start ${name}: ${e.message}`);
        }
      }
    }

    const runaways = names.filter(
      (n) => !this.sessions[n] && !this.manualActive[n] && (bots[n].IsConnectedAndLoggedOn || bots[n].KeepRunning === true)
    );
    if (runaways.length > 0) {
      for (const n of runaways) {
        try {
          await this.api.setBotEnabled(n, false);
          this._note(`Disabled ${n} - not part of the active warming sessions`);
        } catch (e) {
          this._note(`Failed to disable ${n}: ${e.message}`);
        }
      }
      changed = true;
    }

    this._persist();
    if (changed) {
      try {
        this.lastBots = (await this.api.getBots()) || {};
      } catch {
        /* keep the existing snapshot */
      }
    }
    this.publish();
  }

  _state() {
    const now = Date.now();
    const bots = this.lastBots || {};
    const sessionEntries = Object.entries(this.sessions)
      .map(([name, s]) => ({
        name,
        startedAt: s.startedAt,
        expiresAt: s.expiresAt,
        remainingMs:
          this.standby && typeof s.remainingMs === 'number' ? s.remainingMs : Math.max(0, s.expiresAt - now),
        totalMs: Math.max(1, s.expiresAt - s.startedAt),
        connected: !!bots[name] && !!bots[name].IsConnectedAndLoggedOn
      }))
      .sort((a, b) => a.remainingMs - b.remainingMs);

    const manualEntries = Object.entries(this.manualActive).map(([name, m]) => ({
      name,
      manual: true,
      startedAt: m.startedAt,
      remainingMs: null,
      totalMs: null,
      connected: !!bots[name] && !!bots[name].IsConnectedAndLoggedOn
    }));

    const active = [...sessionEntries, ...manualEntries];

    const queue = this.queueOrder.filter((n) => {
      const bot = bots[n];
      if (!bot) return false;
      if (this.sessions[n]) return false;
      if (this.manualActive[n]) return false;
      if ((bot.RequiredInput || 0) > 0) return false;
      if (bot.IsConnectedAndLoggedOn || bot.KeepRunning === true) return false;
      return true;
    });

    return {
      enabled: this.cfg.enabled,
      standby: this.standby,
      activeCount: active.length,
      active,
      queue,
      totalBots: Object.keys(bots).length,
      connectedCount: Object.values(bots).filter((b) => b.IsConnectedAndLoggedOn).length,
      maxActiveBots: this.cfg.maxActiveBots,
      stoppingAll: this.stoppingAll ? { ...this.stoppingAll } : null,
      recent: this.recent.slice(-30).reverse(),
      lastTick: now
    };
  }

  publish() {
    this.emit('state', { config: this.getConfig(), ...this._state() });
  }

  _persist() {
    this.store.set('rotation-sessions', this.sessions);
    this.store.set('rotation-queue', this.queueOrder);
  }

  _note(msg) {
    const line = `[Rotation] ${msg}`;
    this.recent.push(`${new Date().toLocaleTimeString()}  ${line}`);
    if (this.recent.length > 60) this.recent.shift();
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { RotationEngine };
