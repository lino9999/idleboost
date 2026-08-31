const { ipcMain } = require('electron');
const home = require('../core/asfHome');

const FREE_PACKAGE_KEYS = [
  'EnableFreePackages',
  'PauseFreePackagesWhilePlaying',
  'PauseFreePackagesWhileFarming',
  'FreePackagesLimit',
  'FreePackagesPerHour',
  'FreePackagesFilters'
];

function sameValue(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

// Pushes the FreePackages settings (just written to the bot json files) into the
// running ASF instance via IPC. This is required because ASF saves bot configs
// from its in-memory model: if the plugin settings are not in memory (e.g. they
// were written to disk after ASF started), the next config save triggered by the
// app (bot start/stop) would rewrite the json file and strip them.
async function syncFreePackagesToAsf(api, asfDir) {
  let bots;
  try {
    bots = await api.getBots();
  } catch {
    return { skipped: true };
  }
  const names = Object.keys(bots || {}).filter((n) => bots[n] && bots[n].BotConfig);
  if (names.length === 0) return { skipped: true };

  let synced = 0;
  let unchanged = 0;
  const errors = [];
  for (const name of names) {
    const fileCfg = home.readBotConfig(asfDir, name);
    if (!fileCfg) {
      errors.push(`${name}: config file unreadable`);
      continue;
    }
    const inMemory = bots[name].BotConfig;
    const cfg = { ...inMemory };
    for (const key of FREE_PACKAGE_KEYS) {
      if (key in fileCfg) cfg[key] = fileCfg[key];
      else if (key === 'EnableFreePackages') cfg[key] = false;
      else delete cfg[key];
    }
    const alreadyInSync = FREE_PACKAGE_KEYS.every((key) => sameValue(cfg[key], inMemory[key]));
    if (alreadyInSync) {
      unchanged += 1;
      continue;
    }
    try {
      await api.request('POST', `/Api/Bot/${encodeURIComponent(name)}`, { BotConfig: cfg });
      synced += 1;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { total: names.length, synced, unchanged, errors };
}

function register(ctx) {
  const { getAsfDir, store, api, db, log } = ctx;

  ipcMain.handle('plugins:freepackages:get', () => {
    const s = home.readFreePackagesState(getAsfDir());
    // The persisted intent is trusted only when no bot config is readable at all
    // (e.g. ASF is rewriting every file right now). Otherwise the toggle must
    // reflect what is really on disk, so a silent write failure is never masked.
    const intent = store.get('freePackagesEnabled', null);
    const skipWarming = store.get('freePackagesSkipWarming', false);
    let allEnabled = s.allEnabled;
    if (s.readableCount === 0 && intent !== null) {
      allEnabled = !!intent;
    } else if (intent === true && skipWarming && db) {
      // "Skip warming" intentionally disables accounts without card drops, so
      // "all enabled" means: every bot that SHOULD have it, has it.
      try {
        const rows = db.query('SELECT name, cards_left FROM bots');
        const expected = {};
        for (const r of rows || []) expected[r.name] = Number(r.cards_left) > 0;
        allEnabled = Object.entries(s.perBot || {}).every(([name, st]) => st.enabled === (expected[name] !== false));
      } catch {
        allEnabled = true;
      }
    }
    return { ...s, allEnabled, skipWarming };
  });

  ipcMain.handle('plugins:freepackages:apply', async (_e, patch) => {
    const p = { ...(patch || {}) };
    const asfDir = getAsfDir();

    if (typeof p.skipWarming === 'boolean') {
      store.set('freePackagesSkipWarming', p.skipWarming);
    }
    const skipWarming = p.skipWarming === true || (p.skipWarming === undefined && store.get('freePackagesSkipWarming', false));

    // When requested, exclude accounts with no card drops left: redeeming a free
    // game makes ASF reset the idle games being warmed on those accounts, which
    // spams the console and burns proxy bandwidth for no benefit.
    let excludedWarmers = 0;
    if (p.enabled === true && skipWarming && db) {
      const perBot = {};
      try {
        const rows = db.query('SELECT name, cards_left FROM bots');
        for (const r of rows || []) {
          const hasCards = Number(r.cards_left) > 0;
          perBot[r.name] = hasCards;
          if (!hasCards) excludedWarmers += 1;
        }
      } catch {
        /* db not available - apply to everyone */
      }
      p.perBot = perBot;
    }

    const results = home.applyFreePackages(asfDir, p);
    const okResults = results.filter((r) => r.ok);
    const written = okResults.filter((r) => r.written).length;
    const failed = results.filter((r) => !r.ok);

    log(
      `[FreePackages] ${p.enabled ? 'Enabled' : 'Disabled'} free games redemption - ${written} config file(s) updated, ${okResults.length - written} already up to date${
        p.enabled && skipWarming ? ` (${excludedWarmers} hour-warming account(s) without card drops excluded)` : ''
      }`
    );
    for (const f of failed) {
      log(`[FreePackages] Could not update ${f.bot}: ${f.error}`, 'stderr');
    }

    // Persist the toggle intent only when at least one config file was really
    // written (or when there are no bots yet), so the UI can never show
    // "enabled" while the json files have no EnableFreePackages.
    let intentPersisted = false;
    if (typeof p.enabled === 'boolean' && (okResults.length > 0 || results.length === 0)) {
      store.set('freePackagesEnabled', p.enabled);
      intentPersisted = true;
    }

    let sync = { skipped: true };
    try {
      sync = await syncFreePackagesToAsf(api, asfDir);
      if (sync.skipped) {
        log('[FreePackages] ASF IPC not reachable - settings saved to disk, they will be loaded at next ASF start');
      } else {
        log(
          `[FreePackages] Pushed settings to running ASF: ${sync.synced} bot(s) updated, ${sync.unchanged} already in sync`
        );
        for (const msg of sync.errors || []) {
          log(`[FreePackages] ASF sync failed for ${msg}`, 'stderr');
        }
      }
    } catch (e) {
      log(`[FreePackages] ASF sync error: ${e.message}`, 'stderr');
    }

    return {
      total: results.length,
      ok: okResults.length,
      failed: failed.map((f) => ({ bot: f.bot, error: f.error })),
      intentPersisted,
      sync
    };
  });

  ipcMain.handle('plugins:asfenhance:get', () => home.readAsfEnhanceConfig(getAsfDir()));
  ipcMain.handle('plugins:asfenhance:set', (_e, obj) => home.writeAsfEnhanceConfig(getAsfDir(), obj));
}

module.exports = { register };

