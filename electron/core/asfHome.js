const path = require('path');
const fs = require('fs');

function sanitizeName(name) {
  return String(name || '')
    .replace(/[^\w.\- ]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 64);
}

function configDir(asfDir) {
  return path.join(asfDir, 'config');
}

function asfJsonPath(asfDir) {
  return path.join(asfDir, 'config', 'ASF.json');
}

function readAsfJson(asfDir) {
  try {
    return JSON.parse(fs.readFileSync(asfJsonPath(asfDir), 'utf8'));
  } catch {
    return {};
  }
}

function writeAsfJson(asfDir, obj) {
  fs.mkdirSync(path.dirname(asfJsonPath(asfDir)), { recursive: true });
  fs.writeFileSync(asfJsonPath(asfDir), JSON.stringify(obj, null, 2));
}

function readFreePackagesState(asfDir) {
  const bots = listBotNames(asfDir);
  const perBot = {};
  let enabledCount = 0;
  let readableCount = 0;
  let limit = null;
  let pausePlaying = null;
  let pauseFarming = null;
  let perHour = null;
  let filtersEnabled = false;
  let filtersText = '';
  for (const name of bots) {
    const cfg = readBotConfig(asfDir, name);
    if (!cfg) {
      perBot[name] = { enabled: false };
      continue;
    }
    readableCount += 1;
    const enabled = cfg.EnableFreePackages === true;
    if (enabled) enabledCount += 1;
    perBot[name] = { enabled };
    if (typeof cfg.FreePackagesLimit === 'number' && limit === null) limit = cfg.FreePackagesLimit;
    if (typeof cfg.FreePackagesPerHour === 'number' && perHour === null) perHour = cfg.FreePackagesPerHour;
    if (typeof cfg.PauseFreePackagesWhilePlaying === 'boolean' && pausePlaying === null) {
      pausePlaying = cfg.PauseFreePackagesWhilePlaying;
    }
    if (typeof cfg.PauseFreePackagesWhileFarming === 'boolean' && pauseFarming === null) {
      pauseFarming = cfg.PauseFreePackagesWhileFarming;
    }
    if (Array.isArray(cfg.FreePackagesFilters)) {
      filtersEnabled = true;
      if (!filtersText) filtersText = JSON.stringify(cfg.FreePackagesFilters, null, 2);
    }
  }
  return {
    totalBots: bots.length,
    readableCount,
    enabledCount,
    allEnabled: readableCount > 0 && enabledCount === readableCount,
    limit: limit === null ? 25 : limit,
    perHour: perHour === null ? 0 : perHour,
    pauseWhilePlaying: pausePlaying === null ? true : pausePlaying,
    pauseWhileFarming: pauseFarming === null ? false : pauseFarming,
    filtersEnabled,
    filtersText,
    perBot
  };
}

function applyFreePackages(asfDir, patch) {
  const bots = listBotNames(asfDir);
  const results = [];
  for (const name of bots) {
    const cfg = readBotConfig(asfDir, name);
    if (!cfg) {
      results.push({ bot: name, ok: false, error: 'config missing' });
      continue;
    }
    if (patch.enabled === true) {
      cfg.EnableFreePackages = true;
      cfg.PauseFreePackagesWhilePlaying = patch.pauseWhilePlaying !== false;
      cfg.PauseFreePackagesWhileFarming = patch.pauseWhileFarming !== false;
      const limit = parseInt(patch.limit, 10);
      cfg.FreePackagesLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 30) : 25;
      const perHour = parseInt(patch.perHour, 10);
      if (Number.isFinite(perHour) && perHour > 0) {
        cfg.FreePackagesPerHour = Math.min(perHour, 360);
      } else {
        delete cfg.FreePackagesPerHour;
      }
    } else {
      cfg.EnableFreePackages = false;
      delete cfg.PauseFreePackagesWhilePlaying;
      delete cfg.PauseFreePackagesWhileFarming;
      delete cfg.FreePackagesLimit;
      delete cfg.FreePackagesPerHour;
    }
    if (patch.filtersEnabled === true && Array.isArray(patch.filters)) {
      cfg.FreePackagesFilters = patch.filters;
    } else {
      delete cfg.FreePackagesFilters;
    }
    try {
      writeBotConfig(asfDir, name, cfg);
      results.push({ bot: name, ok: true });
    } catch (e) {
      results.push({ bot: name, ok: false, error: e.message });
    }
  }
  return results;
}

const FREE_GAMES_DEFAULT_FILTERS = [{ NoCostOnly: true }, { Categories: [29] }];

