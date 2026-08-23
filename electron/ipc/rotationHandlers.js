const { ipcMain } = require('electron');

function register(ctx) {
  const { rotation, scheduler } = ctx;

  ipcMain.handle('rotation:get', () => rotation.getFullState());
  ipcMain.handle('rotation:set', (_e, cfg) => rotation.setConfig(cfg));
  ipcMain.handle('rotation:prepare', () => rotation.prepareForStart());
  ipcMain.handle('rotation:startManual', (_e, name) => rotation.startManual(String(name)));
  ipcMain.handle('rotation:stopManual', (_e, name) => rotation.stopManual(String(name)));

  ipcMain.handle('plugins:scheduler:get', () => scheduler.getFullState());
  ipcMain.handle('plugins:scheduler:set', (_e, cfg) => scheduler.setConfig(cfg));
  ipcMain.handle('plugins:scheduler:run', () => scheduler.check());
}

module.exports = { register };
