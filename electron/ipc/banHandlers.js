const { ipcMain } = require('electron');

function register(ctx) {
  const { banChecker } = ctx;

  ipcMain.handle('ban:get', () => banChecker.getState());
  ipcMain.handle('ban:setConfig', (_e, cfg) => banChecker.setConfig(cfg));
  ipcMain.handle('ban:checkAll', () => banChecker.checkAllNow());
}

module.exports = { register };
