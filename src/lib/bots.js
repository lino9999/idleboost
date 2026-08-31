export function botStatus(bot) {
  if (!bot) return 'offline';
  if ((bot.RequiredInput || 0) > 0) return 'error';
  if (bot.IsConnectedAndLoggedOn) {
    const farmer = bot.CardsFarmer;
    const cardFarming = !!(farmer && farmer.NowFarming);
    if (cardFarming) return 'farming';
    // "Warming" only when the bot is actually playing games; a connected bot that
    // is playing nothing (e.g. FreeGames unlocker mode) is simply online.
    if (bot.PlayingNow) return 'warming';
    return 'online';
  }
  return 'offline';
}

export const STATUS_META = {
  farming: { label: 'Farming', dot: 'bg-emerald-400', text: 'text-emerald-300', chip: 'border-emerald-400/30 bg-emerald-400/10' },
  warming: { label: 'Warming', dot: 'bg-grape-soft', text: 'text-grape-soft', chip: 'border-grape/30 bg-grape/10' },
  online: { label: 'Online', dot: 'bg-sky-400', text: 'text-sky-400', chip: 'border-sky-400/30 bg-sky-400/10' },
  offline: { label: 'Offline', dot: 'bg-slate-500', text: 'text-slate-400', chip: 'border-slate-500/30 bg-slate-500/10' },
  error: { label: 'Needs Input', dot: 'bg-rose-400', text: 'text-rose-400', chip: 'border-rose-400/30 bg-rose-400/10' }
};

export function steamIdOf(bot) {
  if (!bot) return '';
  if (bot.s_SteamID && String(bot.s_SteamID) !== '0') return String(bot.s_SteamID);
  if (bot.SteamID !== undefined && bot.SteamID !== null && String(bot.SteamID) !== '0') return String(bot.SteamID);
  return '';
}

export function avatarUrl(bot) {
  if (!bot) return null;
  const hash = bot.AvatarHash || (bot.AccountInfo && bot.AccountInfo.AvatarHash) || null;
  if (hash && typeof hash === 'string' && hash.length >= 8) {
    return `https://avatars.steamstatic.com/${hash}_medium.jpg`;
  }
  const a = bot.AvatarMedium || (bot.AccountInfo && bot.AccountInfo.AvatarMedium) || null;
  if (a && typeof a === 'string') {
    if (a.startsWith('http')) return a;
    if (a.startsWith('/')) return `https://steamcommunity.com${a}`;
  }
  return null;
}

export function walletOf(bot) {
  if (!bot) return null;
  const info = bot.AccountInfo;
  let balance = bot.WalletBalance;
  let currency = bot.WalletCurrency;
  if (!Number.isFinite(balance) && info) balance = Number.isFinite(info.WalletBalance) ? info.WalletBalance : info.Balance;
  if (!Number.isFinite(currency) && info) currency = Number.isFinite(info.WalletCurrency) ? info.WalletCurrency : info.Currency;
  if (!Number.isFinite(balance)) return null;
  return { balance, currency };
}

export function runningOf(bot) {
  return !!(bot && (bot.IsConnectedAndLoggedOn || bot.KeepRunning === true));
}
