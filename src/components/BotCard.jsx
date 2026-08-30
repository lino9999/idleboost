import { useState } from 'react';
import { CalendarDays, ExternalLink, Power, Trash2 } from 'lucide-react';
import Tip from './Tip';
import { asf } from '../lib/api';
import { avatarUrl, runningOf, STATUS_META, steamIdOf, walletOf } from '../lib/bots';
import { formatWallet, currencyCode } from '../lib/format';

function accountAgeText(ts) {
  const created = Number(ts);
  if (!created) return null;
  const years = (Date.now() / 1000 - created) / (365.25 * 24 * 3600);
  if (years >= 1) return `${years.toFixed(1)} yrs`;
  const months = Math.max(1, Math.round(years * 12));
  return `${months} mo`;
}

export default function BotCard({ name, bot, status, standby, ownedGames, dbAvatar, dbWallet, dbStats, isStorage, activeFull, onChanged, toast }) {
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[status];
  const liveWallet = walletOf(bot);
  // Prefer the persisted DB wallet (keeps its value when the bot is offline) and fall back to the live ASF value.
  let walletBalance = 0;
  let walletCurrency = 0;
  if (dbWallet && Number(dbWallet.balance) > 0) {
    walletBalance = Number(dbWallet.balance);
    walletCurrency = Number(dbWallet.currency) || 0;
  } else if (liveWallet && Number(liveWallet.balance) > 0) {
    walletBalance = Number(liveWallet.balance);
    walletCurrency = Number(liveWallet.currency) || 0;
  }
  const avatar = avatarUrl(bot) || dbAvatar || null;
  const running = runningOf(bot);
  const nickname = (bot.AccountInfo && bot.AccountInfo.Nickname) || '';
  const steamID = steamIdOf(bot);
  const gamesToFarm = (bot.CardsFarmer && bot.CardsFarmer.GamesToFarm) || [];
  const currentGame = (bot.PlayingNow && bot.PlayingNow.GameName) || (gamesToFarm[0] && gamesToFarm[0].GameName) || '';
  const paused = !!(bot.CardsFarmer && bot.CardsFarmer.Paused);

  const openProfile = () => {
    if (!steamID) {
      toast('Steam profile not available yet (bot has not connected)', 'warn');
      return;
    }
    asf.openExternal(`https://steamcommunity.com/profiles/${steamID}/`);
  };

  const act = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast(okMsg, 'success');
      onChanged && onChanged();
    } catch (e) {
      toast(e.message || 'Action failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const togglePower = () =>
    act(
      () => (running ? asf.rotationStopManual(name) : asf.rotationStartManual(name)),
      running ? `${name} stopped` : `${name} started`
    );

  const remove = () => {
    if (!window.confirm(`Delete bot "${name}"? This removes its config from ASF.`)) return;
    act(() => asf.deleteBots([name]), `Bot ${name} deleted`);
  };

  return (
    <div className="card flex flex-col p-4 transition-colors hover:border-white/[0.12]">
      <div className="flex items-start gap-3">
        {avatar ? (
          <img src={avatar} alt={name} className="h-11 w-11 shrink-0 rounded-full ring-2 ring-white/10" />
        ) : (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-night-700 text-sm font-bold text-slate-300 ring-2 ring-white/10">
            {name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Tip tip={steamID ? 'Open this account Steam community profile in your browser' : 'Profile link available once the bot connects'}>
              <button
                onClick={openProfile}
                className="group flex min-w-0 items-center gap-1 truncate text-sm font-bold text-white transition-colors hover:text-steam"
              >
                <span className="truncate">{name}</span>
                <ExternalLink size={12} className="shrink-0 text-slate-500 transition-colors group-hover:text-steam" />
              </button>
            </Tip>
            <span className={`chip ${meta.chip} ${meta.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${status === 'farming' ? 'animate-pulse-slow' : ''}`} />
              {meta.label}
            </span>
          </div>
          {nickname ? <div className="truncate text-xs text-slate-500">{nickname}</div> : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Tip tip="Steam Wallet balance (last known value, kept when the bot is offline)" block>
          <div className="rounded-lg bg-night-800/70 px-2.5 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Wallet</div>
            <div className="font-bold text-emerald-300">
              {walletBalance > 0 ? formatWallet(walletBalance, walletCurrency) || '—' : '—'}
              {walletBalance > 0 && walletCurrency > 0 && (
                <span className="ml-1 text-[10px] font-medium text-slate-500">{currencyCode(walletCurrency)}</span>
              )}
            </div>
          </div>
        </Tip>
        <Tip tip="Games owned by this account (from the local database)" block>
          <div className="rounded-lg bg-night-800/70 px-2.5 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Games</div>
            <div className="font-bold text-slate-200">{ownedGames ?? '—'}</div>
          </div>
        </Tip>
      </div>

      {dbStats && Number(dbStats.account_created) > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <Tip tip="Account age (from the Steam profile creation date)" block>
            <div className="flex items-center gap-1.5 rounded-lg bg-night-800/70 px-2.5 py-2">
              <CalendarDays size={13} className="shrink-0 text-steam" />
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Age</div>
                <div className="font-bold text-slate-200">{accountAgeText(dbStats.account_created)}</div>
              </div>
            </div>
          </Tip>
        </div>
      )}

      <Tip tip={currentGame ? 'Game currently being played (first in queue)' : 'No game is being played right now'} block>
        <div className="mt-2 truncate rounded-lg bg-night-800/70 px-2.5 py-2 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Playing: </span>
          <span className="font-medium text-slate-300">{currentGame || '—'}</span>
          {paused && <span className="ml-2 rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">PAUSED</span>}
        </div>
      </Tip>

      <div className="mt-3 flex items-center gap-1.5">
        <Tip
          tip={
            running
              ? 'Stop this bot'
              : isStorage
                ? 'Start this storage account (it stays online until you stop it)'
                : activeFull
                  ? 'Active sessions are full - stop a bot first'
                  : 'Start this bot (counts toward the active sessions limit)'
          }
        >
          <button
            className={running ? 'btn-danger !px-2.5' : 'btn-success !px-2.5'}
            disabled={busy || standby || (!running && activeFull && !isStorage)}
            onClick={togglePower}
          >
            <Power size={14} />
          </button>
        </Tip>
        <div className="flex-1" />
        <Tip tip="Delete this bot config from ASF">
          <button className="btn-ghost !px-2.5 hover:!border-rose-500/40 hover:!text-rose-300" disabled={busy} onClick={remove}>
            <Trash2 size={14} />
          </button>
        </Tip>
      </div>
    </div>
  );
}
