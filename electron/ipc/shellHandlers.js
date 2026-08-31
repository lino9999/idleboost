const { ipcMain, shell, app } = require('electron');

const ALLOWED = /^https:\/\/(steamcommunity\.com|store\.steampowered\.com|telegram\.me|t\.me|suborbit\.al|github\.com)\//i;

function register() {
  ipcMain.handle('shell:openExternal', (_e, url) => {
    const target = String(url || '');
    if (!ALLOWED.test(target)) return false;
    shell.openExternal(target);
    return true;
  });

  // Opens the %APPDATA% folder where the app keeps its local files
  // (bot configs, database, ASF working directory).
  ipcMain.handle('shell:openDataDir', async () => {
    const err = await shell.openPath(app.getPath('userData'));
    if (err) throw new Error(err);
    return true;
  });
}

module.exports = { register };
