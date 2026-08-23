const { EventEmitter } = require('events');

const TICK_MS = 30000;
const HEAVY_INTERVAL_MS = 30 * 60 * 1000;
const HEAVY_RATE_MS = 60000;
const RATE_LIMIT_BACKOFF_MS = 10 * 60000;
const SNAPSHOT_MAX_AGE_MS = 12 * 3600000;

function steamIdOf(bot) {
  if (!bot) return '';
  if (bot.s_SteamID && String(bot.s_SteamID) !== '0') return String(bot.s_SteamID);
  if (bot.SteamID !== undefined && bot.SteamID !== null && String(bot.SteamID) !== '0') return String(bot.SteamID);
  return '';
}

function proxyGroupOf(bot) {
  const proxy = bot && bot.BotConfig ? bot.BotConfig.WebProxy : null;
  return proxy ? String(proxy) : 'host';
}

class DataSync extends EventEmitter {
  constructor({ api, db, store, isStandby, isStorageBot, notifier, log }) {
    super();
    this.api = api;
    this.db = db;
    this.store = store;
    this.isStandby = isStandby || (() => false);
    this.isStorageBot = isStorageBot || (() => false);
    this.notifier = notifier;
    this.log = log || (() => {});
    const saved = store.get('datasync', {}) || {};
    this.lastSyncAt = Number(saved.lastSyncAt) || 0;
    this.timer = null;
    this.syncing = false;
    this.processing = false;
    this.pendingSnapshots = 0;
    this.connectedSeen = new Set();
    this.lastHeavyAt = {};
    this.groupLastSync = {};
    this.heavyQueue = [];
    this.backoffUntil = 0;
    this.lastResult = saved.lastResult || null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick().catch(() => {}), TICK_MS);
    this._tick().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getConfig() {
    return { heavyIntervalMs: HEAVY_INTERVAL_MS, rateLimitMs: HEAVY_RATE_MS };
  }

  getState() {
    return {
      syncing: this.syncing,
      lastSyncAt: this.lastSyncAt,
      lastResult: this.lastResult,
      pending: this.heavyQueue.length
    };
  }

  async _tick() {
    await this._collect(false);
  }

  async _collect(manual) {
    if (this.isStandby()) return;
    let bots;
    try {
      bots = (await this.api.getBots()) || {};
    } catch {
      return;
    }
    const now = Date.now();
    let upserted = 0;
    for (const [name, bot] of Object.entries(bots)) {
      try {
        this._upsertBot(name, bot, now);
        upserted += 1;
      } catch (e) {
        this._note(`Bot record failed for ${name}: ${e.message}`);
      }
    }
    this.pendingSnapshots = 0;
    this.lastResult = { bots: upserted, games: 0, inventoryApps: 0, errors: 0 };
    this.lastSyncAt = now;
    this.store.set('datasync', { lastSyncAt: this.lastSyncAt, lastResult: this.lastResult });
    this.db.scheduleSave();
    this.publish();
    // Note: periodic Steam-inventory polling has been removed on purpose. It generated
    // continuous https://steamcommunity.com/my/inventory + market/eligibilitycheck requests
    // that Steam rate-limited (TooManyRequests). Inventories are now fetched only on demand
    // from the Database view ("Live refresh").
  }

  async sync(manual = true) {
    if (this.isStandby()) {
      this._note('Standby active - data sync skipped');
      return { skipped: true };
    }
    await this._collect(!!manual);
    return this.lastResult || { skipped: true };
  }

  _upsertBot(name, bot, now) {
    const cfg = bot.BotConfig || {};
    const info = bot.AccountInfo || {};
    const isConnected = !!bot.IsConnectedAndLoggedOn;
    const existing = this.db.one('SELECT * FROM bots WHERE name = ?', [name]);

    let balance = Number(bot.WalletBalance);
    if (!Number.isFinite(balance) || balance <= 0) {
      const alt = Number(info.WalletBalance);
      if (Number.isFinite(alt) && alt > 0) balance = alt;
    }
    let currency = Number(bot.WalletCurrency);
    if (!Number.isFinite(currency) || currency <= 0) {
      const alt = Number(info.WalletCurrency);
      if (Number.isFinite(alt) && alt > 0) currency = alt;
    }
    // Keep the last known wallet when ASF reports nothing (bot offline), so the stored value persists.
    if ((!Number.isFinite(balance) || balance <= 0) && existing && Number(existing.wallet_balance) > 0) {
      balance = Number(existing.wallet_balance);
      if ((!Number.isFinite(currency) || currency <= 0) && Number(existing.wallet_currency) > 0) {
        currency = Number(existing.wallet_currency);
      }
    }
    balance = Number.isFinite(balance) && balance > 0 ? balance : 0;
    currency = Number.isFinite(currency) && currency > 0 ? currency : 0;

    // Total remaining card drops reported by ASF's card farmer (live data).
    let cardsLeft = 0;
    const farmer = bot.CardsFarmer;
    if (farmer) {
      const gamesToFarm = farmer.GamesToFarm || farmer.gamesToFarm || [];
      for (const g of gamesToFarm) {
        const c = Number(g.CardsRemaining !== undefined ? g.CardsRemaining : g.cards_remaining);
        if (Number.isFinite(c) && c > 0) cardsLeft += c;
      }
    }

    const avatarHash = bot.AvatarHash || (info && info.AvatarHash) || '';
    const avatarUrl = avatarHash && String(avatarHash).length >= 8 ? `https://avatars.steamstatic.com/${avatarHash}_medium.jpg` : '';
    if (existing) {
      this.db.run(
        `UPDATE bots SET steam_login = ?, steam_id = ?, nickname = ?, wallet_balance = ?, wallet_currency = ?, cards_left = ?, is_storage = ?, avatar_url = ?, last_seen = ? WHERE name = ?`,
        [
          String(cfg.SteamLogin || existing.steam_login || ''),
          steamIdOf(bot) || existing.steam_id || '',
          String(bot.Nickname || existing.nickname || ''),
          balance,
          currency,
          isConnected || cardsLeft > 0 ? cardsLeft : Number(existing.cards_left) || 0,
          this.isStorageBot(name) ? 1 : 0,
          avatarUrl || existing.avatar_url || '',
          now,
          name
        ]
      );
    } else {
      this.db.run(
        `INSERT INTO bots (name, steam_login, steam_id, nickname, wallet_balance, wallet_currency, cards_left, is_storage, avatar_url, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          String(cfg.SteamLogin || ''),
          steamIdOf(bot),
          String(bot.Nickname || ''),
          balance,
          currency,
          cardsLeft,
          this.isStorageBot(name) ? 1 : 0,
          avatarUrl,
          now,
          now
        ]
      );
    }

    // Only record a wallet snapshot when the bot is actually online (a 0 from an offline bot is not a real balance change).
    if (isConnected || balance > 0) {
      const last = this.db.one('SELECT balance, currency, ts FROM wallet_snapshots WHERE bot = ? ORDER BY ts DESC LIMIT 1', [name]);
      if (!last || last.balance !== balance || last.currency !== currency || now - Number(last.ts) >= SNAPSHOT_MAX_AGE_MS) {
        this.db.run('INSERT INTO wallet_snapshots (bot, balance, currency, ts) VALUES (?, ?, ?, ?)', [name, balance, currency, now]);
        this.pendingSnapshots = (this.pendingSnapshots || 0) + 1;
      }
    }
  }

  publish() {
    this.emit('state', this.getState());
  }

  _note(msg) {
    const line = `[DataSync] ${msg}`;
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { DataSync };
