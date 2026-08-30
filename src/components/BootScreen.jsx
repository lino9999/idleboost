import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { asf } from '../lib/api';

export default function BootScreen({ status }) {
  const [upd, setUpd] = useState(null);

  useEffect(() => {
    let alive = true;
    asf.updaterGet().then((s) => alive && setUpd(s)).catch(() => {});
    const off = asf.onUpdater((s) => alive && setUpd(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const running = !!(status && status.running);
  const ipc = !!(status && status.ipcReachable);
  const updating = !!(upd && (upd.busy || upd.restartScheduled));

  let stage = 'Preparing the application…';
  if (!running) stage = 'Starting ArchiSteamFarm…';
  else if (!ipc) stage = 'Waiting for the ASF IPC server to come online…';
  else if (upd && upd.restartScheduled) stage = 'Applying ASF update - restarting soon…';
  else if (upd && upd.busy) stage = 'Checking for ASF / plugin updates…';
  else stage = 'Loading your dashboard…';

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-night-950">
      <h1 className="text-3xl font-bold tracking-wide text-white">Steam Warming UP</h1>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.25em] text-slate-500">ASF Control Center</p>
      <div className="mt-10 h-1 w-72 overflow-hidden rounded-full bg-night-800">
        <div
          className="h-full w-1/3 rounded-full bg-gradient-to-r from-steam to-grape"
          style={{ animation: 'bootbar 1.5s ease-in-out infinite' }}
        />
      </div>
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        {updating && <RefreshCw size={13} className="animate-spin text-steam" />}
        {stage}
      </p>
      {updating && (
        <p className="mt-2 text-[11px] text-steam">
          {upd.restartScheduled
            ? 'An ASF update is being applied - ASF will restart automatically.'
            : 'Keeping ASF and plugins up to date (FreePackages excluded)…'}
        </p>
      )}
    </div>
  );
}
