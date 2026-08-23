import { useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, Loader2, RefreshCw, Save, Timer, UploadCloud } from 'lucide-react';
import Tip from '../components/Tip';
import Toggle from '../components/Toggle';
import { asf } from '../lib/api';
import { useApp } from '../App';

function UpdatesCard() {
  const { status, toast } = useApp();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ intervalHours: 12 });
  const [formLoaded, setFormLoaded] = useState(false);

  useEffect(() => {
    asf.updaterGet().then((s) => {
      setState(s);
      if (s && s.config) {
        setForm({ intervalHours: s.config.intervalHours });
        setFormLoaded(true);
      }
    }).catch(() => {});
    const off = asf.onUpdater(setState);
    return () => off();
  }, []);

  const saveCfg = async (patch) => {
    try {
      await asf.updaterSet(patch);
      toast('Update settings saved', 'success');
    } catch (e) {
      toast(e.message || 'Failed to save update settings', 'error');
    }
  };

  const checkNow = async () => {
    setBusy(true);
    try {
      await asf.updaterCheck();
      toast('Update check finished', 'success');
    } catch (e) {
      toast(e.message || 'Update check failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const config = (state && state.config) || {};
  const last = (state && state.lastResult) || null;
  const asfCurrent = (status && status.asfVersion) || (last && last.asfCurrent) || '—';

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <UploadCloud size={17} className="text-grape-soft" />
        <h2 className="text-base font-bold text-white">Auto Updates — ASF & Plugins</h2>
        <span className="chip border-white/10 bg-night-800 text-slate-400">ASF v{asfCurrent}</span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        The app periodically checks the official ASF release channel and the loaded plugins. When a newer ASF version is
        detected it is downloaded via the official IPC update endpoint and ASF is restarted automatically; plugins are
        refreshed the same way.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Tip tip="Automatically update the ArchiSteamFarm program when a new release is detected" block>
          <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
            <span className="text-xs font-semibold text-slate-300">Auto-update ASF</span>
            <Toggle checked={!!config.autoAsf} onChange={(v) => saveCfg({ autoAsf: v })} />
          </div>
        </Tip>
        <Tip tip="Automatically update all loaded ASF plugins when newer versions are available" block>
          <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
            <span className="text-xs font-semibold text-slate-300">Auto-update Plugins</span>
            <Toggle checked={!!config.autoPlugins} onChange={(v) => saveCfg({ autoPlugins: v })} />
          </div>
        </Tip>
        <Tip tip="How often to check for updates, in hours (updates come from the official Stable channel)" block>
          <div>
            <label className="label">Check every (hours)</label>
            <input
              type="number"
              min="1"
              max="168"
              className="input"
              value={form.intervalHours}
              disabled={!formLoaded}
              onChange={(e) => setForm((f) => ({ ...f, intervalHours: e.target.value }))}
              onBlur={() => saveCfg({ intervalHours: Number(form.intervalHours) || 12 })}
            />
          </div>
        </Tip>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Tip tip="Check GitHub for a new ASF release and verify plugin versions immediately">
          <button className="btn-primary" disabled={busy || (state && state.busy)} onClick={checkNow}>
            {busy || (state && state.busy) ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Check for updates now
          </button>
        </Tip>
        <span className="text-xs text-slate-500">
          {state && state.lastCheckAt ? `Last check: ${new Date(state.lastCheckAt).toLocaleString()}` : 'Never checked'}
        </span>
        {state && state.restartScheduled && (
          <span className="chip border-amber-400/40 bg-amber-400/10 text-amber-300">Restart scheduled to apply update</span>
        )}
      </div>

      {last && (
        <div className="mt-3 space-y-1 text-xs text-slate-500">
          <div>
            ASF: <span className="text-slate-300">{last.asfCurrent || '—'}</span>
            {' → latest '}
            <span className={last.asfUpdateAvailable ? 'font-bold text-amber-300' : 'text-slate-300'}>{last.asfLatest || '—'}</span>
            {last.asfUpdated && <span className="ml-2 text-emerald-300">update triggered</span>}
          </div>
          {last.plugins && last.plugins.length > 0 && (
            <div>
              Plugins:{' '}
              <span className="text-slate-300">{last.plugins.map((p) => `${p.name} v${p.version}`).join(', ')}</span>
            </div>
          )}
          {last.errors && last.errors.length > 0 && (
            <div className="text-rose-300">{last.errors.join(' | ')}</div>
          )}
        </div>
      )}
    </div>
  );
}

const ALWAYS_ON = ['IPC', 'Headless', 'AutoUpdates'];

const TOGGLES = [
  ['AutoRestart', 'Allows ASF to restart itself when it considers it necessary'],
  ['Debug', 'Enables verbose debug logging in the console']
];

const NUMBERS = [
  ['ConnectionTimeout', 'Seconds a Steam connection attempt may take before timing out (wiki range 30-600)'],
  ['IdleFarmingPeriod', 'Hours between farming checks when a bot is idle (wiki range 0-24)'],
  ['MaxTradeHoldDuration', 'Maximum trade hold duration in days that ASF will accept (wiki range 0-15)'],
  ['GiftsLimiterDelay', 'Seconds between gift/claim-related operations'],
  ['NotificationDelay', 'Seconds between repeated notifications sent to Steam'],
  ['WebLimiterDelay', 'Seconds between consecutive Steam web/API requests'],
  ['MinFarmingDelayAfterBlock', 'Minimum minutes to wait before retrying after a farming block (wiki range 0-60)']
];

const SELECTS = [
  ['OptimizationStrategy', [[0, 'Max Performance'], [1, 'Min Memory Usage']], 'ASF optimization strategy — Min Memory Usage reduces RAM/bandwidth at the cost of speed']
];

const STRINGS = [
  ['CommandPrefix', 'Prefix for ASF chat/IPC commands (default "!")'],
  ['IPCPassword', 'Password required by IPC clients — set this and enter it in "App Connection" below'],
  ['SteamOwnerID', 'SteamID64 of the ASF owner (master user)']
];

const WEBHOOK_EVENTS = [
  ['warming', 'Bot started warming', 'Send a notification when a bot starts a warming session'],
  ['redemption', 'Game redeemed', 'Send a notification when a free game is redeemed on an account'],
  ['profile', 'Profile customized', 'Send a notification when an account profile is updated'],
  ['storage', 'Items transferred', 'Send a notification when items are moved to a storage account'],
  ['cards', 'Trading card drop', 'Send a notification when a bot receives a Steam trading card while warming'],
  ['ban', 'Ban detected', 'Send a notification when an account is detected as banned'],
  ['update', 'ASF / plugin update', 'Send a notification when ASF or a plugin is updated']
];

function WebhookCard() {
  const { toast } = useApp();
  const [state, setState] = useState(null);
  const [url, setUrl] = useState('');

  useEffect(() => {
    asf.webhookGet().then((s) => {
      if (!s) return;
      setState(s);
      setUrl(s.config.url || '');
    }).catch(() => {});
    const off = asf.onWebhook((s) => setState(s));
    return () => off();
  }, []);

  const config = (state && state.config) || { url: '', events: {} };
  const recent = (state && state.recent) || [];

  const saveUrl = async () => {
    try {
      await asf.webhookSet({ url });
      toast(url ? 'Discord webhook saved' : 'Discord webhook removed', 'success');
    } catch (e) {
      toast(e.message || 'Failed to save webhook', 'error');
    }
  };

  const toggleEvent = async (key, v) => {
    try {
      await asf.webhookSet({ events: { [key]: v } });
    } catch (e) {
      toast(e.message || 'Failed to update webhook events', 'error');
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <UploadCloud size={17} className="text-grape-soft" />
        <h2 className="text-base font-bold text-white">Discord Webhook</h2>
        <span className={`chip ${config.url ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-slate-500/30 bg-slate-500/10 text-slate-400'}`}>
          {config.url ? 'Configured' : 'Not set'}
        </span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        Paste a Discord webhook URL to receive notifications about what the app is doing (bots warming, games redeemed,
        profiles customized, transfers, market purchases, updates). Toggle which events are sent.
      </p>

      <div className="flex items-center gap-2">
        <Tip tip="Discord webhook URL (Server settings → Integrations → Webhooks). Leave empty to disable." block>
          <input
            className="input flex-1 font-mono text-xs"
            placeholder="https://discord.com/api/webhooks/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Tip>
        <Tip tip="Save the webhook URL">
          <button className="btn-primary" onClick={saveUrl}>
            <Save size={14} /> Save
          </button>
        </Tip>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        {WEBHOOK_EVENTS.map(([key, label, tip]) => (
          <Tip key={key} tip={tip} block>
            <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
              <span className="text-xs font-medium text-slate-300">{label}</span>
              <Toggle checked={!!config.events[key]} disabled={!config.url} onChange={(v) => toggleEvent(key, v)} />
            </div>
          </Tip>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="mt-4 max-h-32 space-y-0.5 overflow-y-auto rounded-lg bg-night-900/60 p-2 font-mono text-[11px] text-slate-400">
          {recent.map((r, i) => (
            <div key={i} className="truncate">
              {new Date(r.at).toLocaleTimeString()} [{r.type}] {r.line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SteamApiKeysCard() {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [delay, setDelay] = useState(300);

  useEffect(() => {
    asf
      .libraryGetKeys()
      .then((keys) => {
        setText(Array.isArray(keys) ? keys.join('\n') : '');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    asf.libraryGetDelay().then((d) => setDelay(d || 300)).catch(() => {});
  }, []);

  const save = async () => {
    try {
      const keys = text.split(/\r?\n/).map((k) => k.trim()).filter(Boolean);
      await asf.librarySetKeys(keys);
      toast(`Steam API keys saved (${keys.length} key(s)) - a random key is used per call`, 'success');
    } catch (e) {
      toast(e.message || 'Failed to save API keys', 'error');
    }
  };

  const saveDelay = async () => {
    try {
      const d = await asf.librarySetDelay(Number(delay) || 300);
      setDelay(d);
      toast(`Library sync delay set to ${d}s`, 'success');
    } catch (e) {
      toast(e.message || 'Failed to save delay', 'error');
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <KeyRound size={17} className="text-amber-300" />
        <h2 className="text-base font-bold text-white">Steam API Keys</h2>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        Used to refresh each account's owned-games library and check bans via Steam's Web API (only for accounts set to
        public). Add one API key per line; the app uses a random key per call and a random proxy (if imported) to
        minimize rate limits.
      </p>
      <Tip tip="One Steam Web API key per line. Get keys at https://steamcommunity.com/dev/apikey" block>
        <textarea
          className="input h-28 resize-y font-mono text-xs"
          placeholder={'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\nYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Tip>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Tip tip="Seconds to wait between one library sync and the next for each account (minimum 60)" block>
          <div>
            <label className="label">Library sync delay (seconds)</label>
            <input
              type="number"
              min="60"
              className="input"
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
              onBlur={saveDelay}
            />
          </div>
        </Tip>
        <div className="flex items-end">
          <button className="btn-primary" disabled={!loaded} onClick={save}>
            <Save size={14} /> Save API keys
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GlobalConfig() {
  const { toast } = useApp();
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({});
  const [raw, setRaw] = useState('');
  const [asfDir, setAsfDir] = useState('');
  const [settings, setSettings] = useState({ ipcUrl: '', ipcPassword: '' });
  const [saveState, setSaveState] = useState('idle');
  const [dirty, setDirty] = useState({});

  const load = useCallback(async () => {
    try {
      const [c, dir, s] = await Promise.all([asf.configRead(), asf.asfPath(), asf.settingsGet()]);
      setCfg(c || {});
      setForm({ ...c });
      setRaw(JSON.stringify(c || {}, null, 2));
      setAsfDir(dir);
      setSettings(s);
    } catch (e) {
      toast(e.message || 'Failed to load ASF.json', 'error');
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty((d) => (d[key] ? d : { ...d, [key]: true }));
  };

  const toggleField = (key, checked) => {
    setField(key, checked);
  };

  const normVal = (v) => (v === undefined || v === '' ? null : v);
  const isSame = (a, b) => JSON.stringify(normVal(a)) === JSON.stringify(normVal(b));

  const buildPartial = (base, form, dirty) => {
    const partial = {};
    const consider = (key, value) => {
      if (!dirty[key]) return;
      if (!isSame(value, base[key])) partial[key] = normVal(value);
    };
    for (const [key] of TOGGLES) consider(key, !!form[key]);
    for (const [key] of NUMBERS) {
      if (form[key] !== undefined && form[key] !== '') consider(key, Number(form[key]));
    }
    for (const [key] of SELECTS) {
      if (form[key] !== undefined && form[key] !== '') consider(key, Number(form[key]));
    }
    for (const [key] of STRINGS) consider(key, form[key]);
    consider('LoginLimiterDelay', Number(form.LoginLimiterDelay ?? base.LoginLimiterDelay ?? 10));
    consider('FarmingDelay', Number(form.FarmingDelay ?? base.FarmingDelay ?? 15));
    if (dirty.BlacklistText && typeof form.BlacklistText === 'string' && form.BlacklistText.trim()) {
      const list = form.BlacklistText.split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);
      if (!isSame(list, base.Blacklist)) partial.Blacklist = list;
    }
    return partial;
  };

  useEffect(() => {
    if (!cfg) return;
    if (Object.keys(dirty).length === 0) return;
    const partial = buildPartial(cfg, form, dirty);
    if (Object.keys(partial).length === 0) {
      setDirty({});
      setSaveState('idle');
      return;
    }
    setSaveState('saving');
    const t = setTimeout(async () => {
      try {
        const next = await asf.configUpdate(partial);
        setCfg(next);
        setRaw(JSON.stringify(next, null, 2));
        setDirty({});
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1500);
      } catch (e) {
        setSaveState('idle');
        toast(e.message || 'Failed to save ASF.json', 'error');
      }
    }, 700);
    return () => clearTimeout(t);
  }, [form, cfg, toast]);

  const applyRaw = async () => {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('ASF.json must be a JSON object');
      const next = await asf.configReplace(parsed);
      setCfg(next);
      setForm({ ...next });
      setRaw(JSON.stringify(next, null, 2));
      toast('ASF.json replaced with raw JSON', 'success');
    } catch (e) {
      toast(`Invalid JSON: ${e.message}`, 'error');
    }
  };

  const saveSettings = async () => {
    try {
      await asf.settingsSet(settings);
      toast('App connection settings saved', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (!cfg) {
    return (
      <div className="flex h-40 items-center justify-center text-slate-500">
        <Loader2 size={20} className="mr-2 animate-spin" /> Loading ASF.json...
      </div>
    );
  }

  const loginDelay = Number(form.LoginLimiterDelay ?? 10);

  return (
    <div className="space-y-5">
      <UpdatesCard />

      <div className="card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Timer size={17} className="text-steam" />
          <h2 className="text-base font-bold text-white">Staggered Launch — Login Delay</h2>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-slate-500">
          Maps to ASF's <code className="text-slate-300">LoginLimiterDelay</code>: the number of seconds ASF waits
          between consecutive bot logins. Higher values spread logins over time (safer for many accounts); 0 disables
          the delay. ASF wiki range: 0-255.
        </p>
        <div className="flex items-center gap-4">
          <Tip tip="Drag to set the delay between consecutive account logins" block>
            <input
              type="range"
              min="0"
              max="60"
              value={Math.min(60, loginDelay)}
              onChange={(e) => setField('LoginLimiterDelay', Number(e.target.value))}
              className="flex-1 accent-[#66c0f4]"
            />
          </Tip>
          <Tip tip="Exact LoginLimiterDelay value in seconds (0-255)" block>
            <input
              type="number"
              min="0"
              max="255"
              className="input !w-24 text-center font-mono"
              value={loginDelay}
              onChange={(e) => setField('LoginLimiterDelay', e.target.value)}
            />
          </Tip>
          <span className="text-xs text-slate-500">
            ≈ {(loginDelay * Math.max(1, 10)) / 60 >= 1 ? `${((loginDelay * 10) / 60).toFixed(1)} min per 10 accounts` : `${loginDelay * 10}s per 10 accounts`}
          </span>
        </div>
      </div>

      <WebhookCard />

      <SteamApiKeysCard />

      <div className="card p-5">
        <h3 className="mb-2 text-sm font-bold text-white">App ↔ ASF Connection</h3>
        <p className="mb-3 text-xs text-slate-500">
          Where Steam Warming UP reaches the ASF IPC server (default <code className="text-slate-400">http://127.0.0.1:1242</code>).
          If you set <code className="text-slate-400">IPCPassword</code> in ASF.json, enter it here too.
        </p>
        <div className="space-y-3">
          <Tip tip="Base URL of the ASF IPC server (must match IPCPrefixes in ASF.json)" block>
            <div>
              <label className="label">IPC URL</label>
              <input className="input font-mono" value={settings.ipcUrl || ''} onChange={(e) => setSettings((s) => ({ ...s, ipcUrl: e.target.value }))} />
            </div>
          </Tip>
          <Tip tip="ASF IPCPassword — sent in the Authentication header of every IPC request" block>
            <div>
              <label className="label">IPC Password</label>
              <input type="password" className="input font-mono" value={settings.ipcPassword || ''} onChange={(e) => setSettings((s) => ({ ...s, ipcPassword: e.target.value }))} />
            </div>
          </Tip>
          <Tip tip="Save the connection settings used by this app">
            <button className="btn-ghost" onClick={saveSettings}>
              <Save size={14} /> Save connection settings
            </button>
          </Tip>
        </div>
      </div>
    </div>
  );
}