// Restores the FreePackages settings on bot configs that lost them (e.g. ASF
// rewrote the json before the app kept the settings in sync). Only adds what is
// missing, never overwrites values the user already has. Called at boot when the
// feature is enabled, before ASF is started.
function healFreePackages(asfDir) {
  let changed = 0;
  for (const name of listBotNames(asfDir)) {
    const cfg = readBotConfig(asfDir, name);
    if (!cfg || cfg.EnableFreePackages === true) continue;
    cfg.EnableFreePackages = true;
    if (cfg.PauseFreePackagesWhilePlaying !== true) {
      cfg.PauseFreePackagesWhilePlaying = true;
    }
    if (cfg.PauseFreePackagesWhileFarming !== true) {
      cfg.PauseFreePackagesWhileFarming = true;
    }
    if (typeof cfg.FreePackagesLimit !== 'number' || cfg.FreePackagesLimit <= 0) {
      cfg.FreePackagesLimit = 25;
    }
    if (!Array.isArray(cfg.FreePackagesFilters)) {
      cfg.FreePackagesFilters = FREE_GAMES_DEFAULT_FILTERS;
    }
    try {
      writeBotConfig(asfDir, name, cfg);
      changed += 1;
    } catch {
      /* skip */
    }
  }
  return changed;
}

function normalizeFreePackages(asfDir) {
  let changed = 0;
  for (const name of listBotNames(asfDir)) {
    const cfg = readBotConfig(asfDir, name);
    if (!cfg || cfg.EnableFreePackages !== true) continue;
    let touched = false;
    if (cfg.PauseFreePackagesWhilePlaying !== true) {
      cfg.PauseFreePackagesWhilePlaying = true;
      touched = true;
    }
    if (cfg.PauseFreePackagesWhileFarming !== true) {
      cfg.PauseFreePackagesWhileFarming = true;
      touched = true;
    }
    if (!Array.isArray(cfg.FreePackagesFilters)) {
      cfg.FreePackagesFilters = FREE_GAMES_DEFAULT_FILTERS;
      touched = true;
    }
    if (touched) {
      try {
        writeBotConfig(asfDir, name, cfg);
        changed += 1;
      } catch {
        /* skip */
      }
    }
  }
  return changed;
}

function clearMatchableTypes(asfDir) {
  let changed = 0;
  for (const name of listBotNames(asfDir)) {
    const cfg = readBotConfig(asfDir, name);
    if (!cfg) continue;
    if (Array.isArray(cfg.MatchableTypes) && cfg.MatchableTypes.length > 0) {
      cfg.MatchableTypes = [];
      try {
        writeBotConfig(asfDir, name, cfg);
        changed += 1;
      } catch {
        /* skip */
      }
    }
  }
  return changed;
}

function readAsfEnhanceConfig(asfDir) {
  const cfg = readAsfJson(asfDir);
  return cfg.ASFEnhance || {};
}

function writeAsfEnhanceConfig(asfDir, obj) {
  const cfg = readAsfJson(asfDir);
  cfg.ASFEnhance = obj || {};
  writeAsfJson(asfDir, cfg);
  return cfg.ASFEnhance;
}

function ensureAsfEnhanceReady(asfDir) {
  const cfg = readAsfEnhanceConfig(asfDir);
  let changed = false;
  if (cfg.EULA !== true) {
    cfg.EULA = true;
    changed = true;
  }
  if (cfg.DevFeature !== true) {
    cfg.DevFeature = true;
    changed = true;
  }
  if (cfg.Statistic !== false) {
    cfg.Statistic = false;
    changed = true;
  }
  if (changed) writeAsfEnhanceConfig(asfDir, cfg);
  return changed;
}

function ensureBandwidthSaver(asfDir) {
  const cfg = readAsfJson(asfDir);
  let changed = false;
  if (cfg.OptimizationStrategy !== 1) {
    cfg.OptimizationStrategy = 1;
    changed = true;
  }
  if (cfg.FarmingDelay !== 60) {
    cfg.FarmingDelay = 60;
    changed = true;
  }
  if (changed) writeAsfJson(asfDir, cfg);
  return changed;
}

function botConfigPath(asfDir, name) {
  return path.join(asfDir, 'config', `${sanitizeName(name)}.json`);
}

function readBotConfig(asfDir, name) {
  try {
    return JSON.parse(fs.readFileSync(botConfigPath(asfDir, name), 'utf8'));
  } catch {
    return null;
  }
}

function writeBotConfig(asfDir, name, cfg) {
  fs.mkdirSync(configDir(asfDir), { recursive: true });
  fs.writeFileSync(botConfigPath(asfDir, name), JSON.stringify(cfg, null, 2));
}

function listBotNames(asfDir) {
  const dir = configDir(asfDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'ASF.json')
    .map((f) => f.slice(0, -5));
}

function migrateLegacyPasswordField(asfDir) {
  let migrated = 0;
  for (const name of listBotNames(asfDir)) {
    const cfg = readBotConfig(asfDir, name);
    if (!cfg) continue;
    let changed = false;
    if (cfg.Password !== undefined && (cfg.SteamPassword === undefined || cfg.SteamPassword === null || cfg.SteamPassword === '')) {
      cfg.SteamPassword = String(cfg.Password);
      changed = true;
    }
    if (cfg.Password !== undefined) {
      delete cfg.Password;
      changed = true;
    }
    if (cfg.SteamPassword && cfg.PasswordFormat === undefined) {
      cfg.PasswordFormat = 0;
      changed = true;
    }
    if (changed) {
      writeBotConfig(asfDir, name, cfg);
      migrated += 1;
    }
  }
  return migrated;
}

