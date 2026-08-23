import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRightLeft, CheckCheck, Link2, Loader2, PlayCircle, Search, ShieldCheck, Timer, XCircle } from 'lucide-react';
import Tip from '../components/Tip';
import Toggle from '../components/Toggle';
import { asf } from '../lib/api';
import { formatMs } from '../lib/format';
import { useApp } from '../App';

const ASSET_TYPES = [
  [1, 'Booster Packs'],
  [2, 'Emoticons'],
  [3, 'Foil Cards'],
  [4, 'Backgrounds'],
  [5, 'Trading Cards'],
  [6, 'Steam Gems'],
  [7, 'Sale Items'],
  [8, 'Consumables'],
  [10, 'Stickers'],
  [12, 'Mini Profiles'],
  [13, 'Avatar Frames']
];

const APP_GAMES = [
  [730, 'Counter-Strike 2'],
  [440, 'Team Fortress 2']
];

function BotRow({ name, bot, account, isStorage, disabled, onToggle }) {
  const nickname = (bot && bot.AccountInfo && bot.AccountInfo.Nickname) || (bot && bot.Nickname) || '';
  const connected = !!(bot && bot.IsConnectedAndLoggedOn);
  const online = (account && account.online) || connected;
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${isStorage ? 'border-steam/30 bg-steam/[0.07]' : 'border-white/[0.06] bg-night-800/70'}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-400' : 'bg-slate-500'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs font-bold text-white">{name}</span>
          {isStorage && <span className="chip border-steam/40 bg-steam/15 text-[10px] text-steam">STORAGE</span>}
        </div>
        {nickname && <div className="truncate text-[11px] text-slate-500">{nickname}</div>}
        {isStorage && account && (
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
            {account.tradeLink ? (
              <span className="flex items-center gap-1 text-emerald-300/80">
                <Link2 size={10} /> trade link saved
              </span>
            ) : (
              <span className="text-amber-300/80">no trade link set</span>
            )}
          </div>
        )}
      </div>
      <Tip
        tip={
          isStorage
            ? 'Remove this account from the storage pool'
            : 'Make this account a storage account: you paste its trade link, it is saved to the database and used to deliver trades'
        }
      >
        <Toggle checked={isStorage} disabled={disabled} onChange={() => onToggle(name, !isStorage)} />
      </Tip>
    </div>
  );
}

