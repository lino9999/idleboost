const { ipcMain } = require('electron');

function register(ctx) {
  const { db, dataSync, storage } = ctx;

  ipcMain.handle('db:overview', () => {
    const bots = db.query('SELECT * FROM bots ORDER BY name ASC');
    const gameCounts = db.query('SELECT bot, COUNT(*) AS c FROM games GROUP BY bot');
    const gMap = {};
    for (const r of gameCounts) gMap[r.bot] = r.c;
    return bots.map((b) => ({
      ...b,
      is_storage: !!b.is_storage,
      games: gMap[b.name] || 0,
      cards: Number(b.cards_left) || 0,
      storage: storage.isStorage(b.name)
    }));
  });

  ipcMain.handle('db:bot', (_e, name) => {
    const bot = db.one('SELECT * FROM bots WHERE name = ?', [name]);
    const history = db.query(
      'SELECT balance, currency, ts FROM wallet_snapshots WHERE bot = ? ORDER BY ts DESC LIMIT 60',
      [name]
    );
    return { bot, history };
  });

  ipcMain.handle('db:games', (_e, name) =>
    db.query('SELECT * FROM games WHERE bot = ? ORDER BY name ASC', [name])
  );

  ipcMain.handle('db:botStats', () => db.query('SELECT * FROM bot_stats'));

  ipcMain.handle('db:sync', () => dataSync.sync(true));
  ipcMain.handle('db:syncState', () => dataSync.getState());
  ipcMain.handle('db:redeems', () => db.query('SELECT * FROM redeem_log ORDER BY ts DESC LIMIT 100'));

  ipcMain.handle('db:logs', () => ({
    transfers: db.query('SELECT * FROM transfer_log ORDER BY ts DESC LIMIT 50'),
    updates: db.query('SELECT * FROM update_log ORDER BY ts DESC LIMIT 50')
  }));

  ipcMain.handle('db:totals', () => {
    const bots = db.query('SELECT COUNT(*) AS c FROM bots');
    const games = db.query('SELECT COUNT(*) AS c FROM games');
    const hours = db.query('SELECT COALESCE(SUM(hours_played), 0) AS h FROM games');
    const snaps = db.query('SELECT COUNT(*) AS c FROM wallet_snapshots');
    return {
      bots: bots[0] ? bots[0].c : 0,
      games: games[0] ? games[0].c : 0,
      snapshots: snaps[0] ? snaps[0].c : 0,
      totalHours: Math.round(hours[0] ? hours[0].h : 0),
      redeemed: parseInt(db.getKV('redeemed', '0'), 10) || 0
    };
  });

  ipcMain.handle('db:reset', () => {
    const tables = ['bots', 'wallet_snapshots', 'games', 'redeem_log', 'update_log', 'profile_state', 'bot_stats', 'kv'];
    for (const t of tables) {
      try {
        db.run(`DELETE FROM ${t}`);
      } catch {
        /* table may not exist */
      }
    }
    db.flush();
    return { reset: true };
  });
}

module.exports = { register };
