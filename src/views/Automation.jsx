import { useCallback, useEffect, useRef, useState } from 'react';
import { Gamepad2, Loader2, Save, Timer, Trophy } from 'lucide-react';
import Tip from '../components/Tip';
import Toggle from '../components/Toggle';
import { asf } from '../lib/api';
import { formatMs } from '../lib/format';
import { useApp } from '../App';

const DEFAULT_FILTERS = [{ NoCostOnly: true }, { Categories: [29] }];

function FreeGamesRedemptionCard() {
  const { toast } = useApp();
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ enabled: false, limit: 25 });
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const loaded = useRef(false);
  const applyTimer = useRef(null);

  useEffect(() => {
    let alive = true;
    asf.freePackagesGet().then((s) => {
      if (!alive) return;
      setState(s);
      setForm({
        enabled: !!(s && s.allEnabled),
        limit: s ? s.limit : 25
      });
      loaded.current = true;
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const doApply = useCallback(
    async (f) => {
      setBusy(true);
      setSaveState('saving');
      try {
        await asf.freePackagesApply({
          enabled: f.enabled,
          pauseWhilePlaying: true,
          pauseWhileFarming: true,
          limit: f.limit,
          perHour: 0,
          filtersEnabled: true,
          filters: DEFAULT_FILTERS
        });
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1400);
        try {
          setState(await asf.freePackagesGet());
        } catch {
          /* ignore */
        }
      } catch (e) {
        setSaveState('idle');
        toast(e.message || 'Failed to apply Free Games settings', 'error');
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );

  const changeApplied = useCallback(
    (nextForm) => {
      setForm(nextForm);
      if (!loaded.current) return;
      if (applyTimer.current) clearTimeout(applyTimer.current);
      applyTimer.current = setTimeout(() => doApply(nextForm), 250);
    },
    [doApply]
  );

  if (!state && !loaded.current) {
    return (
      <div className="card flex h-40 items-center justify-center p-5 text-slate-500">
        <Loader2 size={18} className="mr-2 animate-spin" /> Loading Free Games Redemption...
      </div>
    );
  }

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Gamepad2 size={17} className="text-emerald-300" />
        <h2 className="text-base font-bold text-white">Free Games Redemption</h2>
        <span
          className={`chip ${
            form.enabled
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : 'border-slate-500/30 bg-slate-500/10 text-slate-400'
          }`}
        >
          {form.enabled ? 'Enabled' : 'Disabled'}
        </span>
        {saveState === 'saving' && <span className="text-xs text-steam">Saving…</span>}
        {saveState === 'saved' && (
          <span className="flex items-center gap-1 text-xs text-emerald-300">
            <Save size={13} /> Saved
          </span>
        )}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        Watches Steam for new free packages and redeems them automatically. Redemption never interrupts card farming:
        activations are paused while a bot is farming or playing, and resume automatically in batches (Steam allows max
        30 activations per 1.5 hours, the default cap is 25), so requests are never spammed.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Tip tip="Enable or disable free games redemption on ALL bots at once." block>
          <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
            <span className="text-xs font-semibold text-slate-300">Enable (all bots)</span>
            <Toggle
              checked={!!form.enabled}
              disabled={busy}
              tip={form.enabled ? 'Free games redemption is enabled for all bots' : 'Free games redemption is disabled for all bots'}
              onChange={(v) => changeApplied({ ...form, enabled: v })}
            />
          </div>
        </Tip>

        <Tip tip="Maximum packages activated per 1.5 hours (Steam allows 30; the default cap is 25)." block>
          <div>
            <label className="label">Activation Limit</label>
            <input
              type="number"
              min="1"
              max="30"
              className="input"
              value={form.limit}
              onChange={(e) => setForm((f) => ({ ...f, limit: e.target.value }))}
              onBlur={() => loaded.current && doApply(form)}
            />
          </div>
        </Tip>
      </div>
    </div>
  );
}

function AchievementCard() {
  const { toast } = useApp();
  const [state, setState] = useState(null);
  const [delayMinutes, setDelayMinutes] = useState(5);
  const loaded = useRef(false);

  useEffect(() => {
    let alive = true;
    asf.schedulerGet().then((s) => {
      if (!alive) return;
      setState(s);
      setDelayMinutes(s && s.config ? s.config.delayMinutes : 5);
      loaded.current = true;
    }).catch(() => {});
    const off = asf.onScheduler((s) => alive && setState(s));
    return () => { alive = false; off(); };
  }, []);

  const saveCfg = (patch) => {
    if (!loaded.current) return;
    asf.schedulerSet(patch).catch((e) => toast(e.message || 'Failed to save settings', 'error'));
  };

  const config = (state && state.config) || { enabled: false, delayMinutes };
  const running = !!(state && state.running);
  const progress = state && state.progress;
  const lastResult = state && state.lastResult;
  const nextRunAt = state && state.nextRunAt;
  const stats = (state && state.stats) || { unlockOps: 0, runs: 0 };
  const [, setTick] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Trophy size={17} className="text-amber-300" />
        <h2 className="text-base font-bold text-white">ASFAchievement Manager</h2>
        <span className={`chip ${config.enabled ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-slate-500/30 bg-slate-500/10 text-slate-400'}`}>
          {config.enabled ? 'Enabled' : 'Disabled'}
        </span>
        <span className="chip border-white/10 bg-night-800 text-slate-400">{stats.unlockOps} game(s) unlocked</span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        The app reads the games each connected account owns and automatically unlocks all their achievements (via the
        plugin's <code className="text-slate-400">aset &lt;bot&gt; &lt;appid&gt; *</code> command). It works one account
        at a time, one game at a time, with a delay between each unlock, so Steam is never flooded with requests.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Tip tip="Enable or disable the automatic achievement unlocker." block>
          <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
            <span className="text-xs font-semibold text-slate-300">Auto Unlock</span>
            <Toggle
              checked={!!config.enabled}
              tip={config.enabled ? 'Auto-unlock is ENABLED' : 'Auto-unlock is DISABLED'}
              onChange={(v) => saveCfg({ enabled: v })}
            />
          </div>
        </Tip>

        <Tip tip="Minutes to wait between each single game unlock (one account, one game per step)." block>
          <div>
            <label className="label">Delay between unlocks (minutes)</label>
            <input
              type="number"
              min="1"
              max="1440"
              className="input"
              value={delayMinutes}
              onChange={(e) => setDelayMinutes(e.target.value)}
              onBlur={() => saveCfg({ delayMinutes: Number(delayMinutes) || 5 })}
            />
          </div>
        </Tip>
      </div>

      {running && progress && (
        <div className="mt-4 rounded-lg border border-steam/20 bg-steam/[0.05] p-3 text-xs">
          <span className="font-mono font-semibold text-steam">Unlocking: {progress.bot} - AppID {progress.appId}</span>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
        {lastResult && lastResult.at && (
          <span>
            Last unlock: <span className="text-slate-300">{new Date(lastResult.at).toLocaleString()}</span> -{' '}
            <span className="text-slate-300">{lastResult.bot}</span> (AppID {lastResult.appId})
          </span>
        )}
        {!running && nextRunAt && config.enabled && (
          <span className="flex items-center gap-1">
            <Timer size={13} /> Next unlock in {formatMs(Math.max(0, nextRunAt - Date.now()))}
          </span>
        )}
      </div>

      {state && state.recent && state.recent.length > 0 && (
        <div className="mt-3 max-h-32 space-y-0.5 overflow-y-auto rounded-lg bg-night-900/60 p-2 font-mono text-[11px] text-slate-400">
          {state.recent.map((line, i) => (
            <div key={i} className="truncate">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Automation() {
  const { standby } = useApp();
  return (
    <div className="space-y-5">
      {standby && (
        <div className="card border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-200">
          Standby Mode is active - scheduled plugin actions are paused and will resume automatically when the Steam
          connection is restored.
        </div>
      )}
      <div className="grid grid-cols-1 gap-5">
        <FreeGamesRedemptionCard />
        <AchievementCard />
      </div>
    </div>
  );
}
