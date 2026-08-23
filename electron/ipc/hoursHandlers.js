const { ipcMain } = require('electron');

function register(ctx) {
  const { hours } = ctx;

  ipcMain.handle('hours:get', () => hours.getState());
  ipcMain.handle('hours:setConfig', (_e, cfg) => hours.setConfig(cfg));
  ipcMain.handle('hours:run', () => hours.runOnce(true));
}

module.exports = { register };
