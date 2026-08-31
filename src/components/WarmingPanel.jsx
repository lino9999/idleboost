import { useCallback, useEffect, useState } from 'react';
import { Gift, Hourglass, Loader2, Play, Power, Square } from 'lucide-react';
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
  const [fgCheck, setFgCheck] = useState(null);
  const [fgBusy, setFgBusy] = useState(false);

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

  // Readiness probe for the FreeGames unlocker (needs one proxy per account).
  useEffect(() => {
    let alive = true;
    const run = () => asf.rotationFreeGamesCheck().then((c) => alive && setFgCheck(c)).catch(() => {});
    run();
    const iv = setInterval(run, 15000);
    return () => {
      alive = false;
      clearInterval(iv);
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
        mode: 'warming',
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
      toast('Warming engine stopped - bots are being disabled one by one', 'success');
    } catch (e) {
      toast(e.message || 'Failed to stop warming', 'error');
    }
  };

  const doFreeGames = async () => {
    if (fgBusy) return;
    setFgBusy(true);
    try {
      const res = await asf.rotationStartFreeGames();
      toast(`FreeGames unlocker started - ${res.started} bot(s) online, farming disabled`, 'success');
      const c = await asf.rotationFreeGamesCheck().catch(() => null);
      if (c) setFgCheck(c);
    } catch (e) {
      toast(e.message || 'Failed to start FreeGames unlocker', 'error');
    } finally {
      setFgBusy(false);
    }
  };

  const cfg = (state && state.config) || form;
  const active = (state && state.active) || [];
  const queue = (state && state.queue) || [];
  const stoppingAll = (state && state.stoppingAll) || null;
  const freeGamesActive = !!(state && state.freeGamesActive) || !!(fgCheck && fgCheck.freeGamesActive);
  const fgReady = !!(fgCheck && fgCheck.ready);
  const max = Number(form.maxActiveBots) || cfg.maxActiveBots;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Warming Engine</h2>
          <span
            className={`chip ${
              freeGamesActive
                ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                : cfg.enabled
                  ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                  : 'border-slate-500/30 bg-slate-500/10 text-slate-400'
            }`}
          >
            {freeGamesActive ? 'FreeGames mode' : cfg.enabled ? 'Running' : 'Stopped'}
          </span>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Start to warm bots: cards are farmed first; when a bot has no cards it idles on CS2 plus its owned games
          (up to 32 at once).
        </p>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <Tip
            tip={
              cfg.enabled
                ? 'Already running'
                : freeGamesActive
                  ? 'Stop the FreeGames unlocker before starting the warming engine'
                  : active.length > 0
                    ? 'Stop the active sessions before starting the warming engine'
                    : 'Prepare configs and start the warming engine'
            }
            block
          >
            <button className="btn-success w-full" disabled={starting || !!cfg.enabled || freeGamesActive || standby || active.length > 0 || !!stoppingAll} onClick={doStart}>
              {starting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {starting ? 'Starting…' : 'Start'}
            </button>
          </Tip>
          <Tip tip={!cfg.enabled && active.length === 0 && !freeGamesActive ? 'Nothing to stop' : 'Stop the engine and disable every bot one by one (1 per second)'} block>
            <button className="btn-danger w-full" disabled={(!cfg.enabled && active.length === 0 && !freeGamesActive) || !!stoppingAll} onClick={doStop}>
              {stoppingAll ? <Loader2 size={15} className="animate-spin" /> : <Square size={15} />} {stoppingAll ? `Stopping ${stoppingAll.stopped}/${stoppingAll.total}…` : 'Stop'}
            </button>
          </Tip>
        </div>

        <div className="mb-3">
          <Tip
            tip={
              freeGamesActive
                ? 'FreeGames unlocker is running - use Stop to bring the accounts offline'
                : !fgCheck
                  ? 'Checking proxy requirements…'
                  : fgCheck.total === 0
                    ? 'No bots available'
                    : !fgReady
                      ? `Every account needs its own proxy before starting${
                          fgCheck.missingProxy.length
                            ? ` (${fgCheck.missingProxy.length} missing: ${fgCheck.missingProxy.slice(0, 5).join(', ')}${fgCheck.missingProxy.length > 5 ? '…' : ''})`
                            : ''
                        }`
                      : 'Bring accounts ONLINE without farming (no card farming, no hour idling) so the FreePackages plugin only redeems free games. Respects Max Active Bots and Min/Max Uptime, rotating accounts like normal warming. Requires one proxy per account. Use Stop to go offline again.'
            }
            block
          >
            <button
              className="btn-primary w-full"
              disabled={fgBusy || starting || !!cfg.enabled || freeGamesActive || standby || !!stoppingAll || !fgReady}
              onClick={doFreeGames}
            >
              {fgBusy ? <Loader2 size={15} className="animate-spin" /> : <Gift size={15} />}
              {freeGamesActive ? 'FreeGames unlocker running' : 'Start FreeGames unlocker'}
            </button>
          </Tip>
        </div>
        {starting && checkingBot && (
          <p className="mb-2 text-[11px] text-slate-400">
            checking <span className="font-mono text-steam">{checkingBot}</span>…
          </p>
        )}
        {stoppingAll && (
          <p className="mb-2 text-[11px] text-slate-400">
            Disabling accounts one by one so they don&apos;t all drop offline at once —{' '}
            <span className="font-mono text-steam">{stoppingAll.stopped}/{stoppingAll.total}</span> stopped
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
