const { EventEmitter } = require('events');

const TICK_MS = 45000;

class CardWatcher extends EventEmitter {
  constructor({ api, isStandby, notifier, log }) {
    super();
    this.api = api;
    this.isStandby = isStandby || (() => false);
    this.notifier = notifier;
    this.log = log || (() => {});
    this.remainingByBot = {};
    this.recent = [];
    this.timer = null;
    this.lastCheckAt = 0;
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

  getState() {
    return { lastCheckAt: this.lastCheckAt, recent: this.recent.slice(-30).reverse() };
  }

  _remainingOf(bot) {
    const farmer = bot && bot.CardsFarmer;
    if (!farmer) return null;
    const games = farmer.GamesToFarm || farmer.gamesToFarm || [];
    if (!Array.isArray(games) || games.length === 0) return null;
    let total = 0;
    for (const g of games) {
      const cards = Number(g.CardsRemaining !== undefined ? g.CardsRemaining : g.cards_remaining);
      if (Number.isFinite(cards) && cards > 0) total += cards;
    }
    return total;
  }

  async tick() {
    if (this.isStandby()) return;
    let bots;
    try {
      bots = (await this.api.getBots()) || {};
    } catch {
      return;
    }
    this.lastCheckAt = Date.now();
    for (const [name, bot] of Object.entries(bots)) {
      const connected = !!(bot && bot.IsConnectedAndLoggedOn);
      const remaining = connected ? this._remainingOf(bot) : null;
      const prev = this.remainingByBot[name];

      if (!connected || remaining === null) {
        delete this.remainingByBot[name];
        continue;
      }
      if (prev === undefined) {
        this.remainingByBot[name] = remaining;
        continue;
      }
      if (remaining < prev) {
        const dropped = prev - remaining;
        this.remainingByBot[name] = remaining;
        const line = `${name} received ${dropped} Steam trading card${dropped > 1 ? 's' : ''} (${remaining} drop${remaining === 1 ? '' : 's'} left)`;
        this._note(line);
        this.recent.push({ at: Date.now(), bot: name, dropped, remaining });
        if (this.recent.length > 60) this.recent.splice(0, this.recent.length - 60);
        if (this.notifier) this.notifier.notify('cards', line);
        this.emit('state', this.getState());
      } else if (remaining > prev) {
        this.remainingByBot[name] = remaining;
      }
    }
  }

  _note(msg) {
    const line = `[Cards] ${msg}`;
    this.log(line);
    this.emit('log', { line });
  }
}

module.exports = { CardWatcher };
