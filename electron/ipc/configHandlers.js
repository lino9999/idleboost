const { ipcMain } = require('electron');
const home = require('../core/asfHome');

function register(ctx) {
  const { store, getAsfDir, readSettings } = ctx;

  // Number of bot config files on disk. Read from the file system, so it is
  // available even while ASF is still booting (IPC down). Lets the UI tell
  // "no bots imported" apart from "bots exist but are still loading".
  ipcMain.handle('config:botCount', () => home.listBotNames(getAsfDir()).length);

  ipcMain.handle('config:read', () => home.readAsfJson(getAsfDir()));
  ipcMain.handle('config:update', (_e, partial) => {
    const dir = getAsfDir();
    const current = home.readAsfJson(dir);
    const next = { ...current, ...(partial || {}) };
    for (const key of Object.keys(partial || {})) {
      if (partial[key] === null) delete next[key];
    }
    home.writeAsfJson(dir, next);
    home.ensureCoreFlags(dir);
    return home.readAsfJson(dir);
  });
  ipcMain.handle('config:replace', (_e, full) => {
    const dir = getAsfDir();
    home.writeAsfJson(dir, full || {});
    home.ensureCoreFlags(dir);
    return home.readAsfJson(dir);
  });

  ipcMain.handle('settings:get', readSettings);
  ipcMain.handle('settings:set', (_e, patch) => {
    store.set('settings', { ...readSettings(), ...(patch || {}) });
    return readSettings();
  });
}

module.exports = { register };
