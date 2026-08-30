import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search, Users } from 'lucide-react';
import BotCard from '../components/BotCard';
import WarmingPanel from '../components/WarmingPanel';
import Tip from '../components/Tip';
import { asf } from '../lib/api';
import { botStatus, walletOf } from '../lib/bots';
import { currencyCode, formatWallet } from '../lib/format';
import { useApp } from '../App';

const FILTERS = [
  { id: 'all', label: 'All', tip: 'Show every imported bot' },
  { id: 'farming', label: 'Farming', tip: 'Bots currently farming trading cards' },
  { id: 'warming', label: 'Warming', tip: 'Bots connected and farming hours on games (not cards)' },
  { id: 'online', label: 'Online', tip: 'Bots connected to Steam but not farming right now' },
  { id: 'offline', label: 'Offline', tip: 'Bots that are stopped or disconnected' }
];

function StatCard({ label, value, sub }) {
  return (
    <div className="card flex h-full min-h-[96px] flex-col justify-center gap-1 p-4">
      <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="truncate text-2xl font-bold text-white">{value}</div>
      <div className="truncate text-xs text-slate-500">{sub || '\u00A0'}</div>
    </div>
  );
}

export default function Dashboard() {
  const { standby, toast } = useApp();
  const [bots, setBots] = useState({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [schedStats, setSchedStats] = useState({ unlockOps: 0, runs: 0 });
  const [gamesByBot, setGamesByBot] = useState({});
  const [avatarsByBot, setAvatarsByBot] = useState({});
  const [totalHours, setTotalHours] = useState(0);
  const [dbWallet, setDbWallet] = useState({});
  const [dbStats, setDbStats] = useState({});
  const [isStorageByName, setIsStorageByName] = useState({});
  const [rotInfo, setRotInfo] = useState({ activeCount: 0, maxActiveBots: 50 });

  const load = useCallback(async () => {
    try {
      const data = await asf.getBots();
      setBots(data || {});
      setError('');
    } catch (e) {
      setError(e.message || 'ASF IPC unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, standby ? 15000 : 5000);
    return () => clearInterval(iv);
  }, [load, standby]);

  useEffect(() => {
    let alive = true;
    asf
      .schedulerGet()
      .then((s) => alive && s && s.stats && setSchedStats(s.stats))
      .catch(() => {});
    const off = asf.onScheduler((s) => alive && s && s.stats && setSchedStats(s.stats));
    return () => {
      alive = false;
      off();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    asf
      .dbOverview()
      .then((rows) => {
        if (!alive) return;
        const map = {};
        const avatars = {};
        const walletMap = {};
        const storageMap = {};
        for (const r of rows || []) {
          map[r.name] = r.games;
          if (r.avatar_url) avatars[r.name] = r.avatar_url;
          const bal = Number(r.wallet_balance) || 0;
          const cur = Number(r.wallet_currency) || 0;
          if (cur > 0) walletMap[r.name] = { balance: bal, currency: cur };
          if (r.is_storage) storageMap[r.name] = true;
        }
        setGamesByBot(map);
        setAvatarsByBot(avatars);
        setDbWallet(walletMap);
        setIsStorageByName(storageMap);
      })
      .catch(() => {});
    asf
      .dbBotStats()
      .then((rows) => {
        if (!alive) return;
        const map = {};
        for (const r of rows || []) map[r.bot] = r;
        setDbStats(map);
      })
      .catch(() => {});
    asf
      .dbTotals()
      .then((t) => {
        if (!alive) return;
        setTotalHours((t && t.totalHours) || 0);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bots]);

  useEffect(() => {
    let alive = true;
    const upd = (s) => {
      if (!alive || !s) return;
      setRotInfo({
        activeCount: s.activeCount || 0,
        maxActiveBots: s.maxActiveBots || (s.config && s.config.maxActiveBots) || 50
      });
    };
    asf.rotationGet().then(upd).catch(() => {});
    const off = asf.onRotation(upd);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const list = useMemo(
    () => Object.entries(bots).map(([name, bot]) => ({ name, bot, status: botStatus(bot) })),
    [bots]
  );

  const counts = useMemo(() => {
    const c = { all: list.length, farming: 0, warming: 0, online: 0, offline: 0, error: 0 };
    for (const b of list) c[b.status] += 1;
    return c;
  }, [list]);

  const wallet = useMemo(() => {
    const sums = {};
    const counts = {};
    const liveByName = {};
    for (const { name, bot } of list) liveByName[name] = walletOf(bot);
    const names = new Set([...Object.keys(liveByName), ...Object.keys(dbWallet)]);
    for (const name of names) {
      const live = liveByName[name];
      const persisted = dbWallet[name];
      let w = null;
      if (live && Number(live.balance) > 0 && Number(live.currency) > 0) {
        w = live;
      } else if (persisted && Number(persisted.balance) > 0) {
        w = persisted;
      } else if (live && Number(live.currency) > 0) {
        w = { balance: 0, currency: live.currency };
      } else if (persisted) {
        w = persisted;
      }
      if (w && Number(w.currency) > 0) {
        const cur = w.currency;
        sums[cur] = (sums[cur] || 0) + Number(w.balance || 0);
        counts[cur] = (counts[cur] || 0) + 1;
      }
    }
    // Majority currency first: the one held by the most accounts, tie broken by total.
    // This way a single outlier currency never hijacks the dashboard total.
    return Object.entries(sums).sort((a, b) => {
      const ca = counts[a[0]] || 0;
      const cb = counts[b[0]] || 0;
      if (cb !== ca) return cb - ca;
      return b[1] - a[1];
    });
  }, [list, dbWallet]);

  const primary = wallet[0];
  const primaryText = primary ? formatWallet(primary[1], Number(primary[0])) || '—' : '—';
  const primaryCode = primary ? currencyCode(Number(primary[0])) : '';

  const visible = list.filter((b) => {
    if (filter !== 'all' && b.status !== filter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const nick = (b.bot.AccountInfo && b.bot.AccountInfo.Nickname) || '';
    return b.name.toLowerCase().includes(q) || nick.toLowerCase().includes(q);
  });

  const activeFull = rotInfo.activeCount >= rotInfo.maxActiveBots;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard
          label="Total Wallet Balance"
          value={primaryText}
          sub={primaryCode || 'No wallet data yet'}
        />
        <StatCard
          label="Total Bots"
          value={counts.all}
          sub={`${counts.online + counts.farming + counts.warming} connected`}
        />
        <StatCard
          label="Farming"
          value={counts.farming}
          sub="farming cards"
        />
        <StatCard
          label="Achievement Unlocks"
          value={schedStats.unlockOps}
          sub={`${schedStats.runs} auto-unlock run(s)`}
        />
        <StatCard
          label="Total Hours Farmed"
          value={Number(totalHours).toLocaleString('en-US')}
          sub="across all games"
        />
      </div>

      <WarmingPanel />

      <div className="flex flex-wrap items-center gap-3">
        <Tip tip="Search bots by config name or Steam nickname" block>
          <div className="relative w-80">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="input pl-9"
              placeholder="Search accounts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </Tip>

        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <Tip key={f.id} tip={f.tip}>
              <button
                onClick={() => setFilter(f.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filter === f.id
                    ? 'border-steam/40 bg-steam/15 text-steam'
                    : 'border-white/10 bg-night-800 text-slate-400 hover:border-white/20 hover:text-slate-200'
                }`}
              >
                {f.label} <span className="opacity-60">({counts[f.id]})</span>
              </button>
            </Tip>
          ))}
        </div>

        <div className="ml-auto">
          <Tip tip="Refresh the bot list immediately (auto-refreshes every 5s)">
            <button className="btn-ghost" onClick={() => load()}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
            </button>
          </Tip>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-slate-500">
          <Loader2 size={22} className="mr-2 animate-spin" /> Loading bots from ASF...
        </div>
      ) : visible.length === 0 ? (
        <div className="card flex h-64 flex-col items-center justify-center gap-2 text-slate-500">
          <Users size={28} />
          <p className="text-sm">
            {counts.all === 0
              ? 'No bots imported yet. Use the Importers view to add accounts.'
              : 'No bots match the current search/filter.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map(({ name, bot, status }) => (
            <BotCard key={name} name={name} bot={bot} status={status} standby={standby} ownedGames={gamesByBot[name]} dbAvatar={avatarsByBot[name]} dbWallet={dbWallet[name]} dbStats={dbStats[name]} isStorage={!!isStorageByName[name]} activeFull={activeFull} onChanged={load} toast={toast} />
          ))}
        </div>
      )}
    </div>
  );
}
