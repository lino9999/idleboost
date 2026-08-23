import { Archive, Cog, Database, FileDown, Globe, Hammer, LayoutGrid, Settings, Terminal, UserCircle2 } from 'lucide-react';
import Tip from './Tip';
import { asf } from '../lib/api';

function CogsIcon({ size = 17 }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <Cog size={Math.round(size * 0.72)} className="absolute left-0 top-0" />
      <Cog size={Math.round(size * 0.58)} className="absolute bottom-0 right-0" />
    </span>
  );
}

const ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid, tip: 'Bot overview, warming engine, wallet stats and quick actions' },
  { id: 'storage', label: 'Storage Accounts', icon: Archive, tip: 'Dedicated accounts that hold your items - they come online only to accept trades' },
  { id: 'profile', label: 'Steam Profile', icon: UserCircle2, tip: 'Set up profiles: avatar, country, public privacy' },
  { id: 'automation', label: 'Automation', icon: CogsIcon, tip: 'Free games redemption (limited-time + trading cards) and Achievement Manager' },
  { id: 'banchecker', label: 'AutoBan Checker', icon: Hammer, tip: 'Check every account for VAC / Community / Economy bans via the Steam Web API' },
  { id: 'database', label: 'Database', icon: Database, tip: 'Local SQLite database: inventories, wallet history and owned games for every account' },
  { id: 'importers', label: 'Importers', icon: FileDown, tip: 'Bulk import accounts and .maFile authenticators' },
  { id: 'proxies', label: 'Proxies', icon: Globe, tip: 'Bulk proxy import with random per-bot assignment' },
  { id: 'config', label: 'Global Config', icon: Settings, tip: 'Discord webhook and Steam API keys' },
  { id: 'console', label: 'Console', icon: Terminal, tip: 'Live ASF output (stdout and stderr)' }
];

export default function Sidebar({ view, setView }) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-white/[0.06] bg-night-900">
      <div className="px-5 pb-5 pt-6 leading-tight">
        <div className="text-[15px] font-bold tracking-wide text-white">IdleBoost</div>
        <div className="text-[10px] font-medium uppercase tracking-widest text-slate-500">Account Warmer</div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pt-2">
        {ITEMS.map(({ id, label, icon: Icon, tip }) => {
          const active = view === id;
          return (
            <Tip key={id} tip={tip} side="right" block>
              <button
                onClick={() => setView(id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-steam/15 text-steam ring-1 ring-steam/30'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                }`}
              >
                <Icon size={17} />
                {label}
              </button>
            </Tip>
          );
        })}
      </nav>

      <div className="px-3 pb-2 pt-3">
        <Tip tip="Open my Steam trade offer - any skin donation helps the project grow" block>
          <button
            className="donate-btn"
            onClick={() => asf.openExternal('https://steamcommunity.com/tradeoffer/new/?partner=184539136&token=-gLggeA0')}
          >
            <span>If you like the project, any skin donation helps the project grow</span>
          </button>
        </Tip>
      </div>

      <div className="px-3 py-3 text-center text-[10px] text-slate-600">
        Made with love by{' '}
        <button
          className="font-semibold text-slate-500 underline decoration-dotted underline-offset-2 transition-colors hover:text-steam"
          onClick={() => asf.openExternal('https://telegram.me/lino9999')}
        >
          Lino
        </button>
      </div>
    </aside>
  );
}
