class AsfApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'AsfApiError';
    this.status = status;
  }
}

const ASF_ALL = 'ASF';

function encodeNames(names) {
  if (Array.isArray(names)) {
    return names.map((n) => encodeURIComponent(String(n))).join(',');
  }
  return encodeURIComponent(String(names));
}

class AsfApi {
  constructor(getSettings) {
    this.getSettings = getSettings;
  }

  get base() {
    const s = this.getSettings() || {};
    return (s.ipcUrl || 'http://127.0.0.1:1242').replace(/\/+$/, '');
  }

  async request(method, apiPath, body, timeoutMs = 15000) {
    const headers = { 'Content-Type': 'application/json' };
    const s = this.getSettings() || {};
    if (s.ipcPassword) headers['Authentication'] = String(s.ipcPassword);

    let res;
    try {
      res = await fetch(this.base + apiPath, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      throw new AsfApiError(`ASF IPC unreachable at ${this.base} (${err.message})`);
    }

    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (!res.ok) {
      const msg = json && json.Message ? json.Message : `ASF IPC returned HTTP ${res.status}`;
      throw new AsfApiError(msg, res.status);
    }
    if (json && json.Success === false) {
      throw new AsfApiError(json.Message || 'ASF reported a failure', res.status);
    }
    return json ? json.Result : null;
  }

  getAsf() {
    return this.request('GET', '/Api/ASF');
  }

  getBots() {
    return this.request('GET', `/Api/Bot/${ASF_ALL}`);
  }

  getBot(name) {
    return this.request('GET', `/Api/Bot/${encodeNames([name])}`);
  }

  async setBotEnabled(name, enabled) {
    const res = await this.getBot(name);
    const bot = res && res[name];
    if (!bot || !bot.BotConfig) throw new AsfApiError(`Bot not found: ${name}`);
    const cfg = { ...bot.BotConfig, Enabled: !!enabled };
    return this.request('POST', `/Api/Bot/${encodeURIComponent(String(name))}`, { BotConfig: cfg });
  }

  async setManyBotsEnabled(names, enabled) {
    const results = [];
    for (const name of names) {
      try {
        await this.setBotEnabled(name, enabled);
        results.push({ name, ok: true });
      } catch (e) {
        results.push({ name, ok: false, error: e.message });
      }
    }
    return results;
  }

  startBots(names) {
    return this.request('POST', `/Api/Bot/${encodeNames(names)}/Start`);
  }

  stopBots(names) {
    return this.request('POST', `/Api/Bot/${encodeNames(names)}/Stop`);
  }

  pauseBots(names, permanent = false) {
    return this.request(
      'POST',
      `/Api/Bot/${encodeNames(names)}/Pause?permanent=${permanent ? 'true' : 'false'}`
    );
  }

  resumeBots(names) {
    return this.request('POST', `/Api/Bot/${encodeNames(names)}/Resume`);
  }

  saveBots(configsByName) {
    const tasks = [];
    for (const [name, config] of Object.entries(configsByName || {})) {
      tasks.push(this.request('POST', `/Api/Bot/${encodeURIComponent(String(name))}`, config));
    }
    return Promise.all(tasks);
  }

  deleteBots(names) {
    return this.request('DELETE', `/Api/Bot/${encodeNames(names)}`);
  }

  get2faToken(names) {
    return this.request('GET', `/Api/Bot/${encodeNames(names)}/TwoFactorAuthentication/Token`);
  }

  getPendingConfirmations(names) {
    return this.request('GET', `/Api/Bot/${encodeNames(names)}/TwoFactorAuthentication/Confirmations`);
  }

  getPlugins() {
    return this.request('GET', '/Api/Plugins');
  }

  updatePlugins(requestBody) {
    return this.request('POST', '/Api/Plugins/Update', requestBody || {}, 120000);
  }

  updateAsf(requestBody) {
    return this.request('POST', '/Api/ASF/Update', requestBody || {}, 120000);
  }

  getLatestRelease() {
    return this.request('GET', '/Api/WWW/GitHub/Release');
  }

  getRelease(version) {
    return this.request('GET', `/Api/WWW/GitHub/Release/${encodeURIComponent(String(version))}`);
  }

  command(command) {
    return this.request('POST', '/Api/Command', { Command: String(command) }, 90000);
  }
}

module.exports = { AsfApi, AsfApiError };
