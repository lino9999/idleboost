const { EventEmitter } = require('events');
const home = require('../core/asfHome');

const TICK_MS = 30000;
const E_ACCESS = { NONE: 0, FAMILY_SHARING: 1, OPERATOR: 2, MASTER: 3 };
const TRADING_ACCEPT_DONATIONS = 1;
const FARMING_PAUSED_BY_DEFAULT = 1;
const ACCEPT_WINDOW_MS = 10 * 60000;
const STOP_GRACE_MS = 3 * 60000;
const DEFAULTS = {
  minDelayMinutes: 30,
  maxDelayMinutes: 120,
  assetTypes: [1, 3, 5],
  apps: []
};
const ALL_LOOT_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const APP_GAMES = {
  730: 'Counter-Strike 2',
  440: 'Team Fortress 2'
};
const ASSET_TYPES = {
  1: 'BoosterPack',
  2: 'Emoticon',
  3: 'FoilTradingCard',
  4: 'ProfileBackground',
  5: 'TradingCard',
  6: 'SteamGems',
  7: 'SaleItem',
  8: 'Consumable',
  9: 'ProfileModifier',
  10: 'Sticker',
  11: 'ChatEffect',
  12: 'MiniProfileBackground',
  13: 'AvatarProfileFrame',
  14: 'AnimatedAvatar',
  15: 'KeyboardSkin',
  16: 'StartupVideo'
};

