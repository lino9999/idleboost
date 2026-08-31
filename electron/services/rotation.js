const { EventEmitter } = require('events');
const home = require('../core/asfHome');

const TICK_MS = 15000;
const CONNECT_GRACE_MS = 5 * 60000;
const DISCONNECT_GRACE_MS = 3 * 60000;
const RETRY_COOLDOWN_MS = 10 * 60000;
const MAX_IDLE_GAMES = 32;
const BASE_IDLE_GAME_ID = 730;
const STOP_STAGGER_MS = 1000;
const FARMING_PAUSED_BY_DEFAULT = 1;
const DEFAULTS = { enabled: false, mode: 'warming', maxActiveBots: 50, minHours: 4, maxHours: 6 };

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
    cfg.mode = cfg.mode === 'freegames' ? 'freegames' : 'warming';
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
      `Settings saved - ${cfg.enabled ? 'ENABLED' : 'DISABLED'}${cfg.enabled && cfg.mode === 'freegames' ? ' (FreeGames mode)' : ''}, max ${cfg.maxActiveBots} active bots, uptime ${cfg.minHours}-${cfg.maxHours}h`
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
      // ASF's Start endpoint returns a single bool (not a per-bot map). Any
      // definite refusal is an error; otherwise we trust the runtime state.
      const res = await this.api.startBots([name]);
      if (res === false) throw new Error('ASF refused the start');
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
      await this.api.stopBots([name]);
    } catch (e) {
      this._note(`Failed to stop ${name}: ${e.message}`);
    }
    delete this.manualActive[name];
    this._persist();
    this._note(`Stopped ${name} manually`);
    this.publish();
    return { ok: true };
  }

  // Stops every running bot one at a time with a fixed delay in between, so the
  // accounts do not all drop offline in the same instant (looks suspicious to Steam).
  // Uses ASF's runtime Stop endpoint: no bot config file is rewritten.
  async _stopAllStaggered() {
    if (this.stoppingAll) return;
    let names = [];
    try {
      const bots = (await this.api.getBots()) || {};
      names = Object.keys(bots)
        .filter((n) => bots[n] && (bots[n].KeepRunning === true || bots[n].IsConnectedAndLoggedOn))
        .sort((a, b) => a.localeCompare(b));
    } catch (e) {
      this._note(`Failed to list bots for staggered stop: ${e.message}`);
      return;
    }
    if (names.length === 0) {
      this._note('No running bots to stop');
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
          await this.api.stopBots([name]);
        } catch (e) {
          this._note(`Failed to stop ${name}: ${e.message}`);
        }
        if (!this.stoppingAll) break;
        this.stoppingAll.stopped += 1;
        this.publish();
        await sleep(STOP_STAGGER_MS);
      }
      if (this.stoppingAll) {
        this._note(`Staggered stop finished - ${this.stoppingAll.stopped}/${names.length} bot(s) stopped`);
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

  // "FreeGames unlocker" mode: enables the warming engine in a no-farming mode.
  // Bots are brought ONLINE with farming fully disabled (no card farming, no hour
  // idling), so the FreePackages plugin only redeems free games. The engine still
  // applies "Max Active Bots Limit", "Min Uptime" and "Max Uptime", rotating the
  // accounts exactly like normal warming. Requires one proxy per account.
  async startFreeGames() {
    const asfDir = this.getAsfDir ? this.getAsfDir() : null;
    if (!asfDir) throw new Error('ASF directory not available');

    let bots = {};
    try {
      bots = (await this.api.getBots()) || {};
    } catch {
      bots = {};
    }
    const names = Object.keys(bots)
      .filter((n) => !this.isStorageBot(n))
      .sort((a, b) => a.localeCompare(b));
    if (names.length === 0) throw new Error('No bots to start');

    // Every account needs its own proxy before going online.
    const missingProxy = this._botsMissingProxy(asfDir, bots, names);
    if (missingProxy.length > 0) {
      throw new Error(
        `${missingProxy.length} bot(s) have no proxy (one per account is required): ${missingProxy.slice(0, 5).join(', ')}${
          missingProxy.length > 5 ? '…' : ''
        }`
      );
    }

    // Configure every bot for FreeGames (redeem only, no farming). Enabled stays
    // false in the config: the engine starts/stops bots at runtime, honoring the
    // Max Active Bots / uptime settings.
    let written = 0;
    for (const name of names) {
      const cfg = home.readBotConfig(asfDir, name);
      if (!cfg) continue;
      const before = JSON.stringify(cfg);
      cfg.EnableFreePackages = true;
      cfg.PauseFreePackagesWhilePlaying = true;
      cfg.PauseFreePackagesWhileFarming = true;
      const limit = Number(cfg.FreePackagesLimit);
      if (!Number.isFinite(limit) || limit <= 0) cfg.FreePackagesLimit = 25;
      if (!Array.isArray(cfg.FreePackagesFilters) || cfg.FreePackagesFilters.length === 0) {
        cfg.FreePackagesFilters = home.FREE_GAMES_DEFAULT_FILTERS;
      }
      // No card farming and no hour idling: the bot just stays online so the
      // FreePackages plugin redeems. (Do NOT pause the farmer via
      // FarmingPreferences: it would leave every bot showing "Paused" in ASF for
      // no benefit - with GamesPlayedWhileIdle empty there is nothing to farm.)
      cfg.FarmingPreferences = (Number(cfg.FarmingPreferences) || 0) & ~FARMING_PAUSED_BY_DEFAULT;
      cfg.GamesPlayedWhileIdle = [];
      // Keep Enabled false in the config: the engine starts/stops bots at runtime
      // (honoring Max Active Bots), so ASF must not auto-start every bot.
      cfg.Enabled = false;
      if (JSON.stringify(cfg) !== before) {
        try {
          home.writeBotConfig(asfDir, name, cfg);
          written += 1;
        } catch {
          /* skip this bot */
        }
      }
    }

    // Enable the engine in FreeGames mode; the tick() loop applies Max Active Bots
    // and Min/Max Uptime exactly like normal warming.
    this.setConfig({ enabled: true, mode: 'freegames' });
    this._note(
      `FreeGames unlocker: engine enabled (max ${this.cfg.maxActiveBots} active, uptime ${this.cfg.minHours}-${this.cfg.maxHours}h) - ${written} config(s) set to redeem-only`
    );
    if (this.notifier) this.notifier.notify('warming', 'FreeGames unlocker started');
    this.publish();
    // Kick a tick immediately instead of waiting for the next interval.
    this.tick().catch(() => {});
    return { ok: true, written };
  }


  // Names (among `names`) that have no WebProxy either in the live ASF config or
  // in the on-disk bot config file.
  _botsMissingProxy(asfDir, bots, names) {
    const missing = [];
    for (const name of names) {
      const liveProxy = bots[name] && bots[name].BotConfig && bots[name].BotConfig.WebProxy;
      let fileProxy = false;
      try {
        const cfg = home.readBotConfig(asfDir, name);
        fileProxy = !!(cfg && cfg.WebProxy);
      } catch {
        fileProxy = false;
      }
      if (!liveProxy && !fileProxy) missing.push(name);
    }
    return missing;
  }

  // Lightweight readiness probe for the "Start FreeGames unlocker" button: it
  // reports whether every (non-storage) account has a proxy. Storage accounts are
  // excluded because the unlocker never starts them.
  async freeGamesCheck() {
    const asfDir = this.getAsfDir ? this.getAsfDir() : null;
    const freeGamesActive = !!(this.cfg.enabled && this.cfg.mode === 'freegames');
    let bots = {};
    try {
      bots = (await this.api.getBots()) || {};
    } catch {
      return { ready: false, total: 0, missingProxy: [], freeGamesActive };
    }
    const names = Object.keys(bots).filter((n) => !this.isStorageBot(n));
    const missingProxy = asfDir ? this._botsMissingProxy(asfDir, bots, names) : [];
    return {
      ready: names.length > 0 && missingProxy.length === 0,
      total: names.length,
      missingProxy,
      freeGamesActive
    };
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

      // Warming must farm: clear the "paused by default" bit in case it was set
      // by the FreeGames unlocker mode.
      if ((Number(cfg.FarmingPreferences) || 0) & FARMING_PAUSED_BY_DEFAULT) {
        cfg.FarmingPreferences = (Number(cfg.FarmingPreferences) || 0) & ~FARMING_PAUSED_BY_DEFAULT;
        try {
          home.writeBotConfig(asfDir, name, cfg);
        } catch {
          /* skip */
        }
      }

      const current = Array.isArray(cfg.GamesPlayedWhileIdle) ? cfg.GamesPlayedWhileIdle.map(Number).filter((n) => n > 0) : [];
      const owned = await this._ownedGamesFor(name, bot);
      // Every bot always idles on CS2 (730) as its base game; the remaining slots
      // (up to 32 simultaneous games) are filled with the bot's owned games.
      const rest = [...new Set([...current, ...owned])].filter((id) => id !== BASE_IDLE_GAME_ID);
      const merged = [BASE_IDLE_GAME_ID, ...rest].slice(0, MAX_IDLE_GAMES);
      const changed = merged.length !== current.length || merged.some((id, i) => current[i] !== id);
      if (changed) {
        cfg.GamesPlayedWhileIdle = merged;
        try {
          home.writeBotConfig(asfDir, name, cfg);
          result.updatedIdle.push({ name, added: Math.max(0, merged.length - current.length) });
          this._note(`${name}: idle games set to ${merged.length} (base: CS2)`);
        } catch {
          /* skip */
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

    // Drop manually-started bots that were removed or are no longer being run by ASF
    // (works even when the engine is off).
    for (const name of Object.keys(this.manualActive)) {
      const bot = this.lastBots[name];
      if (!bot || (bot.KeepRunning === false && !bot.IsConnectedAndLoggedOn)) {
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

    const sessionsToStop = [];
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
        sessionsToStop.push(name);
        this._note(`Stopped ${name} - ${reason}; it will rejoin the queue`);
        delete this.sessions[name];
        this.startCooldown[name] = now;
        this.queueOrder = this.queueOrder.filter((x) => x !== name);
        this.queueOrder.push(name);
        changed = true;
      }
    }
    if (sessionsToStop.length > 0) {
      this.api.stopBots(sessionsToStop).catch((e) => this._note(`Failed to stop ${sessionsToStop.join(', ')}: ${e.message}`));
    }

    const names = Object.keys(bots).filter((n) => !this.isStorageBot(n));
    const nameSet = new Set(names);
    this.queueOrder = this.queueOrder.filter((n) => nameSet.has(n));
    for (const n of names.sort((a, b) => a.localeCompare(b))) {
      if (!this.queueOrder.includes(n)) this.queueOrder.push(n);
    }

    const expired = Object.keys(this.sessions).filter((n) => this.sessions[n].expiresAt <= now);
    if (expired.length) {
      try {
        await this.api.stopBots(expired);
      } catch (e) {
        this._note(`Failed to stop ${expired.join(', ')}: ${e.message}`);
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
      // Collect the bots to start, then start them all with ONE multi-bot ASF
      // call (no per-bot config rewrites).
      const toStart = [];
      for (const name of this.queueOrder) {
        if (slots <= 0) break;
        const bot = bots[name];
        if (!bot) continue;
        if (this.sessions[name]) continue;
        if (this.manualActive[name]) continue;
        if ((bot.RequiredInput || 0) > 0) continue;
        if (bot.IsConnectedAndLoggedOn || bot.KeepRunning === true) continue;
        if (this.startCooldown[name] && now - this.startCooldown[name] < RETRY_COOLDOWN_MS) continue;
        toStart.push(name);
        slots -= 1;
      }
      if (toStart.length > 0) {
        // ASF's multi-bot Start endpoint answers with ONE bool for the whole
        // batch, so we cannot rely on a per-bot result map. Call it, then verify
        // against the real runtime state: a session is created only for bots ASF
        // is actually running (KeepRunning) - no zombie sessions, no false kills.
        try {
          await this.api.startBots(toStart);
        } catch (e) {
          this._note(`Could not start bots (${toStart.length}): ${e.message}`);
        }
        let fresh = {};
        try {
          fresh = (await this.api.getBots()) || {};
        } catch {
          fresh = {};
        }
        if (Object.keys(fresh).length > 0) {
          this.lastBots = fresh;
        }
        for (const name of toStart) {
          const b = (Object.keys(fresh).length > 0 ? fresh : this.lastBots)[name];
          const actuallyRunning = !!b && (b.KeepRunning === true || b.IsConnectedAndLoggedOn);
          if (!actuallyRunning) {
            this._note(`Could not start ${name} - retry later`);
            this.startCooldown[name] = now;
            continue;
          }
          const hours = rand(this.cfg.minHours, this.cfg.maxHours);
          this.sessions[name] = {
            startedAt: Date.now(),
            expiresAt: Date.now() + Math.round(hours * 3600000),
            hours,
            connectedEver: !!b.IsConnectedAndLoggedOn
          };
          this._note(`Started ${name} - uptime ${hours.toFixed(1)}h`);
          if (this.notifier) this.notifier.notify('warming', `${name} started warming (uptime ${hours.toFixed(1)}h)`);
          changed = true;
        }
      }
    }

    const runaways = names.filter(
      (n) => !this.sessions[n] && !this.manualActive[n] && (bots[n].IsConnectedAndLoggedOn || bots[n].KeepRunning === true)
    );
    if (runaways.length > 0) {
      try {
        await this.api.stopBots(runaways);
        this._note(`Stopped ${runaways.join(', ')} - not part of the active warming sessions`);
      } catch (e) {
        this._note(`Failed to stop ${runaways.join(', ')}: ${e.message}`);
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
      freeGamesActive: !!(this.cfg.enabled && this.cfg.mode === 'freegames'),
      mode: this.cfg.mode,
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
