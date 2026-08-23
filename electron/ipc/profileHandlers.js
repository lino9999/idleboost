const { ipcMain } = require('electron');

function register(ctx) {
  const { profile } = ctx;

  ipcMain.handle('profile:get', () => profile.getState());
  ipcMain.handle('profile:setConfig', (_e, cfg) => profile.setConfig(cfg));
  ipcMain.handle('profile:run', () => profile.processOne());
}

module.exports = { register };
