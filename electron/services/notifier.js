const { EventEmitter } = require('events');

const EVENT_TYPES = ['warming', 'redemption', 'profile', 'storage', 'cards', 'ban', 'update'];

class Notifier extends EventEmitter {
  constructor({ store, log }) {
    super();
    this.store = store;
    this.log = log || (() => {});
    const saved = store.get('webhook', {}) || {};
    this.cfg = {
      url: typeof saved.url === 'string' ? saved.url : '',
      events: { ...defaultEvents(), ...(saved.events || {}) }
    };
    this.recent = [];
  }

  getConfig() {
    return { url: this.cfg.url, events: { ...this.cfg.events } };
  }

  getState() {
    return { config: this.getConfig(), recent: this.recent.slice(-30).reverse() };
  }

  setConfig(patch = {}) {
    const cfg = { ...this.cfg };
    if (patch.url !== undefined) cfg.url = String(patch.url || '').trim();
    if (patch.events && typeof patch.events === 'object') cfg.events = { ...cfg.events, ...patch.events };
    for (const k of Object.keys(cfg.events)) {
      if (!EVENT_TYPES.includes(k)) delete cfg.events[k];
      else cfg.events[k] = !!cfg.events[k];
    }
    this.cfg = cfg;
    this.store.set('webhook', { url: cfg.url, events: cfg.events });
    this.publish();
    return this.getConfig();
  }

  async notify(type, text) {
    if (!EVENT_TYPES.includes(type)) return;
    if (!this.cfg.url || !this.cfg.events[type]) return;
    const line = String(text || '').slice(0, 900);
    this.recent.push({ at: Date.now(), type, line });
    if (this.recent.length > 60) this.recent.splice(0, this.recent.length - 60);
    this.publish();
    this.log(`[Webhook] Sending "${type}" notification`);
    try {
      await fetch(this.cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: line }),
        signal: AbortSignal.timeout(10000)
      });
    } catch (e) {
      this.log(`[Webhook] Discord notification failed: ${e.message}`);
    }
  }

  publish() {
    this.emit('state', this.getState());
  }
}

function defaultEvents() {
  const out = {};
  for (const t of EVENT_TYPES) out[t] = true;
  return out;
}

module.exports = { Notifier, EVENT_TYPES };
