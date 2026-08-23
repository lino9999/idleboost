const { EventEmitter } = require('events');

const CYCLE_MS = 5 * 60000;
const ACTIONS = ['avatar', 'region', 'public'];
const ACTION_LABELS = { avatar: 'random avatar', region: 'random country', public: 'public profile' };
const DEFAULTS = {
  enabled: false,
  doAvatar: true,
  doRegion: true,
  doPublic: true,
  staggerSeconds: 20
};

function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ProfileSetup extends EventEmitter {
  constructor({ api, store, db, steamWeb, isStorageBot, isStandby, notifier, log }) {
    super();
    this.api = api;
    this.store = store;
    this.db = db;
    this.steamWeb = steamWeb;
    this.isStorageBot = isStorageBot || (() => false);
    this.isStandby = isStandby || (() => false);
    this.notifier = notifier;
    this.log = log || (() => {});
    const saved = store.get('profile-setup', {}) || {};
    this.cfg = {
      enabled: !!saved.enabled,
      doAvatar: saved.doAvatar !== false,
      doRegion: saved.doRegion !== false,
      doPublic: saved.doPublic !== false,
      staggerSeconds: clampInt(saved.staggerSeconds, 5, 600, DEFAULTS.staggerSeconds)
    };
    this.signatures = store.get('profile-signatures', null);
    if (!this.signatures || typeof this.signatures !== 'object') {
      this.signatures = {};
      for (const a of ACTIONS) this.signatures[a] = this._actionSignature(this.cfg, a);
    }
    this.lastRunAt = Number(saved.lastRunAt) || 0;
    this.running = false;
    this.recent = [];
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this._cycle().catch(() => {}), CYCLE_MS);
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
      nextRunAt: this.cfg.enabled ? this.lastRunAt + CYCLE_MS : null,
      recent: this.recent.slice(-60).reverse()
    };
  }

  _actionEnabled(action) {
    if (action === 'avatar') return !!this.cfg.doAvatar;
    if (action === 'region') return !!this.cfg.doRegion;
    if (action === 'public') return !!this.cfg.doPublic;
    return false;
  }

  _actionSignature(cfg, action) {
    if (action === 'avatar') return cfg.doAvatar ? 'on' : 'off';
    if (action === 'region') return cfg.doRegion ? 'on' : 'off';
    if (action === 'public') return cfg.doPublic ? 'on' : 'off';
    return 'off';
  }

  setConfig(patch = {}) {
    const cfg = { ...this.cfg, ...patch };
    cfg.enabled = !!cfg.enabled;
    cfg.doAvatar = !!cfg.doAvatar;
    cfg.doRegion = !!cfg.doRegion;
    cfg.doPublic = !!cfg.doPublic;
    cfg.staggerSeconds = clampInt(cfg.staggerSeconds, 5, 600, DEFAULTS.staggerSeconds);

    const resetActions = [];
    for (const action of ACTIONS) {
      const newSig = this._actionSignature(cfg, action);
      const oldSig = this.signatures[action];
      const enabledNow = this._actionEnabledIn(cfg, action);
      if (oldSig !== undefined && oldSig !== newSig && enabledNow) {
        resetActions.push(action);
      }
      this.signatures[action] = newSig;
    }

    this.cfg = cfg;
    for (const action of resetActions) {
      this.db.run('DELETE FROM profile_state WHERE action = ?', [action]);
      this._note(`Setting "${ACTION_LABELS[action]}" changed - it will be applied again to accounts that are missing it`);
    }
    this.db.scheduleSave();
    this.store.set('profile-setup', { ...this.cfg, lastRunAt: this.lastRunAt });
    this.store.set('profile-signatures', this.signatures);
    this._note(`Profile setup settings saved - automatic customization ${cfg.enabled ? 'ENABLED' : 'DISABLED'}`);
    this.publish();
    return this.getConfig();
  }

  _actionEnabledIn(cfg, action) {
    if (action === 'avatar') return !!cfg.doAvatar;
    if (action === 'region') return !!cfg.doRegion;
    if (action === 'public') return !!cfg.doPublic;
    return false;
  }

  _doneAt(bot, action) {
    const row = this.db.one('SELECT done_at FROM profile_state WHERE bot = ? AND action = ?', [bot, action]);
    return row ? Number(row.done_at) : 0;
  }

  _markDone(bot, action) {
    this.db.run(
      'INSERT INTO profile_state (bot, action, done_at) VALUES (?, ?, ?) ON CONFLICT(bot, action) DO UPDATE SET done_at = excluded.done_at',
      [bot, action, Date.now()]
    );
    this.db.scheduleSave();
  }

  async _cycle() {
    if (!this.cfg.enabled || this.running || this.isStandby()) {
      this.publish();
      return;
    }
    await this.processOne();
  }

  async processOne() {
    if (this.running) return;
    this.running = true;
    this.publish();
    try {
      const bots = (await this.api.getBots()) || {};
      const enabledActions = ACTIONS.filter((a) => this._actionEnabled(a));
      let target = null;
      let pending = [];
      for (const [name, bot] of Object.entries(bots)) {
        if (!bot.IsConnectedAndLoggedOn) continue;
        if (this.isStorageBot(name)) continue;
        const needs = enabledActions.filter((a) => this._doneAt(name, a) === 0);
        if (needs.length > 0) {
          target = name;
          pending = needs;
          break;
        }
      }
      if (!target) {
        this._note('All connected accounts are already customized - nothing to do this cycle');
      } else {
        this._note(`Customizing profile of ${target} (${pending.map((a) => ACTION_LABELS[a]).join(', ')})`);
        await this._applyToBot(target, pending);
      }
      this.lastRunAt = Date.now();
      this.store.set('profile-setup', { ...this.cfg, lastRunAt: this.lastRunAt });
    } catch (e) {
      this._note(`Profile customization aborted: ${e.message}`);
    }
    this.running = false;
    this.publish();
  }

  async _applyToBot(bot, pending) {
    if (pending.includes('avatar')) {
      await this._applyAvatar(bot);
      await sleep(this.cfg.staggerSeconds * 1000);
    }
    if (pending.includes('region')) {
      await this._applyRegion(bot);
      await sleep(this.cfg.staggerSeconds * 1000);
    }
    if (pending.includes('public')) {
      await this._applyWebActions(bot);
    }
  }

  async _applyAvatar(bot) {
    try {
      const out = await this.api.command(`randomgameavatar ${bot}`);
      const detail = typeof out === 'string' ? out.trim().split('\n')[0] : JSON.stringify(out);
      if (/unknown|sconosciuto|not found|error|failed/i.test(detail)) {
        throw new Error(detail || 'ASFEnhance returned an error');
      }
      this._markDone(bot, 'avatar');
      this._record({ bot, status: 'ok', action: 'avatar', detail });
      this._note(`${bot}: applied random avatar`);
      if (this.notifier) this.notifier.notify('profile', `${bot} profile updated - random avatar`);
    } catch (e) {
      this._record({ bot, status: 'error', action: 'avatar', detail: e.message });
      this._note(`${bot}: random avatar failed (${e.message})`);
    }
  }

  async _applyRegion(bot) {
    try {
      // Skip if the account already has a country set, to avoid an unnecessary request to Steam.
      try {
        const cookies = await this.steamWeb.getCookies(bot);
        const existingCountry = await this.steamWeb.getCountry(cookies);
        if (existingCountry) {
          this._markDone(bot, 'region');
          this._record({ bot, status: 'ok', action: 'region', detail: `country already set (${existingCountry}) - skipped` });
          this._note(`${bot}: country already set (${existingCountry}) - no request sent`);
          return;
        }
      } catch {
        /* could not pre-check; fall through and set it */
      }
      const out = await this.api.command(`setprofileregion ${bot} ?`);
      const detail = typeof out === 'string' ? out.trim().split('\n')[0] : JSON.stringify(out);
      if (/unknown|sconosciuto|not found|error|failed/i.test(detail)) {
        throw new Error(detail || 'ASFEnhance returned an error');
      }
      this._markDone(bot, 'region');
      this._record({ bot, status: 'ok', action: 'region', detail: detail || 'random country set' });
      this._note(`${bot}: applied random country`);
      if (this.notifier) this.notifier.notify('profile', `${bot} profile updated - random country`);
    } catch (e) {
      this._record({ bot, status: 'error', action: 'region', detail: e.message });
      this._note(`${bot}: random country failed (${e.message})`);
    }
  }

  async _applyWebActions(bot) {
    let cookies = null;
    try {
      cookies = await this.steamWeb.getCookies(bot);
    } catch (e) {
      this._record({ bot, status: 'error', action: 'public', detail: e.message });
      this._note(`${bot}: could not obtain web session (${e.message})`);
      return;
    }
    try {
      const result = await this.steamWeb.setPrivacyPublic(cookies);
      this._markDone(bot, 'public');
      if (result && result.already) {
        this._record({ bot, status: 'ok', action: 'public', detail: 'profile already public - no request sent' });
        this._note(`${bot}: profile already public - no request sent`);
      } else {
        this._record({ bot, status: 'ok', action: 'public', detail: 'profile, friends list and inventory set to public' });
        this._note(`${bot}: profile set to public (profile, friends list, inventory)`);
        if (this.notifier) this.notifier.notify('profile', `${bot} profile set to public`);
      }
    } catch (e) {
      this._record({ bot, status: 'error', action: 'public', detail: e.message });
      this._note(`${bot}: set public failed (${e.message})`);
    }
  }

  _record(entry) {
    this.recent.push({ at: Date.now(), ...entry, detail: String(entry.detail || '').slice(0, 220) });
    if (this.recent.length > 120) this.recent.splice(0, this.recent.length - 120);
    this.publish();
  }

  publish() {
    this.emit('state', this.getState());
  }

  _note(msg) {
    const line = `[Profile] ${msg}`;
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { ProfileSetup, ACTION_LABELS };
