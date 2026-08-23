const { ipcMain } = require('electron');

function register(ctx) {
  const { notifier } = ctx;

  ipcMain.handle('webhook:get', () => notifier.getState());
  ipcMain.handle('webhook:set', (_e, cfg) => notifier.setConfig(cfg));
}

module.exports = { register };
