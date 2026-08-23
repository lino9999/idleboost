const { ipcMain } = require('electron');

function register(ctx) {
  const { storage } = ctx;

  ipcMain.handle('storage:get', () => storage.getFullState());
  ipcMain.handle('storage:setConfig', (_e, cfg) => storage.setConfig(cfg));
  ipcMain.handle('storage:setAccounts', (_e, names) => storage.setAccounts(names));
  ipcMain.handle('storage:setTradeLink', (_e, name, tradeLink) => storage.setTradeLink(name, tradeLink));
  ipcMain.handle('storage:transfer', () => storage.queueTransfers());
  ipcMain.handle('storage:acceptTrades', () => storage.acceptTrades());
  ipcMain.handle('storage:cancel', () => storage.cancelTransfers());
}

module.exports = { register };
