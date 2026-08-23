const { ipcMain } = require('electron');

function register(ctx) {
  const { updater } = ctx;

  ipcMain.handle('updater:get', () => updater.getState());
  ipcMain.handle('updater:setConfig', (_e, cfg) => updater.setConfig(cfg));
  ipcMain.handle('updater:check', () => updater.checkNow(true));
}

module.exports = { register };
