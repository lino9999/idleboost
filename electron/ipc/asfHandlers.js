const { ipcMain } = require('electron');

function register(ctx) {
  const { api, manager, getAsfDir, getLastStatus } = ctx;

  ipcMain.handle('asf:status', () => getLastStatus() || manager.getStatus());
  ipcMain.handle('asf:start', () => {
    manager.start();
    return true;
  });
  ipcMain.handle('asf:stop', () => {
    manager.stop();
    return true;
  });
  ipcMain.handle('asf:restart', () => {
    manager.restart();
    return true;
  });
  ipcMain.handle('asf:log-history', () => ctx.getLogHistory());
  ipcMain.handle('asf:path', () => getAsfDir());
  ipcMain.handle('asf:command', (_e, cmd) => api.command(cmd));

  ipcMain.handle('api:getAsf', () => api.getAsf());
  ipcMain.handle('api:getBots', () => api.getBots());
  ipcMain.handle('api:get2faToken', (_e, names) => api.get2faToken(names));
  ipcMain.handle('api:startBots', (_e, names) => api.startBots(names));
  ipcMain.handle('api:stopBots', (_e, names) => api.stopBots(names));
  ipcMain.handle('api:setBotEnabled', (_e, name, enabled) => api.setBotEnabled(name, enabled));
  ipcMain.handle('api:saveBots', (_e, configs) => api.saveBots(configs));
  ipcMain.handle('api:deleteBots', (_e, names) => api.deleteBots(names));
}

module.exports = { register };
