import { useCallback, useEffect, useState } from 'react';
import { Hourglass, Loader2, Play, Power, Square } from 'lucide-react';
import Tip from './Tip';
import { asf } from '../lib/api';
import { formatMs } from '../lib/format';
import { useApp } from '../App';

export default function WarmingPanel() {
  const { standby, toast } = useApp();
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ enabled: false, maxActiveBots: 50, minHours: 4, maxHours: 6 });
  const [now, setNow] = useState(Date.now());
  const [starting, setStarting] = useState(false);
  const [checkingBot, setCheckingBot] = useState('');

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    let alive = true;
    asf.rotationGet().then((s) => {
      if (!alive) return;
      setState(s);
      setForm(s.config);
    }).catch(() => {});
    const off = asf.onRotation((s) => alive && setState(s));
    const offProg = asf.onRotationPrepareProgress((p) => alive && setCheckingBot(p.name || ''));
    return () => {
      alive = false;
      off();
      offProg();
    };
  }, []);

  const persist = useCallback((patch) => asf.rotationSet(patch).catch((e) => toast(e.message || 'Failed to save settings', 'error')), [toast]);

  const saveSettings = () => {
    persist({
      maxActiveBots: Number(form.maxActiveBots),
      minHours: Number(form.minHours),
      maxHours: Number(form.maxHours)
    });
    toast('Warming settings saved', 'success');
  };

  const doStart = async () => {
    if (starting) return;
    setStarting(true);
    setCheckingBot('');
    try {
      const prep = await asf.rotationPrepare();
      const missing = (prep && prep.missingProxy) || [];
      if (missing.length > 0) {
        const ok = window.confirm(`Some bots don't have a proxy: ${missing.join(', ')}. Do you want to continue?`);
        if (!ok) {
          setStarting(false);
          setCheckingBot('');
          return;
        }
      }
      await asf.rotationSet({
        enabled: true,
        maxActiveBots: Number(form.maxActiveBots),
        minHours: Number(form.minHours),
        maxHours: Number(form.maxHours)
      });
      setForm((f) => ({ ...f, enabled: true }));
      toast('Warming engine started', 'success');
    } catch (e) {
      toast(e.message || 'Failed to start warming', 'error');
    } finally {
      setStarting(false);
      setCheckingBot('');
    }
  };

  const doStop = async () => {
    try {
      await asf.rotationSet({
        enabled: false,
        maxActiveBots: Number(form.maxActiveBots),
        minHours: Number(form.minHours),
        maxHours: Number(form.maxHours),
        stopActive: true
      });
      setForm((f) => ({ ...f, enabled: false }));
      toast('Warming engine stopped - all bots disabled', 'success');
    } catch (e) {
      toast(e.message || 'Failed to stop warming', 'error');
    }
  };

  const cfg = (state && state.config) || form;
  const active = (state && state.active) || [];
  const queue = (state && state.queue) || [];
  const max = Number(form.maxActiveBots) || cfg.maxActiveBots;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Warming Engine</h2>
          <span className={`chip ${cfg.enabled ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-slate-500/30 bg-slate-500/10 text-slate-400'}`}>
            {cfg.enabled ? 'Running' : 'Stopped'}
          </span>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Start to warm bots: cards are farmed first; if a bot has no cards it idles on up to 32 owned games.
        </p>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <Tip
            tip={
              cfg.enabled
                ? 'Already running'
                : active.length > 0
                  ? 'Stop the active sessions before starting the warming engine'
                  : 'Prepare configs and start the warming engine'
            }
            block
          >
            <button className="btn-success w-full" disabled={starting || !!cfg.enabled || standby || active.length > 0} onClick={doStart}>
              {starting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {starting ? 'Starting…' : 'Start'}
            </button>
          </Tip>
          <Tip tip={!cfg.enabled && active.length === 0 ? 'Nothing to stop' : 'Stop the engine and disable every bot'} block>
            <button className="btn-danger w-full" disabled={!cfg.enabled && active.length === 0} onClick={doStop}>
              <Square size={15} /> Stop
            </button>
          </Tip>
        </div>
        {starting && checkingBot && (
          <p className="mb-2 text-[11px] text-slate-400">
            checking <span className="font-mono text-steam">{checkingBot}</span>…
          </p>
        )}

        <div className="space-y-3">
          <Tip tip="Absolute maximum number of bots allowed to warm simultaneously" block>
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
                <label className="label">Min Uptime (h)</label>
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
                <label className="label">Max Uptime (h)</label>
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
          <Tip tip="Save the warming settings" block>
            <button className="btn-primary w-full" onClick={saveSettings}>
              Save Warming Settings
            </button>
          </Tip>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          <Power size={15} className="text-emerald-300" /> Active Sessions ({active.length}
          <span className="text-slate-500"> / {max}</span>)
        </h3>
        {active.length === 0 ? (
          <p className="text-xs text-slate-500">No active sessions. Press Start to begin warming.</p>
        ) : (
          <div className="space-y-2.5">
            {active.map((s) => {
              if (s.manual) {
                return (
                  <div key={s.name} className="rounded-lg bg-night-800/70 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-white">{s.name}</span>
                      <span className="flex items-center gap-2 text-slate-400">
                        <span className={`h-1.5 w-1.5 rounded-full ${s.connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                        <span className="font-mono text-grape-soft">manual</span>
                      </span>
                    </div>
                  </div>
                );
              }
              const remaining = standby && typeof s.remainingMs === 'number' ? s.remainingMs : Math.max(0, s.expiresAt - now);
              const pct = Math.min(100, Math.max(0, ((s.totalMs - remaining) / s.totalMs) * 100));
              return (
                <div key={s.name} className="rounded-lg bg-night-800/70 p-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-bold text-white">{s.name}</span>
                    <span className="flex items-center gap-2 text-slate-400">
                      <span className={`h-1.5 w-1.5 rounded-full ${s.connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <span className="font-mono">{formatMs(remaining)} left</span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-night-950">
                    <div
                      className={`h-full rounded-full ${standby ? 'bg-amber-400/70' : 'bg-gradient-to-r from-steam to-orange-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          <Hourglass size={15} className="text-steam" /> Queue — next bots to start ({queue.length})
        </h3>
        {queue.length === 0 ? (
          <p className="text-xs text-slate-500">Queue is empty — every eligible bot is already active.</p>
        ) : (
          <div className="flex max-h-64 w-full flex-wrap content-start gap-1.5 overflow-y-auto">
            {queue.map((n, i) => (
              <Tip key={n} tip={`Position #${i + 1} in the warming queue`}>
                <span className="inline-block max-w-full break-all rounded-md border border-white/10 bg-night-800 px-2 py-1 font-mono text-[11px] text-slate-300">{n}</span>
              </Tip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
