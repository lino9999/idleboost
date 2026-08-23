const { ipcMain } = require('electron');
const home = require('../core/asfHome');

function applyBandwidthSaver(asfDir) {
  const globalCfg = home.readAsfJson(asfDir);
  if (globalCfg.OptimizationStrategy !== 1 || globalCfg.FarmingDelay !== 60) {
    globalCfg.OptimizationStrategy = 1;
    globalCfg.FarmingDelay = 60;
    home.writeAsfJson(asfDir, globalCfg);
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function register(ctx) {
  const { store, getAsfDir } = ctx;

  ipcMain.handle('proxy:list', () => store.get('proxies', {}) || {});

  ipcMain.handle('proxy:apply', (_e, { botName, proxy }) => {
    const asfDir = getAsfDir();
    const cfg = home.readBotConfig(asfDir, botName);
    if (!cfg) throw new Error(`Bot config not found: ${home.sanitizeName(botName)}.json`);
    delete cfg.WebProxy;
    delete cfg.WebProxyUsername;
    delete cfg.WebProxyPassword;
    if (proxy && proxy.host && proxy.port) {
      cfg.WebProxy = `${proxy.scheme || 'http'}://${proxy.host}:${proxy.port}`;
      if (proxy.username) cfg.WebProxyUsername = String(proxy.username);
      if (proxy.password) cfg.WebProxyPassword = String(proxy.password);
    }
    home.writeBotConfig(asfDir, botName, cfg);
    applyBandwidthSaver(asfDir);

    const all = store.get('proxies', {}) || {};
    if (proxy && proxy.host && proxy.port) {
      all[botName] = { ...proxy };
    } else {
      delete all[botName];
    }
    store.set('proxies', all);
    return all;
  });

  ipcMain.handle('proxy:bulkAssign', (_e, payload) => {
    const asfDir = getAsfDir();
    const proxies = (payload && payload.proxies) || [];
    const botNames = home.listBotNames(asfDir).sort((a, b) => a.localeCompare(b));
    const deck = shuffle(proxies);
    const assignments = [];
    const all = store.get('proxies', {}) || {};

    for (const name of botNames) {
      const cfg = home.readBotConfig(asfDir, name);
      if (!cfg) {
        assignments.push({ bot: name, ok: false, error: 'config missing' });
        continue;
      }
      delete cfg.WebProxy;
      delete cfg.WebProxyUsername;
      delete cfg.WebProxyPassword;
      delete all[name];
      if (deck.length > 0) {
        const proxy = deck[assignments.filter((a) => a.proxy).length % deck.length];
        cfg.WebProxy = `${proxy.scheme || 'http'}://${proxy.host}:${proxy.port}`;
        if (proxy.username) cfg.WebProxyUsername = String(proxy.username);
        if (proxy.password) cfg.WebProxyPassword = String(proxy.password);
        home.writeBotConfig(asfDir, name, cfg);
        all[name] = { ...proxy };
        assignments.push({ bot: name, ok: true, proxy: cfg.WebProxy, user: proxy.username || '' });
      } else {
        home.writeBotConfig(asfDir, name, cfg);
        assignments.push({ bot: name, ok: true, proxy: null });
      }
    }

    applyBandwidthSaver(asfDir);
    store.set('proxies', all);
    return { assignments, bots: botNames.length, proxies: proxies.length };
  });

  ipcMain.handle('proxy:removeAll', () => {
    const asfDir = getAsfDir();
    for (const name of home.listBotNames(asfDir)) {
      const cfg = home.readBotConfig(asfDir, name);
      if (!cfg) continue;
      delete cfg.WebProxy;
      delete cfg.WebProxyUsername;
      delete cfg.WebProxyPassword;
      home.writeBotConfig(asfDir, name, cfg);
    }
    store.set('proxies', {});
    return {};
  });
}

module.exports = { register };
