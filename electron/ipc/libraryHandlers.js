const { ipcMain } = require('electron');

function register(ctx) {
  const { librarySync, freeGames } = ctx;

  ipcMain.handle('library:getKeys', () => librarySync.getApiKeys());
  ipcMain.handle('library:setKeys', (_e, keys) => librarySync.setApiKeys(keys));
  ipcMain.handle('library:getDelay', () => librarySync.getSyncDelay());
  ipcMain.handle('library:setDelay', (_e, seconds) => librarySync.setSyncDelay(seconds));

  ipcMain.handle('freegames:get', () => freeGames.getState());
  ipcMain.handle('freegames:setConfig', (_e, cfg) => freeGames.setConfig(cfg));
  ipcMain.handle('freegames:fetch', () => freeGames.fetchFreePackages());
  ipcMain.handle('freegames:redeem', () => freeGames.redeemMissing());
}

module.exports = { register };
