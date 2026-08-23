import { useEffect, useState } from 'react';
import { Loader2, UserCircle2, CheckCircle2, XCircle } from 'lucide-react';
import Tip from '../components/Tip';
import Toggle from '../components/Toggle';
import { asf } from '../lib/api';
import { formatMs } from '../lib/format';
import { useApp } from '../App';

const ACTION_LABELS = { avatar: 'Random avatar', region: 'Random country', public: 'Public profile' };

export default function SteamProfile() {
  const { standby, toast } = useApp();
  const [state, setState] = useState(null);
  const [form, setForm] = useState({
    enabled: false,
    doAvatar: true,
    doRegion: true,
    doPublic: true,
    staggerSeconds: 20
  });
  const [, setTick] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    asf.profileGet().then((s) => {
      if (!s) return;
      setState(s);
      setForm({
        enabled: !!s.config.enabled,
        doAvatar: s.config.doAvatar !== false,
        doRegion: s.config.doRegion !== false,
        doPublic: s.config.doPublic !== false,
        staggerSeconds: s.config.staggerSeconds || 20
      });
    }).catch(() => {});
    const off = asf.onProfile((s) => setState(s));
    return () => off();
  }, []);

  const save = async (key, value) => {
    const patch = { [key]: value };
    if (key === 'staggerSeconds') patch.staggerSeconds = Number(value) || 20;
    setForm((f) => ({ ...f, [key]: value }));
    try {
      await asf.profileSet(patch);
    } catch (e) {
      toast(e.message || 'Failed to save profile settings', 'error');
    }
  };

  const config = (state && state.config) || form;
  const running = !!(state && state.running);
  const recent = (state && state.recent) || [];
  const nextRunAt = state && state.nextRunAt;

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UserCircle2 size={17} className="text-steam" />
            <h2 className="text-base font-bold text-white">Profile Settings</h2>
            <span className={`chip ${config.enabled ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-slate-500/30 bg-slate-500/10 text-slate-400'}`}>
              {config.enabled ? 'Active' : 'Inactive'}
            </span>
            {running && <span className="chip border-steam/30 bg-steam/10 text-steam">Customizing…</span>}
            {!running && config.enabled && nextRunAt && (
              <span className="text-xs text-slate-500">Next in {formatMs(Math.max(0, nextRunAt - Date.now()))}</span>
            )}
          </div>
          <Tip tip={config.enabled ? 'Automatic customization is ON - one active account is customized every 5 minutes' : 'Automatic customization is OFF - nothing will be changed'}>
            <Toggle checked={!!form.enabled} onChange={(v) => save('enabled', v)} />
          </Tip>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Every change saves automatically. Enabled options are applied one active account at a time, every 5 minutes;
          an account is never touched again once customized.
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Tip tip="Set a random game avatar so the profile no longer shows the default grey icon" block>
            <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
              <span className="text-xs font-semibold text-slate-300">Random avatar</span>
              <Toggle checked={!!form.doAvatar} onChange={(v) => save('doAvatar', v)} />
            </div>
          </Tip>
          <Tip tip="Set a random country / region on the profile" block>
            <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
              <span className="text-xs font-semibold text-slate-300">Random country</span>
              <Toggle checked={!!form.doRegion} onChange={(v) => save('doRegion', v)} />
            </div>
          </Tip>
          <Tip tip="Set the profile, friends list and inventory visibility to public" block>
            <div className="flex items-center justify-between rounded-lg bg-night-800/70 px-3 py-2.5">
              <span className="text-xs font-semibold text-slate-300">Public profile</span>
              <Toggle checked={!!form.doPublic} onChange={(v) => save('doPublic', v)} />
            </div>
          </Tip>
          <Tip tip="Seconds to wait between profile changes to avoid flooding Steam" block>
            <div>
              <label className="label">Stagger delay (sec)</label>
              <input
                type="number"
                min="5"
                max="600"
                className="input"
                value={form.staggerSeconds}
                onChange={(e) => setForm((f) => ({ ...f, staggerSeconds: e.target.value }))}
                onBlur={() => save('staggerSeconds', form.staggerSeconds)}
              />
            </div>
          </Tip>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          Activity
          {running && <span className="chip border-steam/30 bg-steam/10 text-steam">live</span>}
        </h3>
        {recent.length === 0 ? (
          <p className="text-xs text-slate-500">No profile changes yet. They will appear here in real time.</p>
        ) : (
          <div className="max-h-72 space-y-1.5 overflow-y-auto font-mono text-[11px]">
            {recent.map((r, i) => (
              <div
                key={i}
                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${
                  r.status === 'ok' ? 'border-emerald-500/20 bg-emerald-500/[0.05]' : 'border-rose-500/20 bg-rose-500/[0.05]'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  {r.status === 'ok' ? (
                    <CheckCircle2 size={13} className="shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle size={13} className="shrink-0 text-rose-400" />
                  )}
                  <span className="truncate text-slate-300">
                    <span className="font-bold text-white">{r.bot}</span> — {ACTION_LABELS[r.action] || r.action}
                  </span>
                </span>
                <span className="shrink-0 text-slate-500">{new Date(r.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
