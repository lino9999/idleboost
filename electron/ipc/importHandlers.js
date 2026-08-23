const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const home = require('../core/asfHome');

function buildBotIndex(asfDir) {
  const index = [];
  for (const name of home.listBotNames(asfDir)) {
    const cfg = home.readBotConfig(asfDir, name);
    if (cfg) index.push({ name, login: String(cfg.SteamLogin || '') });
  }
  return index;
}

function findBotForAccount(index, account) {
  const acc = String(account || '').trim().toLowerCase();
  return (
    index.find((b) => b.login.toLowerCase() === acc) ||
    index.find((b) => b.name.toLowerCase() === acc) ||
    null
  );
}

function register(ctx) {
  const { getAsfDir, getWindow } = ctx;

  ipcMain.handle('dialog:openFiles', async (_e, opts) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: (opts && opts.title) || 'Select files',
      filters: (opts && opts.filters) || [],
      properties: (opts && opts.properties) || ['openFile', 'multiSelections']
    });
    return { canceled: result.canceled, filePaths: result.filePaths };
  });

  ipcMain.handle('fs:readText', (_e, filePath) => fs.readFileSync(filePath, 'utf8'));

  ipcMain.handle('import:accounts', (_e, payload) => {
    const asfDir = getAsfDir();
    const cfgDir = home.configDir(asfDir);
    fs.mkdirSync(cfgDir, { recursive: true });
    const results = [];
    for (const acc of (payload && payload.accounts) || []) {
      const name = home.sanitizeName(acc.name || acc.login);
      if (!name) {
        results.push({ name: acc.login || '?', ok: false, error: 'Invalid account name' });
        continue;
      }
      const file = home.botConfigPath(asfDir, name);
      if (fs.existsSync(file) && !(payload && payload.overwrite)) {
        results.push({ name, ok: false, error: 'Bot config already exists (enable overwrite to replace)' });
        continue;
      }
      const cfg = {
        Enabled: false,
        SteamLogin: String(acc.login || ''),
        SteamPassword: String(acc.password || ''),
        PasswordFormat: 0,
        UseLoginKeys: true,
        SteamUserPermissions: {},
        BotBehaviour: 0,
        FarmingPreferences: 0,
        TradingPreferences: 1,
        LootableTypes: [1, 3, 5],
        TransferableTypes: [1, 3, 5],
        MatchableTypes: []
      };
      try {
        home.writeBotConfig(asfDir, name, cfg);
        results.push({ name, ok: true, hadSecret: !!acc.sharedSecret });
      } catch (err) {
        results.push({ name, ok: false, error: err.message });
      }
    }
    return results;
  });

  ipcMain.handle('import:mafiles', (_e, payload) => {
    const asfDir = getAsfDir();
    const cfgDir = home.configDir(asfDir);
    fs.mkdirSync(cfgDir, { recursive: true });
    const botIndex = buildBotIndex(asfDir);
    const results = [];
    for (const p of (payload && payload.paths) || []) {
      const base = path.basename(p);
      try {
        const json = JSON.parse(fs.readFileSync(p, 'utf8'));
        const account = String(json.account_name || '').trim();
        if (!account) {
          results.push({ file: base, ok: false, error: 'Missing account_name field' });
          continue;
        }
        const match = findBotForAccount(botIndex, account);
        const targetName = match ? match.name : home.sanitizeName(account);
        const target = path.join(cfgDir, `${match ? targetName : home.sanitizeName(targetName)}.maFile`);
        if (fs.existsSync(target) && !(payload && payload.overwrite)) {
          results.push({ file: base, ok: false, error: `${targetName}.maFile already exists in config` });
          continue;
        }
        fs.copyFileSync(p, target);
        if (!fs.existsSync(target)) {
          results.push({ file: base, ok: false, error: `Failed to write ${path.basename(target)}` });
          continue;
        }
        results.push({
          file: base,
          ok: true,
          account,
          bot: match ? match.name : null,
          botConfigFound: !!match,
          target: path.basename(target)
        });
      } catch (err) {
        results.push({ file: base, ok: false, error: err.message });
      }
    }
    return results;
  });
}

module.exports = { register };
