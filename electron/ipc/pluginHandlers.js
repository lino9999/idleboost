const { ipcMain } = require('electron');
const home = require('../core/asfHome');

function register(ctx) {
  const { getAsfDir } = ctx;

  ipcMain.handle('plugins:freepackages:get', () => home.readFreePackagesState(getAsfDir()));
  ipcMain.handle('plugins:freepackages:apply', (_e, patch) => home.applyFreePackages(getAsfDir(), patch || {}));
  ipcMain.handle('plugins:asfenhance:get', () => home.readAsfEnhanceConfig(getAsfDir()));
  ipcMain.handle('plugins:asfenhance:set', (_e, obj) => home.writeAsfEnhanceConfig(getAsfDir(), obj));
}

module.exports = { register };
