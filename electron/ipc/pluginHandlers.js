const { ipcMain } = require('electron');
const home = require('../core/asfHome');

function register(ctx) {
  const { getAsfDir, store } = ctx;

  ipcMain.handle('plugins:freepackages:get', () => {
    const s = home.readFreePackagesState(getAsfDir());
    // Prefer the user's persisted intent so the toggle does not flicker back if a
    // bot config is momentarily unreadable/being rewritten by ASF.
    const intent = store.get('freePackagesEnabled', null);
    return { ...s, allEnabled: intent === null ? s.allEnabled : !!intent };
  });

  ipcMain.handle('plugins:freepackages:apply', (_e, patch) => {
    const results = home.applyFreePackages(getAsfDir(), patch || {});
    if (patch && typeof patch.enabled === 'boolean') {
      store.set('freePackagesEnabled', patch.enabled);
    }
    return results;
  });

  ipcMain.handle('plugins:asfenhance:get', () => home.readAsfEnhanceConfig(getAsfDir()));
  ipcMain.handle('plugins:asfenhance:set', (_e, obj) => home.writeAsfEnhanceConfig(getAsfDir(), obj));
}

module.exports = { register };
