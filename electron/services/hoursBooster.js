const { EventEmitter } = require('events');
const home = require('../core/asfHome');

const TICK_MS = 60000;
const MAX_IDLE_GAMES = 32;
const BASE_IDLE_GAME_ID = 730;
const DEFAULTS = { enabled: true, maxGames: 30, refreshHours: 24, excludeStorage: true };

function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function clampNum(value, lo, hi, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function pickRandom(arr, count) {
  const copy = [...arr];
  const out = [];
  while (copy.length > 0 && out.length < count) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class HoursBooster extends EventEmitter {
  constructor({ api, store, db, getAsfDir, isStorageBot, isStandby, log }) {
    super();
    this.api = api;
    this.store = store;
    this.db = db;
    this.getAsfDir = getAsfDir;
    this.isStorageBot = isStorageBot || (() => false);
    this.isStandby = isStandby || (() => false);
    this.log = log || (() => {});
    const saved = store.get('hours-boost', {}) || {};
    this.cfg = {
      enabled: saved.enabled !== false,
      maxGames: clampInt(saved.maxGames, 1, MAX_IDLE_GAMES, DEFAULTS.maxGames),
      refreshHours: clampNum(saved.refreshHours, 1, 720, DEFAULTS.refreshHours),
      excludeStorage: saved.excludeStorage !== false
    };
    this.lastRunAt = Number(saved.lastRunAt) || 0;
    this.lastResult = saved.lastResult || null;
    this.running = false;
    this.recent = [];
    this.timer = null;
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
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      nextRunAt: this.cfg.enabled ? this.lastRunAt + this.cfg.refreshHours * 3600000 : null,
      recent: this.recent.slice(-40).reverse()
    };
  }

  setConfig(patch = {}) {
    const cfg = { ...this.cfg, ...patch };
    cfg.enabled = !!cfg.enabled;
    cfg.maxGames = clampInt(cfg.maxGames, 1, MAX_IDLE_GAMES, DEFAULTS.maxGames);
    cfg.refreshHours = clampNum(cfg.refreshHours, 1, 720, DEFAULTS.refreshHours);
    cfg.excludeStorage = !!cfg.excludeStorage;
    this.cfg = cfg;
    this._persist();
    this._note(
      `Hours boost settings saved - ${cfg.enabled ? 'ENABLED' : 'DISABLED'}, up to ${cfg.maxGames} games per bot, every ${cfg.refreshHours}h`
    );
    this.publish();
    return this.getConfig();
  }

  async tick() {
    if (!this.cfg.enabled || this.running || this.isStandby()) {
      this.publish();
      return;
    }
    if (Date.now() - this.lastRunAt < this.cfg.refreshHours * 3600000) {
      this.publish();
      return;
    }
    await this.runOnce(false);
  }

  async runOnce(manual = true) {
    if (this.running) return { skipped: true };
    if (!manual && !this.cfg.enabled) return { skipped: true };
    this.running = true;
    this.publish();

    const res = { at: Date.now(), bots: 0, games: 0, skipped: 0, errors: 0 };
    try {
      const bots = (await this.api.getBots()) || {};
      for (const [name, bot] of Object.entries(bots)) {
        if (this.isStandby()) {
          this._note('Standby engaged - hours boost interrupted');
          break;
        }
        if (!bot.IsConnectedAndLoggedOn) continue;
        if (this.cfg.excludeStorage && this.isStorageBot(name)) {
          res.skipped += 1;
          continue;
        }
        try {
          const cfg = home.readBotConfig(this.getAsfDir(), name);
          if (!cfg) {
            res.errors += 1;
            continue;
          }
          if (Array.isArray(cfg.GamesPlayedWhileIdle) && cfg.GamesPlayedWhileIdle.length > 0) {
            // Make sure the base game (CS2) is present even in hand-made lists.
            const list = cfg.GamesPlayedWhileIdle.map(Number).filter((n) => n > 0);
            if (!list.includes(BASE_IDLE_GAME_ID)) {
              cfg.GamesPlayedWhileIdle = [BASE_IDLE_GAME_ID, ...list].slice(0, MAX_IDLE_GAMES);
              home.writeBotConfig(this.getAsfDir(), name, cfg);
              res.bots += 1;
              this._record(name, cfg.GamesPlayedWhileIdle.length, 'added base game CS2 (730) to the idle list');
            } else {
              res.skipped += 1;
            }
            continue;
          }
          const rows = this.db ? this.db.query('SELECT app_id FROM games WHERE bot = ?', [name]) : [];
          const ids = rows
            .map((r) => Number(r.app_id))
            .filter((n) => Number.isFinite(n) && n > 0 && n !== BASE_IDLE_GAME_ID);
          if (ids.length === 0) {
            // No owned games known - still idle on the base game (CS2).
            cfg.GamesPlayedWhileIdle = [BASE_IDLE_GAME_ID];
            home.writeBotConfig(this.getAsfDir(), name, cfg);
            res.bots += 1;
            res.games += 1;
            this._record(name, 1, 'no owned games in local database - idling on base game CS2 (730)');
            continue;
          }
          const picked = pickRandom(ids, Math.max(0, Math.min(this.cfg.maxGames, MAX_IDLE_GAMES) - 1));
          cfg.GamesPlayedWhileIdle = [BASE_IDLE_GAME_ID, ...picked].slice(0, MAX_IDLE_GAMES);
          home.writeBotConfig(this.getAsfDir(), name, cfg);
          res.bots += 1;
          res.games += cfg.GamesPlayedWhileIdle.length;
          this._record(name, cfg.GamesPlayedWhileIdle.length, `boosting ${cfg.GamesPlayedWhileIdle.length}/${ids.length + 1} game(s) while idle (base: CS2)`);
        } catch (e) {
          res.errors += 1;
          this._record(name, 0, e.message);
        }
        await sleep(1500);
      }
    } catch (e) {
      res.errors += 1;
      this._note(`Hours boost aborted: ${e.message}`);
    }

    this.running = false;
    this.lastRunAt = Date.now();
    this.lastResult = res;
    this._persist();
    this._note(`Hours boost finished - ${res.bots} bot(s) configured, ${res.games} game play-session(s), ${res.errors} error(s)`);
    this.publish();
    return res;
  }

  _record(bot, count, detail) {
    this.recent.push({ at: Date.now(), bot, count, detail: String(detail || '').slice(0, 200) });
    if (this.recent.length > 80) this.recent.splice(0, this.recent.length - 80);
  }

  _persist() {
    this.store.set('hours-boost', { ...this.cfg, lastRunAt: this.lastRunAt, lastResult: this.lastResult });
  }

  publish() {
    this.emit('state', this.getState());
  }

  _note(msg) {
    const line = `[HoursBoost] ${msg}`;
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { HoursBooster };
