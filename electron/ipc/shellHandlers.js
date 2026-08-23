const { ipcMain, shell } = require('electron');

const ALLOWED = /^https:\/\/(steamcommunity\.com|store\.steampowered\.com|telegram\.me|t\.me)\//i;

function register() {
  ipcMain.handle('shell:openExternal', (_e, url) => {
    const target = String(url || '');
    if (!ALLOWED.test(target)) return false;
    shell.openExternal(target);
    return true;
  });
}

module.exports = { register };
