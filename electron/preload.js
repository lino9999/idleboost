const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const on = (channel, callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('asf', {
  status: () => invoke('asf:status'),
  start: () => invoke('asf:start'),
  stop: () => invoke('asf:stop'),
  restart: () => invoke('asf:restart'),
  logHistory: () => invoke('asf:log-history'),
  asfPath: () => invoke('asf:path'),
  command: (cmd) => invoke('asf:command', cmd),
  onLog: (cb) => on('asf:log', cb),
  onStatus: (cb) => on('asf:status', cb),
  onStandby: (cb) => on('standby:changed', cb),

  getAsfInfo: () => invoke('api:getAsf'),
  getBots: () => invoke('api:getBots'),
  get2faToken: (names) => invoke('api:get2faToken', names),
  startBots: (names) => invoke('api:startBots', names),
  stopBots: (names) => invoke('api:stopBots', names),
  setBotEnabled: (name, enabled) => invoke('api:setBotEnabled', name, enabled),
  saveBots: (configs) => invoke('api:saveBots', configs),
  deleteBots: (names) => invoke('api:deleteBots', names),

  configRead: () => invoke('config:read'),
  configUpdate: (partial) => invoke('config:update', partial),
  configReplace: (full) => invoke('config:replace', full),

  settingsGet: () => invoke('settings:get'),
  settingsSet: (patch) => invoke('settings:set', patch),

  rotationGet: () => invoke('rotation:get'),
  rotationSet: (cfg) => invoke('rotation:set', cfg),
  rotationPrepare: () => invoke('rotation:prepare'),
  rotationStartManual: (name) => invoke('rotation:startManual', name),
  rotationStopManual: (name) => invoke('rotation:stopManual', name),
  onRotation: (cb) => on('rotation:state', cb),
  onRotationPrepareProgress: (cb) => on('rotation:prepare-progress', cb),

  schedulerGet: () => invoke('plugins:scheduler:get'),
  schedulerSet: (cfg) => invoke('plugins:scheduler:set', cfg),
  schedulerRun: () => invoke('plugins:scheduler:run'),
  onScheduler: (cb) => on('plugins:scheduler:state', cb),

  freePackagesGet: () => invoke('plugins:freepackages:get'),
  freePackagesApply: (patch) => invoke('plugins:freepackages:apply', patch),

  asfenhanceGet: () => invoke('plugins:asfenhance:get'),
  asfenhanceSet: (obj) => invoke('plugins:asfenhance:set', obj),

  openFiles: (opts) => invoke('dialog:openFiles', opts),
  readText: (p) => invoke('fs:readText', p),
  importAccounts: (payload) => invoke('import:accounts', payload),
  importMafiles: (payload) => invoke('import:mafiles', payload),

  proxyList: () => invoke('proxy:list'),
  proxyApply: (payload) => invoke('proxy:apply', payload),
  proxyBulkAssign: (payload) => invoke('proxy:bulkAssign', payload),
  proxyRemoveAll: () => invoke('proxy:removeAll'),

  storageGet: () => invoke('storage:get'),
  storageSetConfig: (cfg) => invoke('storage:setConfig', cfg),
  storageSetAccounts: (names) => invoke('storage:setAccounts', names),
  storageSetTradeLink: (name, tradeLink) => invoke('storage:setTradeLink', name, tradeLink),
  storageTransfer: () => invoke('storage:transfer'),
  storageAcceptTrades: () => invoke('storage:acceptTrades'),
  storageCancel: () => invoke('storage:cancel'),
  onStorage: (cb) => on('storage:state', cb),

  updaterGet: () => invoke('updater:get'),
  updaterSet: (cfg) => invoke('updater:setConfig', cfg),
  updaterCheck: () => invoke('updater:check'),
  onUpdater: (cb) => on('updater:state', cb),

  dbOverview: () => invoke('db:overview'),
  dbBot: (name) => invoke('db:bot', name),
  dbBotStats: () => invoke('db:botStats'),
  dbGames: (name) => invoke('db:games', name),
  dbSync: () => invoke('db:sync'),
  dbSyncState: () => invoke('db:syncState'),
  dbRedeems: () => invoke('db:redeems'),
  dbTotals: () => invoke('db:totals'),
  dbReset: () => invoke('db:reset'),
  dbLogs: () => invoke('db:logs'),
  onDbSync: (cb) => on('datasync:state', cb),

  hoursGet: () => invoke('hours:get'),
  hoursSet: (cfg) => invoke('hours:setConfig', cfg),
  hoursRun: () => invoke('hours:run'),
  onHours: (cb) => on('hours:state', cb),

  profileGet: () => invoke('profile:get'),
  profileSet: (cfg) => invoke('profile:setConfig', cfg),
  profileRun: () => invoke('profile:run'),
  onProfile: (cb) => on('profile:state', cb),

  libraryGetKeys: () => invoke('library:getKeys'),
  librarySetKeys: (keys) => invoke('library:setKeys', keys),
  libraryGetDelay: () => invoke('library:getDelay'),
  librarySetDelay: (seconds) => invoke('library:setDelay', seconds),

  freeGamesGet: () => invoke('freegames:get'),
  freeGamesSet: (cfg) => invoke('freegames:setConfig', cfg),
  freeGamesFetch: () => invoke('freegames:fetch'),
  freeGamesRedeem: () => invoke('freegames:redeem'),
  onFreeGames: (cb) => on('freegames:state', cb),

  banGet: () => invoke('ban:get'),
  banSetConfig: (cfg) => invoke('ban:setConfig', cfg),
  banCheckAll: () => invoke('ban:checkAll'),
  banStop: () => invoke('ban:stop'),
  onBan: (cb) => on('ban:state', cb),

  webhookGet: () => invoke('webhook:get'),
  webhookSet: (cfg) => invoke('webhook:set'),
  onWebhook: (cb) => on('webhook:state', cb),

  appUpdateGet: () => invoke('appupdate:get'),
  appUpdateCheck: () => invoke('appupdate:check'),
  appUpdateInstall: () => invoke('appupdate:install'),
  onAppUpdate: (cb) => on('appupdate:state', cb),

  openExternal: (url) => invoke('shell:openExternal', url)
});