function disableAllBotConfigs(asfDir, excludeNames) {
  const excluded = new Set(excludeNames || []);
  let changed = 0;
  for (const name of listBotNames(asfDir)) {
    if (excluded.has(name)) continue;
    const cfg = readBotConfig(asfDir, name);
    if (cfg && cfg.Enabled !== false) {
      cfg.Enabled = false;
      writeBotConfig(asfDir, name, cfg);
      changed += 1;
    }
  }
  return changed;
}

function resolveBundledAsfDir(app) {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'asf'),
        path.join(path.dirname(app.getPath('exe')), 'asf'),
        path.join(app.getAppPath(), 'asf')
      ]
    : [path.join(app.getAppPath(), 'asf')];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'ArchiSteamFarm.exe'))) return dir;
    } catch {
      /* keep looking */
    }
  }
  return candidates[0];
}

function ensureAsfHome(app, bundledAsfDir) {
  if (!app.isPackaged) return bundledAsfDir;

  const homeDir = path.join(app.getPath('userData'), 'asf-home');
  fs.mkdirSync(path.join(homeDir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(homeDir, 'logs'), { recursive: true });

  const versionFile = path.join(homeDir, '.swup-bundle-version');
  let prevVersion = '';
  try {
    prevVersion = fs.readFileSync(versionFile, 'utf8').trim();
  } catch {
    prevVersion = '';
  }
  const curVersion = app.getVersion() || 'dev';

  for (const sub of ['plugins', 'www']) {
    const src = path.join(bundledAsfDir, sub);
    const dst = path.join(homeDir, sub);
    try {
      if (!fs.existsSync(src)) continue;
      const missing = !fs.existsSync(dst) || fs.readdirSync(dst).length === 0;
      if (missing || prevVersion !== curVersion) {
        if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
        fs.cpSync(src, dst, { recursive: true });
      }
    } catch {
      /* best effort */
    }
  }
  try {
    fs.writeFileSync(versionFile, curVersion);
  } catch {
    /* ignore */
  }

  return homeDir;
}

function ensureDefaultAsfConfig(asfDir) {
  const dir = configDir(asfDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ASF.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          AutoUpdates: true,
          CommandPrefix: '!',
          Headless: true,
          IPC: true,
          IPCPrefixes: ['http://127.0.0.1:1242/'],
          LoginLimiterDelay: 10,
          OptimizationStrategy: 0
        },
        null,
        2
      )
    );
  }
  const ipcConfig = path.join(dir, 'IPC.config');
  if (!fs.existsSync(ipcConfig)) {
    fs.writeFileSync(
      ipcConfig,
      JSON.stringify(
        {
          Kestrel: {
            Endpoints: {
              HTTP4: { Url: 'http://127.0.0.1:1242' }
            }
          }
        },
        null,
        2
      )
    );
  }
}

function ensureIpcEnabled(asfDir) {
  return ensureCoreFlags(asfDir);
}

function ensureCoreFlags(asfDir) {
  const cfg = readAsfJson(asfDir);
  let changed = false;
  if (!fs.existsSync(path.join(configDir(asfDir), 'IPC.config'))) {
    if (cfg.IPC !== true) {
      cfg.IPC = true;
      changed = true;
    }
    if (!Array.isArray(cfg.IPCPrefixes) || cfg.IPCPrefixes.length === 0) {
      cfg.IPCPrefixes = ['http://127.0.0.1:1242/'];
      changed = true;
    }
  }
  if (cfg.Headless !== true) {
    cfg.Headless = true;
    changed = true;
  }
  if (cfg.AutoUpdates !== true) {
    cfg.AutoUpdates = true;
    changed = true;
  }
  if (changed) writeAsfJson(asfDir, cfg);
  return changed;
}

module.exports = {
  sanitizeName,
  configDir,
  asfJsonPath,
  readAsfJson,
  writeAsfJson,
  readAsfEnhanceConfig,
  writeAsfEnhanceConfig,
  ensureAsfEnhanceReady,
  ensureBandwidthSaver,
  botConfigPath,
  readBotConfig,
  writeBotConfig,
  listBotNames,
  migrateLegacyPasswordField,
  disableAllBotConfigs,
  readFreePackagesState,
  applyFreePackages,
  normalizeFreePackages,
  healFreePackages,
  clearMatchableTypes,
  FREE_GAMES_DEFAULT_FILTERS,
  resolveBundledAsfDir,
  ensureAsfHome,
  ensureDefaultAsfConfig,
  ensureIpcEnabled,
  ensureCoreFlags
};
