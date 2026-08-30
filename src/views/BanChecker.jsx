import { useEffect, useState } from 'react';
import { Bot, KeyRound, Play, RefreshCw, Square } from 'lucide-react';
import Tip from '../components/Tip';
import Toggle from '../components/Toggle';
import { asf } from '../lib/api';
import { useApp } from '../App';

function checkDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

export default function BanChecker() {
  const { toast } = useApp();
  const [state, setState] = useState(null);
  const [bots, setBots] = useState({});
  const [form, setForm] = useState({ autoCheck: false, useProxy: false, delaySeconds: 1 });
  const [busy, setBusy] = useState(false);

  const load = () => {
    asf.banGet().then((s) => {
      if (!s) return;
      setState(s);
      setForm({ autoCheck: !!s.config.autoCheck, useProxy: !!s.config.useProxy, delaySeconds: s.config.delaySeconds });
    }).catch(() => {});
    asf.getBots().then((b) => setBots(b || {})).catch(() => {});
  };

  useEffect(() => {
    load();
    const off = asf.onBan((s) => setState(s));
    const iv = setInterval(() => asf.getBots().then((b) => setBots(b || {})).catch(() => {}), 8000);
    return () => {
      off();
      clearInterval(iv);
    };
  }, []);

  const save = async (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    try {
      await asf.banSetConfig(patch);
    } catch (e) {
      toast(e.message || 'Failed to save ban checker settings', 'error');
    }
  };

  const runAll = async () => {
    setBusy(true);
    try {
      const res = await asf.banCheckAll();
      if (res && res.started) {
        toast(`Ban check started - ${res.total} account(s), one every ${form.delaySeconds}s`, 'success');
      } else if (res && res.skipped) {
        toast('A ban check is already running', 'info');
      } else {
        toast('No checkable accounts - no SteamID could be resolved (connect the accounts once or set an API key)', 'error');
      }
    } catch (e) {
      toast(e.message || 'Failed to run ban check', 'error');
    } finally {
      setBusy(false);
      load();
    }
  };

  const stopAll = async () => {
    try {
      await asf.banStop();
    } catch (e) {
      toast(e.message || 'Failed to stop ban checker', 'error');
    }
    load();
  };

  const hasApiKeys = !!(state && state.hasApiKeys);
  const hasProxies = !!(state && state.hasProxies);

  if (!state) {
    return (
      <div className="card flex h-40 items-center justify-center p-5 text-slate-500">
        <RefreshCw size={18} className="mr-2 animate-spin" /> Loading AutoBan Checker...
      </div>
    );
  }

  if (!hasApiKeys) {
    return (
      <div className="card flex h-64 flex-col items-center justify-center gap-3 p-5 text-center">
        <KeyRound size={28} className="text-slate-600" />
        <p className="text-sm text-slate-400">Set an API key in Global Config to unlock this feature.</p>
      </div>
    );
  }

  const names = Object.keys(bots).sort((a, b) => a.localeCompare(b));
  const status = state.status || {};

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="mb-1 flex items-center gap-2">
          <Bot size={17} className="text-rose-300" />
          <h2 className="text-base font-bold text-white">AutoBan Checker</h2>
          {state.running && <span className="chip border-steam/30 bg-steam/10 text-steam">Checking…</span>}
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Checks each account one at a time via Steam's <code className="text-slate-400">GetPlayerBans</code> API using
          one of the API keys from Global Config. If any ban is detected a Discord notification is sent (if configured).
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Tip tip="When active, the checker runs in the background, checking one bot at a time until you press Stop" block>
            <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
              <span className="text-xs font-semibold text-slate-300">AutoCheck</span>
              <Toggle checked={!!form.autoCheck} onChange={(v) => save({ autoCheck: v })} />
            </div>
          </Tip>
          <Tip tip={hasProxies ? 'Use a random proxy from Proxy Manager for the ban-check requests' : 'No proxies imported - import some in Proxy Manager to enable this'} block>
            <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
              <span className="text-xs font-semibold text-slate-300">Proxy</span>
              <Toggle checked={!!form.useProxy} disabled={!hasProxies} onChange={(v) => save({ useProxy: v })} />
            </div>
          </Tip>
          <Tip tip="Delay between each account check, in seconds (minimum 1)" block>
            <div>
              <label className="label">Delay between checks (sec)</label>
              <input
                type="number"
                min="1"
                className="input"
                value={form.delaySeconds}
                onChange={(e) => setForm((f) => ({ ...f, delaySeconds: e.target.value }))}
                onBlur={() => save({ delaySeconds: Number(form.delaySeconds) || 1 })}
              />
            </div>
          </Tip>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <Tip
            tip={
              form.autoCheck
                ? 'AutoCheck is active - the checker already runs in the background'
                : 'Check all accounts one at a time, respecting the delay set above. Runs in the background - use Stop to abort.'
            }
            block
          >
            <button className="btn-success" disabled={busy || state.running || form.autoCheck} onClick={runAll}>
              {busy || state.running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />} Start
            </button>
          </Tip>
          <Tip tip="Stop the background checker and any running sweep" block>
            <button className="btn-danger" disabled={!form.autoCheck && !state.running} onClick={stopAll}>
              <Square size={14} /> Stop
            </button>
          </Tip>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-bold text-white">Accounts ({names.length})</h3>
        {names.length === 0 ? (
          <p className="text-xs text-slate-500">No bots imported yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {names.map((n) => {
              const s = status[n];
              const banned = s && s.state === 'banned';
              return (
                <div key={n} className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
                  <span className="truncate font-mono text-xs text-slate-300">{n}</span>
                  {banned ? (
                    <span className="flex items-center gap-1.5">
                      <span className="chip border-rose-500/40 bg-rose-500/15 text-rose-300">BANNED</span>
                      {s.at && <span className="font-mono text-[10px] text-slate-500">{checkDate(s.at)}</span>}
                    </span>
                  ) : s && s.state === 'error' ? (
                    <span className="flex items-center gap-1.5">
                      <span className="chip border-amber-400/40 bg-amber-400/10 text-amber-300">ERROR</span>
                      {s.at && <span className="font-mono text-[10px] text-slate-500">{checkDate(s.at)}</span>}
                    </span>
                  ) : s && s.state === 'clear' ? (
                    <span className="flex items-center gap-1.5">
                      <span className="chip border-emerald-400/30 bg-emerald-400/10 text-emerald-300">CLEAR</span>
                      {s.at && <span className="font-mono text-[10px] text-slate-500">{checkDate(s.at)}</span>}
                    </span>
                  ) : (
                    <span className="chip border-white/10 bg-night-800 text-slate-500">NOT CHECKED</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
