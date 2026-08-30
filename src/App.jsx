import { Component, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, RefreshCw, XCircle } from 'lucide-react';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import BootScreen from './components/BootScreen';
import AppUpdatePopup from './components/AppUpdatePopup';
import Dashboard from './views/Dashboard';
import Storage from './views/Storage';
import SteamProfile from './views/SteamProfile';
import Automation from './views/Automation';
import BanChecker from './views/BanChecker';
import DataBrowser from './views/DataBrowser';
import Importers from './views/Importers';
import Proxies from './views/Proxies';
import GlobalConfig from './views/GlobalConfig';
import Console from './views/Console';
import { asf } from './lib/api';

export const AppCtx = createContext({ status: null, standby: false, toast: () => {} });
export const useApp = () => useContext(AppCtx);

const VIEWS = {
  dashboard: Dashboard,
  storage: Storage,
  profile: SteamProfile,
  automation: Automation,
  banchecker: BanChecker,
  database: DataBrowser,
  importers: Importers,
  proxies: Proxies,
  config: GlobalConfig,
  console: Console
};

const TOAST_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warn: AlertTriangle,
  info: Info
};

const TOAST_COLORS = {
  success: 'border-emerald-400/40 text-emerald-200',
  error: 'border-rose-400/40 text-rose-200',
  warn: 'border-amber-400/40 text-amber-200',
  info: 'border-steam/40 text-slate-200'
};

class ViewErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ViewErrorBoundary]', error, info && info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = (this.state.error && this.state.error.message) || String(this.state.error);
    return (
      <div className="card m-auto mt-16 max-w-lg border-rose-400/30 bg-rose-400/[0.06] p-6 text-sm text-rose-200">
        <div className="mb-2 flex items-center gap-2 font-bold">
          <AlertTriangle size={17} /> This section failed to render
        </div>
        <p className="mb-4 break-words text-xs text-rose-200/80">{message}</p>
        <button className="btn-primary" onClick={() => this.setState({ error: null })}>
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    );
  }
}

function Toasts({ items }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex w-96 flex-col gap-2">
      {items.map((t) => {
        const Icon = TOAST_ICONS[t.type] || Info;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border bg-night-800/95 px-3 py-2.5 text-sm shadow-xl shadow-black/40 backdrop-blur ${TOAST_COLORS[t.type] || TOAST_COLORS.info}`}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <span className="break-words">{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function StandbyBanner({ reason }) {
  return (
    <div className="flex items-center gap-2 border-b border-amber-400/30 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-transparent px-6 py-2 text-sm text-amber-200">
      <AlertTriangle size={16} className="animate-pulse-slow shrink-0" />
      <span className="font-semibold">Standby Mode active.</span>
      <span className="text-amber-200/80">
        {reason || 'Steam connection problem detected.'} Bot warming and API-heavy actions are temporarily paused.
        Normal operation resumes automatically when the Steam connection is restored.
      </span>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('dashboard');
  const [status, setStatus] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [booted, setBooted] = useState(false);

  const toast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-4), { id, message, type }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    let alive = true;
    asf.status().then((s) => { if (alive && s) setStatus(s); }).catch(() => {});
    const offStatus = asf.onStatus((s) => alive && s && setStatus(s));
    const offStandby = asf.onStandby((s) =>
      setStatus((cur) => ({ ...(cur || {}), standby: s.standby, standbyReason: s.reason }))
    );
    return () => {
      alive = false;
      offStatus();
      offStandby();
    };
  }, []);

  useEffect(() => {
    if (!booted && status && status.ipcReachable) setBooted(true);
  }, [booted, status]);

  useEffect(() => {
    const t = setTimeout(() => setBooted(true), 45000);
    return () => clearTimeout(t);
  }, []);

  const standby = !!(status && status.standby);
  const View = VIEWS[view] || Dashboard;

  if (!booted) {
    return (
      <AppCtx.Provider value={{ status, standby, toast }}>
        <BootScreen status={status} />
      </AppCtx.Provider>
    );
  }

  return (
    <AppCtx.Provider value={{ status, standby, toast }}>
      <div className="flex h-screen overflow-hidden bg-night-950">
        <Sidebar view={view} setView={setView} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar view={view} />
          {standby && <StandbyBanner reason={status && status.standbyReason} />}
          <main className="flex-1 overflow-y-auto p-6">
            <ViewErrorBoundary key={view}>
              <View />
            </ViewErrorBoundary>
          </main>
        </div>
        <Toasts items={toasts} />
        <AppUpdatePopup />
      </div>
    </AppCtx.Provider>
  );
}
