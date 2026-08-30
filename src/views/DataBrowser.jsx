import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Database, Gamepad2, RefreshCw, Search, Trash2, X } from 'lucide-react';
import Tip from '../components/Tip';
import { asf } from '../lib/api';
import { currencyCode, formatWallet } from '../lib/format';
import { useApp } from '../App';

function StatCard({ icon: Icon, label, value, tip }) {
  return (
    <Tip tip={tip} block>
      <div className="card flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-steam/10 text-steam">
          <Icon size={18} />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
          <div className="text-lg font-bold text-white">{value}</div>
        </div>
      </div>
    </Tip>
  );
}

function BotDetail({ name, onClose }) {
  const { toast } = useApp();
  const [detail, setDetail] = useState(null);
  const [games, setGames] = useState([]);
  const [tab, setTab] = useState('games');
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, g] = await Promise.all([asf.dbBot(name), asf.dbGames(name)]);
      setDetail(d);
      setGames(g || []);
    } catch (e) {
      toast(e.message || 'Failed to load bot data', 'error');
    }
  }, [name, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const bot = detail && detail.bot;
  const history = (detail && detail.history) || [];
  const q = filter.trim().toLowerCase();
  const filteredGames = games.filter((g) => !q || String(g.name).toLowerCase().includes(q) || String(g.app_id).includes(q));

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-2xl animate-drawer-in flex-col border-l border-white/10 bg-night-850 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
          <h3 className="text-base font-bold text-white">{name}</h3>
          {bot && bot.is_storage ? <span className="chip border-steam/40 bg-steam/15 text-steam">STORAGE ACCOUNT</span> : null}
          {bot ? (
            <span className="chip border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
              {formatWallet(bot.wallet_balance, bot.wallet_currency) || '0.00'} {currencyCode(bot.wallet_currency)}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Tip tip="Reload this bot's data from the local database">
              <button className="btn-ghost" onClick={load}>
                <RefreshCw size={14} />
              </button>
            </Tip>
            <Tip tip="Close (Esc)">
              <button className="btn-ghost" onClick={onClose}>
                <X size={15} />
              </button>
            </Tip>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-5">
          <div className="mb-4 flex items-center gap-2">
            <button className={`rounded-full border px-3 py-1 text-xs font-semibold ${tab === 'games' ? 'border-steam/40 bg-steam/15 text-steam' : 'border-white/10 bg-night-800 text-slate-400'}`} onClick={() => setTab('games')}>
              Games ({games.length})
            </button>
            <button className={`rounded-full border px-3 py-1 text-xs font-semibold ${tab === 'wallet' ? 'border-steam/40 bg-steam/15 text-steam' : 'border-white/10 bg-night-800 text-slate-400'}`} onClick={() => setTab('wallet')}>
              Wallet history ({history.length})
            </button>
            <div className="relative ml-auto w-56">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input className="input pl-8 text-xs" placeholder="Filter..." value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/[0.06]">
            {tab === 'games' && (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-night-800 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Game</th>
                    <th className="px-3 py-2">App ID</th>
                    <th className="px-3 py-2">Cards left</th>
                    <th className="px-3 py-2">Hours played</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGames.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">No games stored yet - games are synced automatically for accounts whose profile is set to public.</td></tr>
                  )}
                  {filteredGames.map((g) => (
                    <tr key={g.app_id} className="border-t border-white/[0.04]">
                      <td className="px-3 py-1.5 text-slate-300">{g.name || `App ${g.app_id}`}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-400">{g.app_id}</td>
                      <td className="px-3 py-1.5 text-slate-400">{g.cards_remaining}</td>
                      <td className="px-3 py-1.5 text-slate-400">{Number(g.hours_played).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'wallet' && (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-night-800 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Balance</th>
                    <th className="px-3 py-2">Currency</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-500">No wallet snapshots yet.</td></tr>
                  )}
                  {history.map((h, i) => (
                    <tr key={i} className="border-t border-white/[0.04]">
                      <td className="px-3 py-1.5 text-slate-400">{new Date(h.ts).toLocaleString()}</td>
                      <td className="px-3 py-1.5 font-bold text-emerald-300">{formatWallet(h.balance, h.currency) || h.balance}</td>
                      <td className="px-3 py-1.5 text-slate-500">{currencyCode(h.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DataBrowser() {
  const { toast } = useApp();
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [syncState, setSyncState] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, t, s] = await Promise.all([asf.dbOverview(), asf.dbTotals(), asf.dbSyncState()]);
      setRows(o || []);
      setTotals(t);
      setSyncState(s);
    } catch (e) {
      toast(e.message || 'Failed to load database', 'error');
    }
  }, [toast]);

  useEffect(() => {
    load();
    const off = asf.onDbSync(() => load());
    return () => off();
  }, [load]);

  const resetDb = async () => {
    if (!window.confirm('Reset the local database? This permanently deletes all stored bots, games, inventories and history.')) return;
    setBusy(true);
    try {
      await asf.dbReset();
      await load();
      toast('Local database reset', 'success');
    } catch (e) {
      toast(e.message || 'Failed to reset database', 'error');
    } finally {
      setBusy(false);
    }
  };

  const q = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) => !q || r.name.toLowerCase().includes(q) || String(r.steam_login || '').toLowerCase().includes(q) || String(r.steam_id || '').includes(q)
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        <StatCard icon={Database} label="Bots stored" value={totals ? totals.bots : '—'} tip="Bot accounts recorded in the local SQLite database" />
        <StatCard icon={Gamepad2} label="Game records" value={totals ? totals.games : '—'} tip="Owned games stored across all accounts" />
        <StatCard icon={Archive} label="Storage accounts" value={rows.filter((r) => r.storage).length} tip="Accounts marked as item storage" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tip tip="Search by bot name, login or SteamID" block>
          <div className="relative w-80">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="input pl-9" placeholder="Search accounts..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </Tip>
        <div className="ml-auto flex items-center gap-3">
          {syncState && (
            <span className="text-xs text-slate-500">
              {syncState.syncing ? 'Syncing...' : syncState.lastSyncAt ? `Last sync: ${new Date(syncState.lastSyncAt).toLocaleString()}` : 'Never synced'}
            </span>
          )}
          <Tip tip="Delete all stored data from the local database">
            <button className="btn-danger" disabled={busy} onClick={resetDb}>
              <Trash2 size={14} /> Reset database
            </button>
          </Tip>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card flex h-56 flex-col items-center justify-center gap-2 text-slate-500">
          <Database size={26} />
          <p className="text-sm">No data yet. Data is collected automatically while ASF is running with connected bots.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-night-800 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Bot</th>
                <th className="px-3 py-2">SteamID</th>
                <th className="px-3 py-2">Wallet</th>
                <th className="px-3 py-2">Games</th>
                <th className="px-3 py-2">Cards left</th>
                <th className="px-3 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.name}
                  className={`cursor-pointer border-t border-white/[0.04] transition-colors hover:bg-white/[0.03] ${selected === r.name ? 'bg-steam/[0.07]' : ''}`}
                  onClick={() => setSelected(selected === r.name ? null : r.name)}
                >
                  <td className="px-3 py-2">
                    <span className="font-mono font-bold text-white">{r.name}</span>
                    {r.storage && <span className="ml-2 chip border-steam/40 bg-steam/15 text-[10px] text-steam">STORAGE</span>}
                    {r.nickname ? <span className="ml-2 text-slate-500">{r.nickname}</span> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-400">{r.steam_id || '—'}</td>
                  <td className="px-3 py-2 font-bold text-emerald-300">
                    {Number(r.wallet_balance) > 0 ? formatWallet(r.wallet_balance, r.wallet_currency) || '—' : '—'}
                    {Number(r.wallet_balance) > 0 && r.wallet_currency ? <span className="ml-1 text-[10px] font-medium text-slate-500">{currencyCode(r.wallet_currency)}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{r.games}</td>
                  <td className="px-3 py-2 text-slate-300">{r.cards}</td>
                  <td className="px-3 py-2 text-slate-500">{r.last_seen ? new Date(r.last_seen).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <BotDetail name={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
