import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Globe, Loader2, Shuffle, Trash2, Upload, XCircle } from 'lucide-react';
import Tip from '../components/Tip';
import { asf } from '../lib/api';
import { parseProxyList, formatProxy } from '../lib/proxyFormat';
import { useApp } from '../App';

export default function Proxies() {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [assignments, setAssignments] = useState(null);
  const [current, setCurrent] = useState({});
  const [bots, setBots] = useState({});

  const refresh = useCallback(async () => {
    try {
      const [saved, botData] = await Promise.all([asf.proxyList(), asf.getBots()]);
      setCurrent(saved || {});
      setBots(botData || {});
    } catch {
      /* ASF may be offline; keep showing stored assignments */
      try {
        setCurrent((await asf.proxyList()) || {});
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const { proxies, invalid } = useMemo(() => parseProxyList(text), [text]);

  const assign = async () => {
    setBusy(true);
    setAssignments(null);
    try {
      const res = await asf.proxyBulkAssign({ proxies });
      setAssignments(res);
      const withProxy = res.assignments.filter((a) => a.proxy).length;
      toast(
        `Assigned ${withProxy} proxy(ies) to ${res.bots} bot(s)${res.proxies < res.bots ? ' (some proxies reused)' : ''}`,
        'success'
      );
      setText('');
      refresh();
    } catch (e) {
      toast(e.message || 'Failed to assign proxies', 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeOne = async (botName) => {
    setBusy(true);
    try {
      await asf.proxyApply({ botName, proxy: null });
      toast(`Proxy removed from ${botName}`, 'success');
      refresh();
    } catch (e) {
      toast(e.message || 'Failed to remove proxy', 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeAll = async () => {
    if (!window.confirm('Remove proxies from all bots?')) return;
    setBusy(true);
    try {
      await asf.proxyRemoveAll();
      toast('All proxies removed', 'success');
      refresh();
    } catch (e) {
      toast(e.message || 'Failed to remove proxies', 'error');
    } finally {
      setBusy(false);
    }
  };

  const botNames = Object.keys(bots).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center justify-center gap-1 py-2">
        <button
          onClick={() => asf.openExternal('https://suborbit.al/landing?r=Lino')}
          className="group inline-flex items-center justify-center rounded-xl transition-transform duration-200 hover:scale-105"
        >
          <img
            src="https://fastfiledelivery.com/logo.png"
            alt="Recommended proxies"
            className="h-14 w-auto object-contain drop-shadow transition-opacity group-hover:opacity-90"
          />
        </button>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">tested and recommended proxies</span>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <div className="mb-1 flex items-center gap-2">
            <Upload size={17} className="text-steam" />
            <h2 className="text-base font-bold text-white">Mass Proxy Import</h2>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            One proxy per line, format <code className="text-slate-300">username:password@host:port</code> (optional{' '}
            <code className="text-slate-300">http://</code> or <code className="text-slate-300">socks5://</code>{' '}
            prefix). Lines starting with # are ignored.
          </p>

          <Tip tip="Paste your proxy list here - one proxy per line" block>
            <textarea
              className="input h-44 resize-y font-mono text-xs"
              placeholder={'user1:pass1@host1:port\nuser2:pass2@host2:port\nsocks5://user3:pass3@host3:port'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Tip>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-500">
              <span className="text-emerald-300">{proxies.length} valid</span>
              {invalid.length > 0 && <span className="text-rose-300">, {invalid.length} invalid line(s)</span>}
              {' - '}
              {botNames.length} bot(s)
            </span>
            <div className="ml-auto">
              <Tip
                tip={
                  proxies.length === 0
                    ? 'Paste at least one valid proxy first'
                    : 'Randomly assign one proxy to each bot and enable the bandwidth saver'
                }
              >
                <button className="btn-primary" disabled={busy || proxies.length === 0} onClick={assign}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Shuffle size={15} />} Assign to bots
                </button>
              </Tip>
            </div>
          </div>

          {invalid.length > 0 && (
            <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-[11px] text-rose-300">
              Skipped invalid line(s): {invalid.slice(0, 3).map((l) => `"${l.slice(0, 40)}"`).join(', ')}
              {invalid.length > 3 ? `, … +${invalid.length - 3} more` : ''}
            </div>
          )}

          {assignments && (
            <div className="mt-4 max-h-48 space-y-1 overflow-y-auto">
              {assignments.assignments.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {a.ok ? (
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle size={14} className="mt-0.5 shrink-0 text-rose-400" />
                  )}
                  <span className={a.ok ? 'text-slate-300' : 'text-rose-300'}>
                    <span className="font-mono font-bold">{a.bot}</span>
                    {a.ok ? (a.proxy ? ` -> ${a.proxy}` : ' -> no proxy available') : ` - ${a.error}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-1 flex items-center gap-2">
            <Globe size={17} className="text-grape-soft" />
            <h2 className="text-base font-bold text-white">Current Assignments</h2>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Proxies currently written into bot configs. ASF hot-reloads config changes automatically.
          </p>

          {botNames.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No bots imported yet.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-lg border border-white/[0.06]">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-night-800 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Bot</th>
                    <th className="px-3 py-2">Proxy</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {botNames.map((name) => {
                    const p = current[name];
                    return (
                      <tr key={name} className="border-t border-white/[0.04]">
                        <td className="px-3 py-1.5 font-mono text-slate-300">{name}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-400">
                          {p ? `${formatProxy(p)}${p.username ? ` (${p.username})` : ''}` : <span className="text-slate-600">none</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {p && (
                            <Tip tip="Remove the proxy from this bot">
                              <button
                                className="btn-ghost !px-2 !py-0.5"
                                disabled={busy}
                                onClick={() => removeOne(name)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </Tip>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {botNames.length > 0 && (
            <div className="mt-3 text-right">
              <Tip tip="Remove proxies from every bot config">
                <button className="btn-danger" disabled={busy} onClick={removeAll}>
                  <Trash2 size={14} /> Remove all proxies
                </button>
              </Tip>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
