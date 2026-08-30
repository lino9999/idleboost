const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { isNewerVersion } = require('./updater');

const RELEASE_API = 'https://api.github.com/repos/lino9999/idleboost/releases/latest';
const RELEASES_URL = 'https://github.com/lino9999/idleboost/releases';
const CHECK_INTERVAL_MS = 6 * 3600000;
const FIRST_CHECK_DELAY_MS = 15000;

class AppUpdater extends EventEmitter {
  constructor({ getVersion, downloadDir, log }) {
    super();
    this.getVersion = getVersion || (() => '0.0.0');
    this.downloadDir = downloadDir;
    this.log = log || (() => {});
    this.state = {
      status: 'idle',
      version: null,
      assetUrl: null,
      assetName: null,
      releaseUrl: RELEASES_URL,
      progress: 0,
      error: null
    };
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkNow().catch(() => {}), CHECK_INTERVAL_MS);
    setTimeout(() => this.checkNow().catch(() => {}), FIRST_CHECK_DELAY_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getState() {
    return { ...this.state, currentVersion: this.getVersion() };
  }

  _setState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.getState());
  }

  async checkNow() {
    if (this.state.status === 'downloading') return this.getState();
    this._setState({ status: 'checking', error: null });
    try {
      const res = await fetch(RELEASE_API, {
        headers: { 'User-Agent': 'IdleBoost', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);
      const rel = await res.json();
      const releaseUrl = rel.html_url || RELEASES_URL;
      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      const asset = assets.find((a) => /IdleBoost[-_ ]?\d.*-Portable\.exe$/i.test(String(a.name || '')));
      let version = null;
      if (asset) {
        const m = String(asset.name).match(/IdleBoost[-_ ]?(\d+(?:\.\d+)*)\s*-\s*Portable/i);
        if (m) version = m[1];
      }
      if (!version) {
        const tagMatch = String(rel.tag_name || rel.name || '').match(/(\d+(?:\.\d+)+)/);
        if (tagMatch) version = tagMatch[1];
      }
      if (!version || !isNewerVersion(version, this.getVersion())) {
        this._setState({ status: 'idle' });
        return this.getState();
      }
      this._setState({
        status: 'available',
        version,
        assetUrl: asset ? asset.browser_download_url : null,
        assetName: asset ? asset.name : null,
        releaseUrl,
        progress: 0
      });
      this.log(`New IdleBoost version detected on GitHub: v${version} (current ${this.getVersion()})`);
      return this.getState();
    } catch (e) {
      this._setState({ status: 'idle', error: e.message });
      return this.getState();
    }
  }

  async install() {
    if (this.state.status === 'downloading') return this.getState();
    if (!this.state.assetUrl) {
      return { ...this.getState(), openExternal: this.state.releaseUrl };
    }
    this._setState({ status: 'downloading', progress: 0, error: null });
    this.log(`Downloading IdleBoost v${this.state.version} from GitHub...`);
    try {
      fs.mkdirSync(this.downloadDir, { recursive: true });
      const tmpPath = path.join(this.downloadDir, `${this.state.assetName}.part`);
      const res = await fetch(this.state.assetUrl, {
        headers: { 'User-Agent': 'IdleBoost' },
        signal: AbortSignal.timeout(30 * 60000)
      });
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      const total = Number(res.headers.get('content-length')) || 0;
      let received = 0;
      let lastEmit = 0;
      const out = fs.createWriteStream(tmpPath);
      try {
        for await (const chunk of res.body) {
          out.write(chunk);
          received += chunk.length;
          const now = Date.now();
          if (now - lastEmit > 500) {
            lastEmit = now;
            this._setState({ progress: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : -1 });
          }
        }
      } finally {
        await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      }
      const dest = path.join(this.downloadDir, this.state.assetName);
      if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
      fs.renameSync(tmpPath, dest);
      this._setState({ status: 'downloaded', progress: 100 });
      this.log(`IdleBoost v${this.state.version} downloaded - applying update...`);
      this.emit('downloaded', { filePath: dest, assetName: this.state.assetName, version: this.state.version });
      return this.getState();
    } catch (e) {
      this._setState({ status: 'error', error: e.message });
      this.log(`Update download failed: ${e.message}`);
      return this.getState();
    }
  }
}

module.exports = { AppUpdater };
