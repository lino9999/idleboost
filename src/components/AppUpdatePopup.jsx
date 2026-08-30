import { useEffect, useState } from 'react';
import { Download, PackageOpen, RefreshCw, X } from 'lucide-react';
import { asf } from '../lib/api';

const fmt = (v) => String(v || '').replace(/\.0$/g, '') || String(v || '');

export default function AppUpdatePopup() {
  const [state, setState] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    asf.appUpdateGet().then((s) => { if (alive) setState(s); }).catch(() => {});
    const off = asf.onAppUpdate((s) => { if (alive) setState(s); });
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (dismissed || !state) return null;
  const { status, version, assetUrl, releaseUrl, progress, error, currentVersion } = state;
  if (status !== 'available' && status !== 'downloading' && !(status === 'error' && version)) return null;

  const onInstall = async () => {
    try {
      const res = await asf.appUpdateInstall();
      if (res && res.openExternal) {
        asf.openExternal(res.openExternal);
      }
    } catch {
      /* errors arrive through the state stream */
    }
  };

  return (
    <div className="fixed right-4 top-4 z-[1100] w-80 rounded-xl border border-steam/40 bg-night-800/95 p-4 shadow-2xl shadow-black/60 backdrop-blur">
      <div className="mb-2 flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-steam/15 text-steam">
          <PackageOpen size={16} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-white">New version available</div>
          <div className="mt-0.5 text-[11px] leading-snug text-slate-400">
            IdleBoost <span className="font-semibold text-steam">v{fmt(version)}</span> is out (you have v{fmt(currentVersion)}).
            Download the latest release to get new features and fixes.
          </div>
        </div>
        <button
          className="ml-auto shrink-0 rounded-md p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
          onClick={() => setDismissed(true)}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>

      {status === 'downloading' && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <RefreshCw size={11} className="animate-spin text-steam" /> Downloading update…
            </span>
            <span className="font-mono">{progress >= 0 ? `${progress}%` : '…'}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-night-950">
            <div
              className="h-full rounded-full bg-gradient-to-r from-steam to-grape transition-[width] duration-300"
              style={{ width: `${Math.max(4, progress >= 0 ? progress : 4)}%` }}
            />
          </div>
        </div>
      )}

      {status === 'error' && (
        <p className="mb-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
          {error || 'Update failed.'} You can retry below.
        </p>
      )}

      {status !== 'downloading' && (
        <div className="flex items-center gap-2">
          {assetUrl ? (
            <button className="btn-primary flex-1" onClick={onInstall}>
              <Download size={14} /> Download &amp; Install
            </button>
          ) : (
            <button className="btn-primary flex-1" onClick={() => asf.openExternal(releaseUrl)}>
              <Download size={14} /> Open GitHub release
            </button>
          )}
          <button className="btn-ghost" onClick={() => setDismissed(true)}>
            Later
          </button>
        </div>
      )}
    </div>
  );
}
