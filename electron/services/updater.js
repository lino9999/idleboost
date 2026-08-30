const { EventEmitter } = require('events');

const TICK_MS = 60000;
const DEFAULTS = { autoAsf: true, autoPlugins: true, intervalHours: 12, channel: 1 };
const RESTART_DELAY_MS = 25000;

function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function normalizeVersion(v) {
  return String(v || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[+\-]/)[0];
}

function versionParts(v) {
  return normalizeVersion(v)
    .split('.')
    .map((x) => parseInt(x, 10))
    .filter((x) => Number.isFinite(x));
}

function isNewerVersion(candidate, current) {
  const a = versionParts(candidate);
  const b = versionParts(current);
  if (a.length === 0) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

class UpdateManager extends EventEmitter {
  constructor({ api, manager, store, db, log }) {
    super();
    this.api = api;
    this.manager = manager;
    this.store = store;
    this.db = db;
    this.log = log || (() => {});
    const saved = store.get('updater', {}) || {};
    this.cfg = {
      autoAsf: saved.autoAsf !== false,
      autoPlugins: saved.autoPlugins !== false,
      intervalHours: clampInt(saved.intervalHours, 1, 168, DEFAULTS.intervalHours),
      channel: 1
    };
    this.lastCheckAt = Number(saved.lastCheckAt) || 0;
    this.lastResult = saved.lastResult || null;
    this.busy = false;
    this.restartScheduled = false;
    this.timer = null;
    this.quitting = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this._maybeCheck().catch(() => {}), TICK_MS);
    // On every program start, force an update check regardless of the hourly
    // interval, as soon as ASF is reachable.
    this._startupUpdate().catch(() => {});
  }

  // Waits for ASF to come online, then forces a check/update pass bypassing the
  // hourly interval (the autoAsf / autoPlugins toggles are still respected). The
  // FreePackages plugin stays excluded from plugin updates (see checkNow).
  async _startupUpdate() {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (this.quitting) return;
      try {
        await this.api.getAsf();
        this._note(`Startup: checking for ASF / plugin updates (auto-update ASF ${this.cfg.autoAsf ? 'ON' : 'OFF'}, plugins ${this.cfg.autoPlugins ? 'ON' : 'OFF'})...`);
        await this.checkNow(false);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    this._note('Startup: ASF never became reachable - update check skipped');
  }

  stop() {
    this.quitting = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getConfig() {
    return { ...this.cfg };
  }

  getState() {
    return {
      config: this.getConfig(),
      busy: this.busy,
      lastCheckAt: this.lastCheckAt,
      lastResult: this.lastResult,
      restartScheduled: this.restartScheduled
    };
  }

  setConfig(patch = {}) {
    const cfg = { ...this.cfg, ...patch };
    cfg.autoAsf = !!cfg.autoAsf;
    cfg.autoPlugins = !!cfg.autoPlugins;
    cfg.intervalHours = clampInt(cfg.intervalHours, 1, 168, DEFAULTS.intervalHours);
    cfg.channel = 1;
    this.cfg = cfg;
    this._persist();
    this._note(
      `Update settings saved - ASF auto-update ${cfg.autoAsf ? 'ON' : 'OFF'}, plugin auto-update ${cfg.autoPlugins ? 'ON' : 'OFF'}, every ${cfg.intervalHours}h, channel Stable`
    );
    this.publish();
    return this.getConfig();
  }

  async _maybeCheck() {
    if (this.busy) return;
    if (Date.now() - this.lastCheckAt < this.cfg.intervalHours * 3600000) return;
    await this.checkNow(false);
  }

  async checkNow(manual = true) {
    if (this.busy) return { skipped: true };
    this.busy = true;
    this.publish();

    const res = {
      asfCurrent: null,
      asfLatest: null,
      asfUpdateAvailable: false,
      asfUpdated: false,
      plugins: [],
      pluginsChecked: false,
      pluginMessage: null,
      errors: []
    };

    try {
      const info = await this.api.getAsf();
      res.asfCurrent = (info && info.Version) || null;
    } catch (e) {
      res.errors.push(`ASF info: ${e.message}`);
    }

    if (res.asfCurrent) {
      try {
        let release = await this.api.getLatestRelease();
        if (release && this.cfg.channel === 1 && release.Stable === false) {
          try {
            release = (await this.api.getRelease('latest')) || release;
          } catch {
            /* keep latest known release */
          }
        }
        res.asfLatest = (release && release.Version) || null;
        res.asfUpdateAvailable = !!res.asfLatest && isNewerVersion(res.asfLatest, res.asfCurrent);

        if (res.asfUpdateAvailable && (this.cfg.autoAsf || manual)) {
          this._note(`New ASF version detected: ${res.asfLatest} (current ${res.asfCurrent}) - updating...`);
          try {
            const msg = await this.api.updateAsf({});
            res.asfUpdated = true;
            this._note(`ASF update triggered${msg ? `: ${msg}` : ''}`);
            this._scheduleRestart();
          } catch (e) {
            res.errors.push(`ASF update: ${e.message}`);
            this._note(`ASF update failed: ${e.message}`);
          }
        } else if (res.asfUpdateAvailable) {
          this._note(`New ASF version ${res.asfLatest} is available, but auto-update is disabled`);
        } else {
          this._note(`ASF is up to date (${res.asfCurrent})`);
        }
      } catch (e) {
        res.errors.push(`Release check: ${e.message}`);
      }
    }

    if (this.cfg.autoPlugins || manual) {
      let pluginNames = [];
      try {
        const plugins = await this.api.getPlugins();
        res.plugins = Array.isArray(plugins)
          ? plugins.map((p) => ({ name: p.Name, version: p.Version }))
          : [];
        pluginNames = Array.isArray(plugins)
          ? plugins.map((p) => String(p.Name || '')).filter(Boolean)
          : [];
      } catch (e) {
        res.errors.push(`Plugins list: ${e.message}`);
      }
      try {
        // FreePackages is intentionally excluded from auto-update: it fetches a badge database from
        // GitHub (raw.githubusercontent.com), which rate-limits the IP and wastes bandwidth. Keeping
        // it out of the update cycle avoids re-downloading it and re-triggering that fetch. (A true
        // cache would require patching the compiled plugin, which is not feasible here.)
        const body = {};
        let excluded = false;
        if (pluginNames.length > 0) {
          const targets = pluginNames.filter((n) => !/freepackages|freegames/i.test(n));
          excluded = targets.length !== pluginNames.length;
          if (excluded) {
            this._note('FreePackages plugin excluded from auto-update (avoids GitHub badge-db rate limiting)');
          }
          body.Plugins = targets;
        }
        if (body.Plugins && body.Plugins.length === 0) {
          res.pluginsChecked = true;
          res.pluginMessage = 'No plugins to update (all excluded)';
          this._note('No plugins to update (all excluded from auto-update)');
        } else {
          const msg = await this.api.updatePlugins(body);
          res.pluginsChecked = true;
          res.pluginMessage =
            typeof msg === 'string' && msg.trim() ? msg.trim() : msg && typeof msg === 'object' ? JSON.stringify(msg) : null;
          const looksUpdated =
            !!res.pluginMessage &&
            /updat(e|ed|ing)/i.test(res.pluginMessage) &&
            !/up.?to.?date|already|nothing to update/i.test(res.pluginMessage);
          if (looksUpdated) {
            this._note(`Plugin update triggered: ${res.pluginMessage}`);
            this._scheduleRestart();
          } else {
            this._note(`Plugins check finished${res.pluginMessage ? `: ${res.pluginMessage}` : ' (all plugins up to date)'}`);
          }
        }
      } catch (e) {
        res.errors.push(`Plugins update: ${e.message}`);
      }
    }

    this.busy = false;
    this.lastCheckAt = Date.now();
    this.lastResult = res;
    this._persist();
    try {
      if (this.db) {
        this.db.run('INSERT INTO update_log (kind, from_version, to_version, status, detail, ts) VALUES (?, ?, ?, ?, ?, ?)', [
          'asf',
          String(res.asfCurrent || ''),
          String(res.asfLatest || ''),
          res.asfUpdated ? 'updated' : res.asfUpdateAvailable ? 'available' : 'current',
          res.asfUpdated ? 'Auto-update triggered' : '',
          this.lastCheckAt
        ]);
        this.db.scheduleSave();
      }
    } catch {
      /* db optional */
    }
    if (manual) {
      this._note(
        res.errors.length > 0
          ? `Manual update check finished with ${res.errors.length} error(s): ${res.errors.join(' | ')}`
          : 'Manual update check finished'
      );
    }
    this.publish();
    return res;
  }

  _scheduleRestart() {
    if (this.restartScheduled) return;
    this.restartScheduled = true;
    this._note(`ASF will be restarted in ${Math.round(RESTART_DELAY_MS / 1000)}s to apply the update`);
    this.publish();
    setTimeout(() => {
      this.restartScheduled = false;
      try {
        this.manager.restart();
      } catch {
        /* manager may be stopping */
      }
      this.publish();
    }, RESTART_DELAY_MS);
  }

  _persist() {
    this.store.set('updater', { ...this.cfg, lastCheckAt: this.lastCheckAt, lastResult: this.lastResult });
  }

  publish() {
    this.emit('state', this.getState());
  }

  _note(msg) {
    const line = `[Updater] ${msg}`;
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { UpdateManager, isNewerVersion };