export default function Storage() {
  const { standby, toast } = useApp();
  const [bots, setBots] = useState({});
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ minDelayMinutes: 30, maxDelayMinutes: 120, assetTypes: [1, 3, 5], apps: [] });
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const [pendingStorage, setPendingStorage] = useState(null);
  const [tradeLinkInput, setTradeLinkInput] = useState('');

  useEffect(() => {
    asf.getBots().then((b) => setBots(b || {})).catch(() => {});
    asf.storageGet().then((s) => {
      if (!s) return;
      setState(s);
      setForm({
        minDelayMinutes: s.config.minDelayMinutes,
        maxDelayMinutes: s.config.maxDelayMinutes,
        assetTypes: s.config.assetTypes,
        apps: s.config.apps || []
      });
    }).catch(() => {});
    const off = asf.onStorage((s) => setState(s));
    return () => off();
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const refreshBots = useCallback(async () => {
    try {
      setBots((await asf.getBots()) || {});
    } catch {
      /* ASF offline */
    }
  }, []);

  useEffect(() => {
    const iv = setInterval(refreshBots, 10000);
    return () => clearInterval(iv);
  }, [refreshBots]);

  const accountNames = useMemo(() => new Set((state && state.config && state.config.accounts) || []), [state]);
  const accounts = (state && state.accounts) || [];
  const accountByName = useMemo(() => {
    const map = {};
    for (const a of accounts) map[a.name] = a;
    return map;
  }, [accounts]);
  const botNames = useMemo(() => Object.keys(bots).sort((a, b) => a.localeCompare(b)), [bots]);
  const filteredNames = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return botNames;
    return botNames.filter((n) => n.toLowerCase().includes(q));
  }, [botNames, search]);
  const activeCount = botNames.filter((n) => {
    const b = bots[n];
    return !accountNames.has(n) && b && (b.BotConfig ? b.BotConfig.Enabled !== false : true) && (b.IsConnectedAndLoggedOn || b.KeepRunning === true);
  }).length;

  const toggleStorage = async (name, on) => {
    if (on) {
      setTradeLinkInput('');
      setPendingStorage(name);
      return;
    }
    setBusy(true);
    try {
      const next = [...accountNames].filter((n) => n !== name);
      await asf.storageSetAccounts(next);
      toast(`${name} removed from storage accounts`, 'success');
    } catch (e) {
      toast(e.message || 'Failed to update storage accounts', 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmTradeLink = async () => {
    const trimmed = String(tradeLinkInput).trim();
    if (!/partner=/.test(trimmed) || !/[?&]token=[A-Za-z0-9_-]+/.test(trimmed)) {
      toast('Invalid trade link - it must be a Steam trade offer URL containing partner and token', 'error');
      return;
    }
    const name = pendingStorage;
    setBusy(true);
    try {
      const next = [...accountNames, name];
      await asf.storageSetAccounts(next);
      await asf.storageSetTradeLink(name, trimmed);
      toast(`${name} is now a storage account - trade link saved`, 'success');
      setPendingStorage(null);
      setTradeLinkInput('');
    } catch (e) {
      toast(e.message || 'Failed to set storage account', 'error');
    } finally {
      setBusy(false);
    }
  };

  const persist = async (patch) => {
    try {
      await asf.storageSetConfig(patch);
    } catch (e) {
      toast(e.message || 'Failed to save storage settings', 'error');
    }
  };

  const blurNumber = (key) => {
    persist({ [key]: Number(form[key]) });
  };

  const toggleType = (id) => {
    setForm((f) => {
      const has = f.assetTypes.includes(id);
      const next = has ? f.assetTypes.filter((t) => t !== id) : [...f.assetTypes, id];
      const apps = f.apps;
      if (next.length === 0 && apps.length === 0) return f;
      persist({ assetTypes: next });
      return { ...f, assetTypes: next };
    });
  };

  const toggleApp = (id) => {
    setForm((f) => {
      const has = f.apps.includes(id);
      const next = has ? f.apps.filter((a) => a !== id) : [...f.apps, id];
      if (next.length === 0 && f.assetTypes.length === 0) return f;
      persist({ apps: next });
      return { ...f, apps: next };
    });
  };

  const startTransfer = async () => {
    if (!window.confirm('Schedule item transfers from all active bots to the storage accounts? Transfers are spread over the configured time window.')) return;
    setBusy(true);
    try {
      const count = await asf.storageTransfer();
      toast(`Transfer scheduled for ${count} bot(s) - check the queue below`, 'success');
    } catch (e) {
      toast(e.message || 'Failed to schedule transfers', 'error');
    } finally {
      setBusy(false);
    }
  };

  const acceptTrades = async () => {
    if (!window.confirm('Bring every storage account online so they accept all incoming trades? They are confirmed automatically via their .maFile and go back offline after 10 minutes.')) return;
    setBusy(true);
    try {
      await asf.storageAcceptTrades();
      toast('Storage accounts are online and accepting trades now', 'success');
    } catch (e) {
      toast(e.message || 'Failed to start trade acceptance', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelTransfer = async () => {
    if (!window.confirm('Cancel all pending item transfers?')) return;
    setBusy(true);
    try {
      await asf.storageCancel();
      toast('Transfer schedule cancelled', 'success');
    } catch (e) {
      toast(e.message || 'Failed to cancel transfers', 'error');
    } finally {
      setBusy(false);
    }
  };

  const queue = (state && state.queue) || [];
  const recent = (state && state.recent) || [];
  const running = !!(state && state.running);
  const accepting = !!(state && state.accepting);
  const acceptingUntil = (state && state.acceptingUntil) || 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <div className="space-y-5 xl:col-span-2">
          <div className="card p-5">
            <div className="mb-1 flex items-center gap-2">
              <Archive size={17} className="text-steam" />
              <h2 className="text-base font-bold text-white">Storage Accounts</h2>
              <span className="chip border-white/10 bg-night-800 text-slate-400">{accountNames.size} selected</span>
            </div>
            <p className="mb-4 text-xs text-slate-500">
              Toggle which imported accounts act as item storage. When you enable one, you paste its Steam trade link; it
              is saved to the database and used to deliver trades. Storage accounts stay offline and come online only to
              accept trades.
            </p>
            <div className="relative mb-3">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-8 text-xs"
                placeholder="Search account by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {botNames.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No bots imported yet.</p>
            ) : filteredNames.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">No account matches "{search}".</p>
            ) : (
              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {filteredNames.map((n) => (
                  <BotRow
                    key={n}
                    name={n}
                    bot={bots[n]}
                    account={accountByName[n]}
                    isStorage={accountNames.has(n)}
                    disabled={busy}
                    onToggle={toggleStorage}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5 xl:col-span-3">
          <div className="card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Timer size={17} className="text-grape-soft" />
              <h2 className="text-base font-bold text-white">Transfer Schedule</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Tip tip="Minimum random delay between two consecutive transfers, in minutes. Saves automatically." block>
                <div>
                  <label className="label">Min delay between transfers (minutes)</label>
                  <input
                    type="number"
                    min="1"
                    className="input"
                    value={form.minDelayMinutes}
                    onChange={(e) => setForm((f) => ({ ...f, minDelayMinutes: e.target.value }))}
                    onBlur={() => blurNumber('minDelayMinutes')}
                  />
                </div>
              </Tip>
              <Tip tip="Maximum random delay between two consecutive transfers, in minutes. Saves automatically." block>
                <div>
                  <label className="label">Max delay between transfers (minutes)</label>
                  <input
                    type="number"
                    min="1"
                    className="input"
                    value={form.maxDelayMinutes}
                    onChange={(e) => setForm((f) => ({ ...f, maxDelayMinutes: e.target.value }))}
                    onBlur={() => blurNumber('maxDelayMinutes')}
                  />
                </div>
              </Tip>
            </div>

            <Tip tip="Steam item types transferred to storage. Selecting a game below expands the transfer to every lootable type. Changes save automatically." block>
              <div className="mt-4">
                <label className="label">Items to transfer</label>
                <div className="flex flex-wrap gap-1.5">
                  {ASSET_TYPES.map(([id, label]) => {
                    const on = form.assetTypes.includes(id);
                    return (
                      <button
                        key={id}
                        onClick={() => toggleType(id)}
                        className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                          on
                            ? 'border-steam/40 bg-steam/15 text-steam'
                            : 'border-white/10 bg-night-800 text-slate-400 hover:border-white/20'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {APP_GAMES.map(([id, label]) => {
                    const on = form.apps.includes(id);
                    return (
                      <button
                        key={id}
                        onClick={() => toggleApp(id)}
                        className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                          on
                            ? 'border-grape/50 bg-grape/15 text-grape-soft'
                            : 'border-white/10 bg-night-800 text-slate-400 hover:border-white/20'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Tip>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Tip
                tip={
                  accountNames.size === 0
                    ? 'Select at least one storage account first'
                    : standby
                      ? 'Disabled during Standby Mode'
                      : `Queue item transfers for ${activeCount} active bot(s), distributed randomly across the storage accounts, one at a time with random delays`
                }
              >
                <button
                  className="btn-success"
                  disabled={busy || running || standby || accountNames.size === 0 || queue.length > 0 || activeCount === 0}
                  onClick={startTransfer}
                >
                  {running ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
                  Transfer all items to storage
                </button>
              </Tip>
              <Tip
                tip={
                  accountNames.size === 0
                    ? 'Select at least one storage account first'
                    : accepting
                      ? 'Storage accounts are already accepting trades'
                      : 'Bring the storage accounts online for 10 minutes so they accept every incoming trade (auto-confirmed via .maFile)'
                }
              >
                <button className="btn-primary" disabled={busy || standby || accountNames.size === 0 || accepting} onClick={acceptTrades}>
                  {accepting ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                  {accepting ? `Accepting trades (${formatMs(Math.max(0, acceptingUntil - now))} left)` : 'Accept trades'}
                </button>
              </Tip>
              {queue.length > 0 && (
                <Tip tip="Cancel every pending transfer in the queue">
                  <button className="btn-danger" disabled={busy} onClick={cancelTransfer}>
                    <XCircle size={14} /> Cancel schedule
                  </button>
                </Tip>
              )}
            </div>

            <ul className="mt-4 space-y-1.5 text-xs text-slate-500">
              <li className="flex justify-between">
                <span>Storage accounts</span>
                <span className="font-bold text-steam">{accountNames.size}</span>
              </li>
              <li className="flex justify-between">
                <span>Active bots eligible for transfer</span>
                <span className="font-bold text-slate-200">{activeCount}</span>
              </li>
              <li className="flex justify-between">
                <span>Pending transfers</span>
                <span className="font-bold text-slate-200">{queue.length}</span>
              </li>
            </ul>
          </div>

          {queue.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <PlayCircle size={15} className="text-emerald-300" /> Transfer queue ({queue.length})
              </h3>
              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {queue.map((q, i) => {
                  const wait = Math.max(0, q.nextAt - now);
                  return (
                    <div key={`${q.bot}-${i}`} className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2 text-xs">
                      <span className="font-mono text-slate-300">
                        {q.bot} <span className="text-slate-500">→</span> <span className="text-steam">{q.storage}</span>
                      </span>
                      <span className="font-mono text-slate-500">{i === 0 ? (running ? 'running…' : 'now') : `in ${formatMs(wait)}`}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
              <ShieldCheck size={15} className="text-grape-soft" /> Recent transfers
            </h3>
            {recent.length === 0 ? (
              <p className="text-xs text-slate-500">No transfers yet. Schedule one above.</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto font-mono text-[11px]">
                {recent.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    {r.ok ? <ShieldCheck size={13} className="mt-0.5 shrink-0 text-emerald-400" /> : <XCircle size={13} className="mt-0.5 shrink-0 text-rose-400" />}
                    <span className={r.ok ? 'text-slate-400' : 'text-rose-300'}>
                      {new Date(r.at).toLocaleTimeString()}{' '}
                      {r.kind === 'accept' ? (
                        <span>
                          <span className="text-steam">{r.bot}</span> accepted incoming trades and went back offline
                        </span>
                      ) : (
                        <span>
                          {r.bot} → {r.storage}
                          {r.detail ? ` (${r.detail.slice(0, 120)})` : ''}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {pendingStorage && (
        <div
          className="fixed inset-0 z-[900] flex items-center justify-center bg-black/60 p-6"
          onClick={() => !busy && setPendingStorage(null)}
        >
          <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-2">
              <Link2 size={17} className="text-steam" />
              <h3 className="text-base font-bold text-white">Storage trade link</h3>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-slate-500">
              Paste the Steam trade link for <span className="font-mono text-slate-300">{pendingStorage}</span>. You can
              find it on Steam under Inventory → Trade Offers → "Who can send me trade offers?". It will be saved and used
              to deliver trades to this account.
            </p>
            <input
              className="input mb-3 font-mono text-xs"
              placeholder="https://steamcommunity.com/tradeoffer/new/?partner=...&token=..."
              value={tradeLinkInput}
              onChange={(e) => setTradeLinkInput(e.target.value)}
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <button className="btn-ghost" disabled={busy} onClick={() => setPendingStorage(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy || !tradeLinkInput.trim()} onClick={confirmTradeLink}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Save trade link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