function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function rand(min, max) {
  return min + Math.random() * Math.max(0, max - min);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function steamIdOf(bot) {
  if (!bot) return '';
  if (bot.s_SteamID && String(bot.s_SteamID) !== '0') return String(bot.s_SteamID);
  if (bot.SteamID !== undefined && bot.SteamID !== null && String(bot.SteamID) !== '0') return String(bot.SteamID);
  return '';
}

class StorageManager extends EventEmitter {
  constructor({ api, store, db, steamWeb, getAsfDir, isStandby, notifier, log }) {
    super();
    this.api = api;
    this.store = store;
    this.db = db;
    this.steamWeb = steamWeb;
    this.getAsfDir = getAsfDir;
    this.isStandby = isStandby || (() => false);
    this.notifier = notifier;
    this.log = log || (() => {});
    const saved = store.get('storage', {}) || {};
    this.accounts = {};
    for (const [name, flag] of Object.entries(saved.accounts || {})) {
      if (flag) this.accounts[name] = true;
    }
    this.cfg = {
      minDelayMinutes: clampInt(saved.minDelayMinutes, 1, 10080, DEFAULTS.minDelayMinutes),
      maxDelayMinutes: clampInt(saved.maxDelayMinutes, this.minOf(saved), 10080, DEFAULTS.maxDelayMinutes),
      assetTypes: Array.isArray(saved.assetTypes) && saved.assetTypes.length ? saved.assetTypes.filter((t) => ASSET_TYPES[t]) : [...DEFAULTS.assetTypes],
      apps: Array.isArray(saved.apps) ? saved.apps.map(Number).filter((a) => APP_GAMES[a]) : []
    };
    this.queue = store.get('storage-queue', []) || [];
    const session = store.get('storage-session', {}) || {};
    this.acceptingUntil = Number(session.acceptingUntil) || 0;
    this.pendingStops = session.pendingStops && typeof session.pendingStops === 'object' ? session.pendingStops : {};
    this.lastBots = {};
    this.running = false;
    this.recent = [];
    this.timer = null;
    this.manualActiveCheck = () => false;
  }

  setManualActiveCheck(fn) {
    this.manualActiveCheck = typeof fn === 'function' ? fn : () => false;
  }

  minOf(saved) {
    const n = parseInt(saved && saved.minDelayMinutes, 10);
    return Number.isFinite(n) ? n : 1;
  }

  start() {
    if (this.timer) return;
    this._normalizeStorageConfigs();
    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
    this.tick().catch(() => {});
  }

  // Make sure every storage account stays offline, never auto-farms and accepts donations.
  _normalizeStorageConfigs() {
    const asfDir = this.getAsfDir();
    for (const name of this.storageNames()) {
      const cfg = home.readBotConfig(asfDir, name);
      if (!cfg) continue;
      let changed = false;
      const tp = Number(cfg.TradingPreferences) || 0;
      if ((tp & TRADING_ACCEPT_DONATIONS) === 0) {
        cfg.TradingPreferences = tp | TRADING_ACCEPT_DONATIONS;
        changed = true;
      }
      const fp = Number(cfg.FarmingPreferences) || 0;
      if ((fp & FARMING_PAUSED_BY_DEFAULT) === 0) {
        cfg.FarmingPreferences = fp | FARMING_PAUSED_BY_DEFAULT;
        changed = true;
      }
      if (cfg.Enabled !== false) {
        cfg.Enabled = false;
        changed = true;
      }
      if (changed) {
        try {
          home.writeBotConfig(asfDir, name, cfg);
        } catch {
          /* ignore */
        }
      }
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isStorage(name) {
    return !!this.accounts[name];
  }

  storageNames() {
    return Object.keys(this.accounts);
  }

  _saveTradeLink(name, tradeLink) {
    try {
      const existing = this.db.one('SELECT name FROM bots WHERE name = ?', [name]);
      if (existing) {
        this.db.run('UPDATE bots SET trade_link = ? WHERE name = ?', [tradeLink, name]);
      } else {
        this.db.run('INSERT INTO bots (name, trade_link, first_seen, last_seen) VALUES (?, ?, ?, ?)', [name, tradeLink, Date.now(), Date.now()]);
      }
      this.db.scheduleSave();
    } catch {
      /* db optional */
    }
  }

  _tradeLinkOf(name) {
    try {
      const row = this.db.one('SELECT trade_link FROM bots WHERE name = ?', [name]);
      return (row && row.trade_link) || '';
    } catch {
      return '';
    }
  }

  _tradeTokenOf(name) {
    const link = this._tradeLinkOf(name);
    const m = String(link || '').match(/[?&]token=([A-Za-z0-9_-]+)/);
    return m ? m[1] : '';
  }

  getConfig() {
    return { ...this.cfg, assetTypes: [...this.cfg.assetTypes], apps: [...this.cfg.apps], accounts: this.storageNames() };
  }

  getFullState() {
    const bots = this.lastBots || {};
    const accounts = this.storageNames()
      .map((name) => {
        const bot = bots[name];
        const row = this.db.one('SELECT wallet_balance, wallet_currency FROM bots WHERE name = ?', [name]);
        return {
          name,
          steamID: bot ? steamIdOf(bot) || null : null,
          online: !!(bot && bot.IsConnectedAndLoggedOn),
          keepRunning: !!(bot && bot.KeepRunning),
          tradeLink: this._tradeLinkOf(name) || null,
          walletBalance: bot ? Number(bot.WalletBalance) || 0 : (row && row.wallet_balance) || 0,
          walletCurrency: bot ? Number(bot.WalletCurrency) || 0 : (row && row.wallet_currency) || 0
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      config: this.getConfig(),
      accounts,
      queue: this.queue.map((q) => ({ ...q })),
      running: this.running,
      accepting: this.acceptingUntil > Date.now(),
      acceptingUntil: this.acceptingUntil > Date.now() ? this.acceptingUntil : null,
      recent: this.recent.slice(-40).reverse()
    };
  }

  publish() {
    this.emit('state', this.getFullState());
  }

  setConfig(patch = {}) {
    const cfg = { ...this.cfg, ...patch };
    cfg.minDelayMinutes = clampInt(cfg.minDelayMinutes, 1, 10080, DEFAULTS.minDelayMinutes);
    cfg.maxDelayMinutes = clampInt(cfg.maxDelayMinutes, cfg.minDelayMinutes, 10080, Math.max(cfg.minDelayMinutes, DEFAULTS.maxDelayMinutes));
    if (Array.isArray(patch.assetTypes)) {
      cfg.assetTypes = patch.assetTypes.map((t) => Number(t)).filter((t) => ASSET_TYPES[t]);
    }
    if (Array.isArray(patch.apps)) {
      cfg.apps = patch.apps.map((a) => Number(a)).filter((a) => APP_GAMES[a]);
    }
    if (cfg.assetTypes.length === 0 && cfg.apps.length === 0) cfg.assetTypes = [...DEFAULTS.assetTypes];
    this.cfg = cfg;
    this._persistConfig();
    this._note(
      `Settings saved - delay ${cfg.minDelayMinutes}-${cfg.maxDelayMinutes} min between transfers, ${cfg.assetTypes.length} asset type(s), ${cfg.apps.length} game(s)`
    );
    this.publish();
    return this.getConfig();
  }

  async setAccounts(names) {
    const wanted = new Set((names || []).map(String));
    this.accounts = {};
    for (const n of wanted) this.accounts[n] = true;
    this._persistConfig();

    const asfDir = this.getAsfDir();
    for (const name of wanted) {
      const cfg = home.readBotConfig(asfDir, name);
      if (!cfg) continue;
      let changed = false;
      const tp = Number(cfg.TradingPreferences) || 0;
      if ((tp & TRADING_ACCEPT_DONATIONS) === 0) {
        cfg.TradingPreferences = tp | TRADING_ACCEPT_DONATIONS;
        changed = true;
      }
      // Storage accounts must never start card farming on their own.
      const fp = Number(cfg.FarmingPreferences) || 0;
      if ((fp & FARMING_PAUSED_BY_DEFAULT) === 0) {
        cfg.FarmingPreferences = fp | FARMING_PAUSED_BY_DEFAULT;
        changed = true;
      }
      if (cfg.Enabled !== false) {
        cfg.Enabled = false;
        changed = true;
      }
      if (changed) {
        try {
          home.writeBotConfig(asfDir, name, cfg);
          this._note(`${name} configured as storage account (accepts all incoming trades, farming paused, stays offline until needed)`);
        } catch (e) {
          this._note(`Failed to configure ${name}: ${e.message}`);
        }
      }
    }

    for (const entry of this.queue) {
      if (!this.accounts[entry.storage]) entry.storage = '';
    }
    this.queue = this.queue.filter((q) => q.storage);
    this._persistQueue();
    this._note(`Storage accounts updated: ${this.storageNames().join(', ') || '(none)'}`);
    this.publish();
    return this.getConfig();
  }

  setTradeLink(name, tradeLink) {
    const link = String(tradeLink || '').trim();
    const m = link.match(/[?&]token=([A-Za-z0-9_-]+)/);
    if (!m) throw new Error('Invalid trade link - it must be a Steam trade offer URL containing a token');
    this._saveTradeLink(name, link);
    if (!this.accounts[name]) {
      this.accounts[name] = true;
      this._persistConfig();
    }
    this._note(`${name}: trade link saved to the database - transfers will be delivered to this trade link`);
    this.publish();
    return { ok: true, tradeLink: link };
  }

  async queueTransfers() {
    const storages = this.storageNames();
    if (storages.length === 0) throw new Error('No storage accounts selected');

    let bots;
    try {
      bots = (await this.api.getBots()) || {};
    } catch (e) {
      throw new Error(`ASF IPC unreachable: ${e.message}`);
    }
    this.lastBots = bots;

  const sources = Object.keys(bots)
    .filter((n) => !this.accounts[n])
    .filter((n) => bots[n].IsConnectedAndLoggedOn || bots[n].KeepRunning === true)
    .sort((a, b) => a.localeCompare(b));
    if (sources.length === 0) throw new Error('No active bots found to transfer items from');

    const now = Date.now();
    let nextAt = now;
    this.queue = sources.map((bot) => {
      const entry = { bot, storage: pickRandom(storages), nextAt };
      nextAt += Math.round(rand(this.cfg.minDelayMinutes, this.cfg.maxDelayMinutes) * 60000);
      return entry;
    });
    this._persistQueue();
    this._note(
      `Transfer scheduled - ${this.queue.length} bot(s) distributed randomly across ${storages.length} storage account(s), spread over the next hours (first transfer starts now)`
    );
    this.publish();
    return this.queue.length;
  }

  async acceptTrades() {
    const storages = this.storageNames();
    if (storages.length === 0) throw new Error('No storage accounts selected');
    this.acceptingUntil = Date.now() + ACCEPT_WINDOW_MS;
    this._persistSession();
    try {
      await this.api.startBots(storages);
    } catch {
      /* tick keeps retrying */
    }
    this._note(`Accept trades started - ${storages.join(', ')} online for ${Math.round(ACCEPT_WINDOW_MS / 60000)} minutes (2FA confirmations via .maFile are automatic)`);
    this.publish();
    return { acceptingUntil: this.acceptingUntil };
  }

  cancelTransfers() {
    const count = this.queue.length;
    this.queue = [];
    this._persistQueue();
    if (count > 0) this._note(`Transfer schedule cancelled (${count} pending transfer(s) removed)`);
    this.publish();
    return count;
  }

  async tick() {
    try {
      await this._processAccepting();
    } catch {
      /* ASF offline */
    }
    try {
      await this._processStops();
    } catch {
      /* ASF offline */
    }

    if (this.running || this.queue.length === 0) {
      this.publish();
      return;
    }
    if (this.isStandby()) {
      this.publish();
      return;
    }
    const next = this.queue[0];
    if (Date.now() < next.nextAt) {
      this.publish();
      return;
    }
    await this._runStep();
  }

  async _processAccepting() {
    if (!this.acceptingUntil) return;
    const names = this.storageNames();
    if (Date.now() >= this.acceptingUntil || names.length === 0) {
      this.acceptingUntil = 0;
      this._persistSession();
      if (names.length > 0) {
        try {
          await this.api.stopBots(names);
        } catch {
          /* ignore */
        }
        this._note('Accept trades window ended - storage accounts are back offline');
        for (const name of names) {
          this._record({ bot: name, storage: name, ok: true, kind: 'accept', detail: 'Incoming trades accepted, account stopped again' });
        }
      }
      this.publish();
      return;
    }
    let bots;
    try {
      bots = await this.api.getBots();
    } catch {
      return;
    }
    this.lastBots = bots || {};
    for (const name of names) {
      const bot = bots && bots[name];
      if (!bot) continue;
      if (!bot.KeepRunning && !bot.IsConnectedAndLoggedOn) {
        try {
          await this.api.startBots([name]);
        } catch {
          /* retry next tick */
        }
      }
    }
  }

  async _processStops() {
    const now = Date.now();
    const due = Object.keys(this.pendingStops).filter((n) => this.pendingStops[n] <= now);
    if (due.length === 0) return;
    for (const n of due) delete this.pendingStops[n];
    this._persistSession();
    if (this.acceptingUntil > now) return;
    // Never stop a storage account the user started manually - it stays online until stopped by hand.
    const toStop = due.filter((n) => !this.manualActiveCheck(n));
    if (toStop.length === 0) return;
    try {
      await this.api.stopBots(toStop);
      this._note(`Storage account(s) ${toStop.join(', ')} stopped - back offline after the transfer grace period`);
    } catch {
      /* retry next tick */
    }
  }

  _scheduleStop(name, delayMs = STOP_GRACE_MS) {
    const at = Date.now() + delayMs;
    if (!this.pendingStops[name] || this.pendingStops[name] < at) {
      this.pendingStops[name] = at;
      this._persistSession();
    }
  }

  async _runStep() {
    const entry = this.queue[0];
    this.running = true;
    this.publish();

    let ok = false;
    let detail = '';
    try {
      const bots = (await this.api.getBots()) || {};
      this.lastBots = bots;
      const source = bots[entry.bot];
      const storageBot = bots[entry.storage];
      if (!source) {
        detail = 'Source bot no longer exists';
      } else if (!storageBot) {
        detail = 'Storage bot no longer exists';
      } else if (!source.IsConnectedAndLoggedOn) {
        // The source must be connected to send the trade. Defer instead of failing.
        entry.nextAt = Date.now() + 2 * 60000;
        this.queue.push(this.queue.shift());
        this._persistQueue();
        this._note(`${entry.bot} is not connected right now - transfer postponed 2 minutes`);
        this.running = false;
        this.publish();
        return;
      } else {
        let storageID = steamIdOf(storageBot);
        if (!storageID || storageID === '0') {
          const row = this.db.one('SELECT steam_id FROM bots WHERE name = ?', [entry.storage]);
          storageID = (row && row.steam_id) || '';
        }
        if (!storageID || storageID === '0') {
          entry.nextAt = Date.now() + 10 * 60000;
          this.queue.push(this.queue.shift());
          this._persistQueue();
          this._note(`${entry.storage} has no known SteamID yet - transfer of ${entry.bot} postponed 10 minutes`);
          this.running = false;
          this.publish();
          return;
        }

        const asfDir = this.getAsfDir();
        const cfg = home.readBotConfig(asfDir, entry.bot);
        const storageTradeToken = this._tradeTokenOf(entry.storage);
        if (cfg) {
          if (this._applyStoragePermissions(cfg, storageID, entry.bot, storageTradeToken)) {
            home.writeBotConfig(asfDir, entry.bot, cfg);
            this._note(`${entry.bot}: storage ${entry.storage} set as Master transfer target`);
            await sleep(2000);
          }
          const wantedTypes =
            this.cfg.apps.length > 0
              ? [...ALL_LOOT_TYPES]
              : [...this.cfg.assetTypes].sort((a, b) => a - b);
          const currentTypes = [...(cfg.LootableTypes || [])].map(Number).sort((a, b) => a - b);
          if (JSON.stringify(wantedTypes) !== JSON.stringify(currentTypes)) {
            cfg.LootableTypes = wantedTypes;
            home.writeBotConfig(asfDir, entry.bot, cfg);
            this._note(
              this.cfg.apps.length > 0
                ? `${entry.bot}: game transfer selected - LootableTypes expanded to all types for the transfer`
                : `${entry.bot}: LootableTypes set to [${wantedTypes.join(', ')}] for the transfer`
            );
            await sleep(2000);
          }
        }

        const result = await this.api.command(`loot ${entry.bot}`);
        detail = typeof result === 'string' ? result.trim() : JSON.stringify(result);
        // If the source disconnected between the check and the loot, re-queue the transfer.
        if (/(not connected|non.{0,25}conness)/i.test(detail)) {
          entry.nextAt = Date.now() + 2 * 60000;
          this.queue.push(this.queue.shift());
          this._persistQueue();
          this._note(`${entry.bot} disconnected while transferring - postponed 2 minutes`);
          this.running = false;
          this.publish();
          return;
        }
        // ASF replies with a localized message; detect the common failure patterns so a failed
        // transfer is not reported (and notified) as a success.
        const failRe = /(is not running|non.{0,25}esecuzione|failed|failed|invalid|invalid|error|error)/i;
        ok = !failRe.test(detail);
        if (ok) {
          this._note(`Transferred items from ${entry.bot} -> ${entry.storage}${detail ? `: ${detail}` : ''}. Press "Accept trades" so ${entry.storage} comes online to accept them.`);
          if (this.notifier) this.notifier.notify('storage', `Items transferred from ${entry.bot} to storage ${entry.storage} - press "Accept trades" to accept them`);
        } else {
          this._note(`Transfer of ${entry.bot} failed: ${detail}`);
        }
      }
    } catch (e) {
      detail = e.message;
      ok = false;
      this._note(`Transfer of ${entry.bot} failed: ${e.message}`);
    }

    this.queue.shift();
    if (this.queue.length > 0) {
      this.queue[0].nextAt = Date.now() + Math.round(rand(this.cfg.minDelayMinutes, this.cfg.maxDelayMinutes) * 60000);
    }
    this._persistQueue();
    this._record({ bot: entry.bot, storage: entry.storage, ok, kind: 'transfer', detail });
    this.running = false;
    this.publish();
  }

  _record({ bot, storage, ok, kind = 'transfer', detail = '' }) {
    this.recent.push({ at: Date.now(), bot, storage, ok, kind, detail: String(detail || '').slice(0, 300) });
    if (this.recent.length > 80) this.recent.splice(0, this.recent.length - 80);
    try {
      this.db.run('INSERT INTO transfer_log (bot, storage, status, detail, ts) VALUES (?, ?, ?, ?, ?)', [
        bot,
        storage,
        ok ? 'ok' : 'error',
        String(detail || '').slice(0, 500),
        Date.now()
      ]);
      this.db.scheduleSave();
    } catch {
      /* db optional */
    }
  }

  _applyStoragePermissions(cfg, storageID, botName, tradeToken) {
    const perms = { ...(cfg.SteamUserPermissions || {}) };
    let changed = false;
    for (const [sid, access] of Object.entries(perms)) {
      if (sid !== storageID && Number(access) === E_ACCESS.MASTER) {
        perms[sid] = E_ACCESS.OPERATOR;
        changed = true;
        this._note(`${botName}: existing master ${sid} demoted to Operator so loot targets the storage account`);
      }
    }
    if (Number(perms[storageID]) !== E_ACCESS.MASTER) {
      perms[storageID] = E_ACCESS.MASTER;
      changed = true;
    }
    cfg.SteamUserPermissions = perms;
    if (tradeToken && cfg.SteamTradeToken !== tradeToken) {
      cfg.SteamTradeToken = tradeToken;
      changed = true;
      this._note(`${botName}: SteamTradeToken set so the loot is delivered to the storage trade link`);
    }
    return changed;
  }

  _persistConfig() {
    this.store.set('storage', { accounts: { ...this.accounts }, ...this.cfg });
  }

  _persistQueue() {
    this.store.set('storage-queue', this.queue);
  }

  _persistSession() {
    this.store.set('storage-session', { acceptingUntil: this.acceptingUntil, pendingStops: this.pendingStops });
  }

  _note(msg) {
    const line = `[Storage] ${msg}`;
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { StorageManager, ASSET_TYPES };
