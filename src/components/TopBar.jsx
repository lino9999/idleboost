import Tip from './Tip';
import { useApp } from '../App';

const TITLES = {
  dashboard: 'Dashboard',
  storage: 'Storage Accounts',
  profile: 'Steam Profile',
  automation: 'Automation',
  banchecker: 'AutoBan Checker',
  database: 'Database',
  importers: 'Importers & 2FA',
  proxies: 'Proxy Manager',
  config: 'Global Config (ASF.json)',
  console: 'Console'
};

export default function TopBar({ view }) {
  const { standby } = useApp();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.06] bg-night-900/70 px-6 backdrop-blur">
      <h1 className="text-lg font-bold text-white">{TITLES[view] || 'Steam Warming UP'}</h1>
      <div className="flex items-center gap-2.5">
        {standby && (
          <Tip tip="Standby Mode: Steam appears down or under maintenance. Rotation paused, heavy actions disabled." side="bottom">
            <span className="chip animate-pulse-slow border-amber-400/40 bg-amber-400/10 text-amber-300">STANDBY</span>
          </Tip>
        )}
      </div>
    </header>
  );
}
