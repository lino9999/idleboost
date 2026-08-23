const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const ANSI_RE = new RegExp(
  [
    /\x1b\[[0-9;?]*[ -/]*[@-~]/.source,
    /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/.source,
    /\x1b[()][0-9A-Za-z]/.source,
    /\x1b[@-Z\\-_]/.source,
    /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x07]/.source
  ].join('|'),
  'g'
);

const STANDBY_PATTERNS = [
  /steam\s+(servers?\s+)?(are|is)\s+(currently\s+)?(down|unavailable)/i,
  /steam[^\n]{0,60}undergoing[^\n]{0,40}maintenance/i,
  /undergoing\s+(routine\s+)?maintenance/i,
  /unable\s+to\s+connect\s+to\s+steam/i,
  /could\s+not\s+connect\s+to\s+steam/i,
  /connection\s+to\s+(the\s+)?steam\s+(network|servers?)[^\n]{0,40}(lost|unavailable|down)/i,
  /steam\s+network\s+(is\s+)?(down|unavailable|unreachable)/i
];

const RECOVERY_PATTERNS = [
  /logged\s+on!/i,
  /connected\s+to\s+steam/i,
  /connection\s+to\s+(the\s+)?steam\s+(network|servers?)[^\n]{0,40}restored/i
];

const CONNECTIVITY_FAILS_FOR_STANDBY = 5;
const CONNECTIVITY_STANDBY_MAX_MS = 20 * 60000;

class AsfManager extends EventEmitter {
  constructor({ exe, homeDir }) {
    super();
    this.exe = exe;
    this.homeDir = homeDir;
    this.proc = null;
    this.running = false;
    this.intentional = false;
    this.quitting = false;
    this.restarts = 0;
    this.lastExitCode = null;
    this.startedAt = 0;
    this.backoffMs = 3000;
    this.restartTimer = null;
    this.standby = false;
    this.standbyReason = null;
    this.standbySource = null;
    this.standbySince = 0;
    this.connFails = 0;
  }

  start() {
    if (this.running || this.restartTimer) return;
    this.intentional = false;
    this._spawn();
  }

  stop() {
    this.intentional = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this._kill();
  }

  restart() {
    this.stop();
    this.intentional = false;
    this._spawn();
  }

  prepareForQuit() {
    this.quitting = true;
    this.stop();
  }

  _spawn() {
    if (!fs.existsSync(this.exe)) {
      this.emit('log', { line: `[Steam Warming UP] ASF executable not found at: ${this.exe}`, stream: 'stderr' });
      return;
    }

    let proc;
    try {
      proc = spawn(this.exe, ['--path', this.homeDir], {
        cwd: this.homeDir,
        windowsHide: true
      });
    } catch (err) {
      this.emit('log', { line: `[Steam Warming UP] Failed to spawn ASF: ${err.message}`, stream: 'stderr' });
      this._scheduleRestart();
      return;
    }

    this.proc = proc;
    this.running = true;
    this.startedAt = Date.now();
    this.emit('status', this.getStatus());
    this.emit('log', {
      line: `[Steam Warming UP] Launching ArchiSteamFarm (PID ${proc.pid}) home: ${this.homeDir}`,
      stream: 'system'
    });

    for (const streamName of ['stdout', 'stderr']) {
      const rl = readline.createInterface({ input: proc[streamName] });
      rl.on('line', (l) => this._onLine(l, streamName));
    }

    proc.on('error', (err) => {
      this.emit('log', { line: `[Steam Warming UP] ASF process error: ${err.message}`, stream: 'stderr' });
      this.running = false;
      this.proc = null;
      this._scheduleRestart();
    });

    proc.on('exit', (code, signal) => {
      this.running = false;
      this.lastExitCode = code;
      this.proc = null;
      this.emit('status', this.getStatus());
      this.emit('log', {
        line: `[Steam Warming UP] ASF exited (code: ${code}, signal: ${signal})`,
        stream: 'system'
      });
      if (!this.intentional && !this.quitting) {
        this.restarts += 1;
        const uptimeMs = Date.now() - this.startedAt;
        this.backoffMs = uptimeMs > 60000 ? 3000 : Math.min(this.backoffMs * 2, 60000);
        this.emit('log', {
          line: `[Steam Warming UP] Unexpected exit detected - auto-restarting ASF in ${Math.round(this.backoffMs / 1000)}s`,
          stream: 'system'
        });
        this._scheduleRestart();
      }
    });
  }

  _scheduleRestart() {
    if (this.intentional || this.quitting || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.intentional && !this.quitting) this._spawn();
    }, this.backoffMs);
  }

  _kill() {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    this.running = false;
    try {
      if (process.platform === 'win32' && proc.pid) {
        spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
      } else {
        proc.kill('SIGTERM');
      }
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    this.emit('status', this.getStatus());
  }

  _onLine(raw, stream) {
    let line = raw.replace(ANSI_RE, '').replace(/\uFEFF/g, '');
    if (line.includes('\r')) {
      const tail = line.slice(line.lastIndexOf('\r') + 1);
      line = tail.trim() ? tail : line.replace(/\r/g, '');
    }
    line = line.replace(/\s+$/, '');
    if (!line) return;
    this.emit('log', { line, stream });

    if (this.standby && RECOVERY_PATTERNS.some((re) => re.test(line))) {
      this._setStandby(false, null);
    } else if (!this.standby && STANDBY_PATTERNS.some((re) => re.test(line))) {
      this._setStandby(true, 'ASF logs indicate Steam is down or under maintenance', 'log');
    }
  }

  noteConnectivity({ reachable, botCount = 0, enabledCount = 0, connectedCount = 0, pendingInputCount = 0 }) {
    if (this.standby) {
      if (reachable && (connectedCount > 0 || pendingInputCount > 0)) {
        this._setStandby(false, null);
        return;
      }
      if (reachable && this.standbySource === 'connectivity' && Date.now() - this.standbySince > CONNECTIVITY_STANDBY_MAX_MS) {
        this._setStandby(false, null);
        return;
      }
      return;
    }
    if (!reachable || botCount === 0 || enabledCount === 0) {
      this.connFails = 0;
      return;
    }
    if (pendingInputCount > 0) {
      this.connFails = 0;
      return;
    }
    if (connectedCount === 0) {
      this.connFails += 1;
      if (this.connFails >= CONNECTIVITY_FAILS_FOR_STANDBY) {
        this._setStandby(true, 'No bots connected to Steam for an extended period (possible maintenance)', 'connectivity');
      }
    } else {
      this.connFails = 0;
    }
  }

  _setStandby(on, reason, source = null) {
    if (this.standby === on) return;
    this.standby = on;
    this.standbyReason = on ? reason : null;
    this.standbySource = on ? source : null;
    this.standbySince = on ? Date.now() : 0;
    this.connFails = 0;
    this.emit('standby', { standby: on, reason: this.standbyReason });
    this.emit('log', {
      line: on
        ? `[Steam Warming UP] STANDBY MODE engaged - ${reason}. Rotation paused, heavy actions disabled.`
        : '[Steam Warming UP] Steam connection restored - resuming normal operations.',
      stream: 'system'
    });
  }

  getStatus() {
    return {
      running: this.running,
      pid: this.proc ? this.proc.pid : null,
      restarts: this.restarts,
      lastExitCode: this.lastExitCode,
      uptimeMs: this.running ? Date.now() - this.startedAt : 0,
      standby: this.standby,
      standbyReason: this.standbyReason
    };
  }
}

module.exports = { AsfManager };
