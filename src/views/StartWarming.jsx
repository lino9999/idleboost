import { useEffect, useState } from 'react';
import { Activity, Hourglass, ListOrdered, Play, Power, Save, Square, Timer } from 'lucide-react';
import Tip from '../components/Tip';
import Toggle from '../components/Toggle';
import { asf } from '../lib/api';
import { formatMs } from '../lib/format';
import { useApp } from '../App';

function HoursBoostCard() {
  const { toast } = useApp();
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ enabled: true, maxGames: 30, refreshHours: 24, excludeStorage: true });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    asf.hoursGet().then((s) => {
      if (!s) return;
      setState(s);
      setForm({ ...s.config });
    }).catch(() => {});
    const off = asf.onHours((s) => setState(s));
    return () => off();
  }, []);

  const saveCfg = async (patch) => {
    try {
      await asf.hoursSet(patch);
      toast('Hours boost settings saved', 'success');
    } catch (e) {
      toast(e.message || 'Failed to save hours boost settings', 'error');
    }
  };

  const config = (state && state.config) || form;
  const running = !!(state && state.running);
  const recent = (state && state.recent) || [];
  const nextRunAt = state && state.nextRunAt;

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <Timer size={17} className="text-grape-soft" />
        <h2 className="text-base font-bold text-white">Idle Hours Boost</h2>
        <span className={`chip ${config.enabled ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-slate-500/30 bg-slate-500/10 text-slate-400'}`}>
          {config.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        For each connected bot the app reads the games it owns and fills <code className="text-slate-400">GamesPlayedWhileIdle</code>{' '}
        with random titles. ASF then "plays" them whenever the bot is idle, accumulating hours on many games at once.
        The list is written once per bot (so the bot is not restarted while it is already playing).
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Tip tip="Enable or disable automatic idle hours boost (enabled by default)" block>
          <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
            <span className="text-xs font-semibold text-slate-300">Hours Boost</span>
            <Toggle checked={!!form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
          </div>
        </Tip>
        <Tip tip="Skip storage accounts so their idle games are never changed" block>
          <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
            <span className="text-xs font-semibold text-slate-300">Skip storage accounts</span>
            <Toggle checked={!!form.excludeStorage} onChange={(v) => setForm((f) => ({ ...f, excludeStorage: v }))} />
          </div>
        </Tip>
        <Tip tip="Maximum games played simultaneously per bot while idle (Steam allows up to 32)" block>
          <div>
            <label className="label">Games per bot</label>
            <input
              type="number"
              min="1"
              max="32"
              className="input"
              value={form.maxGames}
              onChange={(e) => setForm((f) => ({ ...f, maxGames: e.target.value }))}
            />
          </div>
        </Tip>
        <Tip tip="How often the app re-checks and fills in bots that still have no idle games, in hours" block>
          <div>
            <label className="label">Check every (hours)</label>
            <input
              type="number"
              min="1"
              max="720"
              className="input"
              value={form.refreshHours}
              onChange={(e) => setForm((f) => ({ ...f, refreshHours: e.target.value }))}
            />
          </div>
        </Tip>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Tip tip="Save the hours boost settings">
          <button className="btn-primary" onClick={() => saveCfg(form)}>
            <Save size={14} /> Save settings
          </button>
        </Tip>
        <span className="text-xs text-slate-500">
          {state && state.lastRunAt > 0 ? `Last run: ${new Date(state.lastRunAt).toLocaleString()}` : 'Never run'}
        </span>
        {config.enabled && nextRunAt && !running && (
          <span className="text-xs text-slate-500">Next check in {formatMs(Math.max(0, nextRunAt - now))}</span>
        )}
      </div>

      {recent.length > 0 && (
        <div className="mt-3 max-h-40 space-y-0.5 overflow-y-auto rounded-lg bg-night-900/60 p-2 font-mono text-[11px] text-slate-400">
          {recent.map((r, i) => (
            <div key={i} className="truncate">
              {new Date(r.at).toLocaleTimeString()} {r.bot} — {r.detail}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StartWarming() {
  const { standby, toast } = useApp();
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ enabled: false, maxActiveBots: 50, minHours: 4, maxHours: 6 });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    let alive = true;
    asf
      .rotationGet()
      .then((s) => {
        if (!alive) return;
        setState(s);
        setForm(s.config);
      })
      .catch(() => {});
    const off = asf.onRotation((s) => alive && setState(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const save = async (enabledOverride) => {
    const isToggle = enabledOverride !== undefined;
    const enabled = isToggle ? !!enabledOverride : !!form.enabled;
    try {
      await asf.rotationSet({
        enabled,
        maxActiveBots: Number(form.maxActiveBots),
        minHours: Number(form.minHours),
        maxHours: Number(form.maxHours),
        stopActive: isToggle && !enabled
      });
      setForm((f) => ({ ...f, enabled }));
      toast(isToggle ? (enabled ? 'Warming engine started' : 'Warming engine stopped - active bots stopped') : 'Start Warming settings saved', 'success');
    } catch (e) {
      toast(e.message || 'Failed to save settings', 'error');
    }
  };

  const cfg = (state && state.config) || form;
  const active = (state && state.active) || [];
  const queue = (state && state.queue) || [];
  const recent = (state && state.recent) || [];

  return (
    <div className="space-y-5">
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
      <div className="space-y-5 xl:col-span-2">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white">Warming Engine</h2>
              <p className="text-xs text-slate-500">
                All bots start disabled. Enable the engine to warm them up: start &rarr; random uptime &rarr; stop &rarr;
                next in queue.
              </p>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <Tip tip={cfg.enabled ? 'The warming engine is already running' : 'Start the warming engine with the settings below'} block>
              <button className="btn-success w-full" disabled={!!cfg.enabled} onClick={() => save(true)}>
                <Play size={15} /> Start
              </button>
            </Tip>
            <Tip tip={!cfg.enabled ? 'The warming engine is already stopped' : 'Stop the warming engine and stop all active warming bots'} block>
              <button className="btn-danger w-full" disabled={!cfg.enabled} onClick={() => save(false)}>
                <Square size={15} /> Stop
              </button>
            </Tip>
          </div>

          <div className="space-y-4">
            <Tip tip="Absolute maximum number of bots allowed to farm simultaneously" block>
              <div>
                <label className="label">Max Active Bots Limit</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  className="input"
                  value={form.maxActiveBots}
                  onChange={(e) => setForm((f) => ({ ...f, maxActiveBots: e.target.value }))}
                />
              </div>
            </Tip>

            <div className="grid grid-cols-2 gap-3">
              <Tip tip="Minimum random uptime per bot, in hours" block>
                <div>
                  <label className="label">Min Uptime (hours)</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.5"
                    className="input"
                    value={form.minHours}
                    onChange={(e) => setForm((f) => ({ ...f, minHours: e.target.value }))}
                  />
                </div>
              </Tip>
              <Tip tip="Maximum random uptime per bot, in hours" block>
                <div>
                  <label className="label">Max Uptime (hours)</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.5"
                    className="input"
                    value={form.maxHours}
                    onChange={(e) => setForm((f) => ({ ...f, maxHours: e.target.value }))}
                  />
                </div>
              </Tip>
            </div>

            <Tip tip="Save settings and apply them to the background warming engine immediately" block>
              <button className="btn-primary w-full" onClick={() => save()}>
                <Save size={15} /> Save Warming Settings
              </button>
            </Tip>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
            <Activity size={15} className="text-steam" /> Engine Status
          </h3>
          <ul className="space-y-2 text-xs text-slate-400">
            <li className="flex justify-between">
              <span>Engine</span>
              <span className={cfg.enabled ? 'font-bold text-emerald-300' : 'font-bold text-slate-500'}>
                {cfg.enabled ? 'ENABLED' : 'DISABLED'}
              </span>
            </li>
            <li className="flex justify-between">
              <span>Standby Mode</span>
              <span className={standby ? 'font-bold text-amber-300' : 'font-bold text-slate-500'}>
                {standby ? 'PAUSED (timers frozen)' : 'Inactive'}
              </span>
            </li>
            <li className="flex justify-between">
              <span>Active sessions</span>
              <span className="font-bold text-slate-200">
                {active.length} / {Number(form.maxActiveBots) || cfg.maxActiveBots}
              </span>
            </li>
            <li className="flex justify-between">
              <span>Bots waiting in queue</span>
              <span className="font-bold text-slate-200">{queue.length}</span>
            </li>
            <li className="flex justify-between">
              <span>Total bots known</span>
              <span className="font-bold text-slate-200">{state ? state.totalBots : '—'}</span>
            </li>
          </ul>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
            <ListOrdered size={15} className="text-grape-soft" /> Recent Activity
          </h3>
          {recent.length === 0 ? (
            <p className="text-xs text-slate-500">No warming events yet.</p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto font-mono text-[11px] text-slate-400">
              {recent.map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-5 xl:col-span-3">
        <HoursBoostCard />

        <div className="card p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
            <Hourglass size={15} className="text-steam" /> Queue — next bots to start ({queue.length})
          </h3>
          {queue.length === 0 ? (
            <p className="text-xs text-slate-500">Queue is empty — every eligible bot is already active.</p>
          ) : (
            <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
              {queue.map((n, i) => (
                <Tip key={n} tip={`Position #${i + 1} in the warming queue`}>
                  <span className="rounded-md border border-white/10 bg-night-800 px-2 py-1 font-mono text-[11px] text-slate-300">
                    {n}
                  </span>
                </Tip>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    <div className="card p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-white">
        <Power size={15} className="text-emerald-300" /> Active Sessions ({active.length}
        <span className="text-slate-500"> / {Number(form.maxActiveBots) || cfg.maxActiveBots}</span>)
      </h3>
      {active.length === 0 ? (
        <p className="text-xs text-slate-500">
          No active sessions. Enable the engine to start warming your bots automatically.
        </p>
      ) : (
        <div className="space-y-3">
          {active.map((s) => {
            const remaining = standby && typeof s.remainingMs === 'number' ? s.remainingMs : Math.max(0, s.expiresAt - now);
            const pct = Math.min(100, Math.max(0, ((s.totalMs - remaining) / s.totalMs) * 100));
            return (
              <div key={s.name} className="rounded-lg bg-night-800/70 p-3">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-bold text-white">{s.name}</span>
                  <span className="flex items-center gap-2 text-slate-400">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${s.connected ? 'bg-emerald-400' : 'bg-amber-400'}`}
                    />
                    <Tip tip="Time left before this bot is stopped and replaced by the next bot in the queue">
                      <span className="font-mono">{formatMs(remaining)} left</span>
                    </Tip>
                  </span>
                </div>
                <Tip tip={`Uptime progress: ${pct.toFixed(0)}% of the assigned random timer consumed`} block>
                  <div className="h-1.5 overflow-hidden rounded-full bg-night-950">
                    <div
                      className={`h-full rounded-full ${standby ? 'bg-amber-400/70' : 'bg-gradient-to-r from-steam to-grape'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Tip>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );
}
