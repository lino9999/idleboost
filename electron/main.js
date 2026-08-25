const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { JsonStore } = require('./core/store');
const home = require('./core/asfHome');
const { AsfApi } = require('./asf/asfApi');
const { AsfManager } = require('./asf/asfManager');
const { RotationEngine } = require('./services/rotation');
const { PluginScheduler } = require('./services/pluginScheduler');
const { StorageManager } = require('./services/storageManager');
const { UpdateManager } = require('./services/updater');
const { DataSync } = require('./services/dataSync');
const { HoursBooster } = require('./services/hoursBooster');
const { ProfileSetup } = require('./services/profileSetup');
const { LibrarySync } = require('./services/librarySync');
const { FreeGames } = require('./services/freeGames');
const { BanChecker } = require('./services/banChecker');
const { CardWatcher } = require('./services/cardWatcher');
const { LocalDatabase } = require('./db/database');
const { Notifier } = require('./services/notifier');
const { SteamWeb } = require('./asf/steamWeb');
const asfHandlers = require('./ipc/asfHandlers');
const configHandlers = require('./ipc/configHandlers');
const rotationHandlers = require('./ipc/rotationHandlers');
const pluginHandlers = require('./ipc/pluginHandlers');
const importHandlers = require('./ipc/importHandlers');
const proxyHandlers = require('./ipc/proxyHandlers');
const storageHandlers = require('./ipc/storageHandlers');
const updaterHandlers = require('./ipc/updaterHandlers');
const databaseHandlers = require('./ipc/databaseHandlers');
const hoursHandlers = require('./ipc/hoursHandlers');
const profileHandlers = require('./ipc/profileHandlers');
const shellHandlers = require('./ipc/shellHandlers');
const libraryHandlers = require('./ipc/libraryHandlers');
const banHandlers = require('./ipc/banHandlers');
const notifierHandlers = require('./ipc/notifierHandlers');

const APP_FOLDER = 'Steam Warming UP';
const DISPLAY_NAME = 'IdleBoost';
const LEGACY_FOLDERS = ['Steam WarnUP'];
const IS_DEV = !!process.env.VITE_DEV_SERVER_URL;
const DEFAULT_SETTINGS = { ipcUrl: 'http://127.0.0.1:1242', ipcPassword: '' };
const MAX_LOG_LINES = 2500;

function initUserData() {
  const appData = app.getPath('appData');
  const target = path.join(appData, APP_FOLDER);
  for (const legacy of LEGACY_FOLDERS) {
    const old = path.join(appData, legacy);
    if (!fs.existsSync(target) && fs.existsSync(old)) {
      try {
        fs.renameSync(old, target);
      } catch {
        try {
          fs.cpSync(old, target, { recursive: true });
        } catch {
          /* fall back to default userData */
        }
      }
    }
  }
  try {
    fs.mkdirSync(target, { recursive: true });
    app.setPath('userData', target);
  } catch {
    /* keep default */
  }
}

initUserData();

let win = null;
let store = null;
let api = null;
let manager = null;
let rotation = null;
let scheduler = null;
let storage = null;
let updater = null;
let dataSync = null;
let hours = null;
let profile = null;
let librarySync = null;
let freeGames = null;
let banChecker = null;
let cardWatcher = null;
let notifier = null;
let db = null;
let asfDir = '';
let logHistory = [];
let lastStatus = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    app.setName(DISPLAY_NAME);
    try {
      await boot();
    } catch (e) {
      pushLog(`[Steam Warming UP] Boot error: ${e.message}`, 'stderr');
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (rotation) rotation.stop();
  if (scheduler) scheduler.stop();
  if (storage) storage.stop();
  if (updater) updater.stop();
  if (dataSync) dataSync.stop();
  if (hours) hours.stop();
  if (profile) profile.stop();
  if (librarySync) librarySync.stop();
  if (freeGames) freeGames.stop();
  if (banChecker) banChecker.stop();
  if (cardWatcher) cardWatcher.stop();
  if (db) db.close();
  if (manager) manager.prepareForQuit();
});

function readSettings() {
  return { ...DEFAULT_SETTINGS, ...(store.get('settings', {}) || {}) };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#070a13',
    title: DISPLAY_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (IS_DEV) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.on('closed', () => {
    win = null;
  });
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function pushLog(line, stream) {
  logHistory.push({ line, stream });
  if (logHistory.length > MAX_LOG_LINES) logHistory.splice(0, logHistory.length - MAX_LOG_LINES);
}

async function boot() {
  store = new JsonStore(path.join(app.getPath('userData'), 'data'));
  const bundledAsfDir = home.resolveBundledAsfDir(app);
  asfDir = home.ensureAsfHome(app, bundledAsfDir);
  home.ensureDefaultAsfConfig(asfDir);
  if (home.ensureIpcEnabled(asfDir)) {
    pushLog('[Steam Warming UP] IPC was disabled in ASF.json - re-enabled it automatically', 'system');
  }
  if (home.ensureBandwidthSaver(asfDir)) {
    pushLog('[Steam Warming UP] Applied bandwidth-saving defaults (Min Memory Usage + FarmingDelay 60s)', 'system');
  }
  const migratedPasswords = home.migrateLegacyPasswordField(asfDir);
  if (migratedPasswords > 0) {
    pushLog(`[Steam Warming UP] Fixed ${migratedPasswords} bot config(s): password moved to the SteamPassword field required by ASF`, 'system');
  }
  if (home.ensureAsfEnhanceReady(asfDir)) {
    pushLog('[Steam Warming UP] ASFEnhance config adjusted (EULA accepted, Dev features enabled for profile customization)', 'system');
  }
  const fpNormalized = home.normalizeFreePackages(asfDir);
  if (fpNormalized > 0) {
    pushLog(
      `[Steam Warming UP] Free games redemption adjusted on ${fpNormalized} bot(s) - paused while farming/playing (no more farming interruptions), default filters applied (limited-time games + trading cards)`,
      'system'
    );
  }
  if (store.get('freePackagesEnabled', null) === true) {
    const fpHealed = home.healFreePackages(asfDir);
    if (fpHealed > 0) {
      pushLog(
        `[Steam Warming UP] Free games redemption was missing from ${fpHealed} bot config(s) - restored it before starting ASF`,
        'system'
      );
    }
  }
  const matchCleared = home.clearMatchableTypes(asfDir);
  if (matchCleared > 0) {
    pushLog(
      `[Steam Warming UP] Cleared MatchableTypes on ${matchCleared} bot(s) - stops the trade-matcher from continuously polling inventories (Steam TooManyRequests)`,
      'system'
    );
  }

  db = new LocalDatabase(path.join(app.getPath('userData'), 'data', 'warmup.db'));
  try {
    await db.init();
  } catch (e) {
    pushLog(`[Steam Warming UP] Failed to open local database: ${e.message}`, 'system');
  }

  notifier = new Notifier({
    store,
    log: (line) => pushLog(line, 'system')
  });
  notifier.on('state', (s) => send('webhook:state', s));

  const disabledCount = home.disableAllBotConfigs(asfDir);
  if (disabledCount > 0) {
    pushLog(`[Steam Warming UP] Startup: ${disabledCount} bot(s) set to disabled - start them from the Start Warming section`, 'system');
  }

  api = new AsfApi(readSettings);
  const steamWeb = new SteamWeb({
    api,
    log: (line) => pushLog(line, 'profile')
  });
  manager = new AsfManager({
    exe: path.join(bundledAsfDir, 'ArchiSteamFarm.exe'),
    homeDir: asfDir
  });
  storage = new StorageManager({
    api,
    store,
    db,
    steamWeb,
    getAsfDir: () => asfDir,
    isStandby: () => manager.standby,
    notifier,
    log: (line) => pushLog(line, 'storage')
  });
  rotation = new RotationEngine({
    api,
    store,
    db,
    getAsfDir: () => asfDir,
    isStandby: () => manager.standby,
    isStorageBot: (name) => storage.isStorage(name),
    notifier,
    log: (line) => pushLog(line, 'rotation')
  });
  storage.setManualActiveCheck((name) => rotation.isManuallyActive(name));
  scheduler = new PluginScheduler({
    api,
    store,
    db,
    isStandby: () => manager.standby,
    isStorageBot: (name) => storage.isStorage(name),
    log: (line) => pushLog(line, 'scheduler')
  });
  updater = new UpdateManager({
    api,
    manager,
    store,
    db,
    log: (line) => pushLog(line, 'updater')
  });
  dataSync = new DataSync({
    api,
    db,
    store,
    isStandby: () => manager.standby,
    isStorageBot: (name) => storage.isStorage(name),
    notifier,
    log: (line) => pushLog(line, 'datasync')
  });
  hours = new HoursBooster({
    api,
    store,
    db,
    getAsfDir: () => asfDir,
    isStorageBot: (name) => storage.isStorage(name),
    isStandby: () => manager.standby,
    log: (line) => pushLog(line, 'hours')
  });
  profile = new ProfileSetup({
    api,
    store,
    db,
    steamWeb,
    isStorageBot: (name) => storage.isStorage(name),
    isStandby: () => manager.standby,
    notifier,
    log: (line) => pushLog(line, 'profile')
  });
  librarySync = new LibrarySync({
    store,
    db,
    notifier,
    isStorageBot: (name) => storage.isStorage(name),
    isPublicBot: (name) => {
      try {
        const row = db.one("SELECT done_at FROM profile_state WHERE bot = ? AND action = 'public'", [name]);
        return !!row;
      } catch {
        return false;
      }
    },
    log: (line) => pushLog(line, 'library')
  });
  freeGames = new FreeGames({
    api,
    store,
    db,
    isStorageBot: (name) => storage.isStorage(name),
    isStandby: () => manager.standby,
    log: (line) => pushLog(line, 'freegames')
  });
  banChecker = new BanChecker({
    api,
    store,
    notifier,
    db,
    log: (line) => pushLog(line, 'banchecker')
  });
  cardWatcher = new CardWatcher({
    api,
    isStandby: () => manager.standby,
    notifier,
    log: (line) => pushLog(line, 'cards')
  });

  manager.on('log', ({ line, stream }) => {
    pushLog(line, stream);
    send('asf:log', { line, stream });
  });
  manager.on('status', (s) => send('asf:status', s));
  manager.on('standby', (s) => {
    send('standby:changed', s);
    rotation.setStandby(s.standby);
    scheduler.setStandby(s.standby);
  });
  rotation.on('state', (s) => send('rotation:state', s));
  rotation.on('prepare-progress', (p) => send('rotation:prepare-progress', p));
  rotation.on('log', ({ line }) => send('asf:log', { line, stream: 'rotation' }));
  scheduler.on('state', (s) => send('plugins:scheduler:state', s));
  scheduler.on('log', ({ line }) => send('asf:log', { line, stream: 'scheduler' }));
  storage.on('state', (s) => send('storage:state', s));
  storage.on('log', ({ line }) => send('asf:log', { line, stream: 'storage' }));
  updater.on('state', (s) => send('updater:state', s));
  updater.on('log', ({ line }) => send('asf:log', { line, stream: 'updater' }));
  dataSync.on('state', (s) => send('datasync:state', s));
  dataSync.on('log', ({ line }) => send('asf:log', { line, stream: 'datasync' }));
  hours.on('state', (s) => send('hours:state', s));
  hours.on('log', ({ line }) => send('asf:log', { line, stream: 'hours' }));
  profile.on('state', (s) => send('profile:state', s));
  profile.on('log', ({ line }) => send('asf:log', { line, stream: 'profile' }));
  freeGames.on('state', (s) => send('freegames:state', s));
  freeGames.on('log', ({ line }) => send('asf:log', { line, stream: 'freegames' }));
  librarySync.on('log', ({ line }) => send('asf:log', { line, stream: 'library' }));
  banChecker.on('state', (s) => send('ban:state', s));
  banChecker.on('log', ({ line }) => send('asf:log', { line, stream: 'banchecker' }));
  cardWatcher.on('log', ({ line }) => send('asf:log', { line, stream: 'cards' }));

  const ctx = {
    api,
    store,
    manager,
    rotation,
    scheduler,
    storage,
    updater,
    dataSync,
    hours,
    profile,
    librarySync,
    freeGames,
    banChecker,
    notifier,
    db,
    getAsfDir: () => asfDir,
    readSettings,
    log: (line, stream = 'system') => {
      pushLog(line, stream);
      send('asf:log', { line, stream });
    },
    getLogHistory: () => logHistory,
    getLastStatus: () => lastStatus,
    getWindow: () => win
  };
  asfHandlers.register(ctx);
  configHandlers.register(ctx);
  rotationHandlers.register(ctx);
  pluginHandlers.register(ctx);
  importHandlers.register(ctx);
  proxyHandlers.register(ctx);
  storageHandlers.register(ctx);
  updaterHandlers.register(ctx);
  databaseHandlers.register(ctx);
  hoursHandlers.register(ctx);
  profileHandlers.register(ctx);
  shellHandlers.register(ctx);
  libraryHandlers.register(ctx);
  banHandlers.register(ctx);
  notifierHandlers.register(ctx);

  manager.start();
  rotation.start();
  scheduler.start();
  storage.start();
  updater.start();
  dataSync.start();
  hours.start();
  profile.start();
  librarySync.start();
  banChecker.start();
  cardWatcher.start();
  statusPoll();
  setInterval(statusPoll, 5000);
  setInterval(connectivityPoll, 20000);
}

async function statusPoll() {
  const st = manager.getStatus();
  let reachable = false;
  let version = null;
  try {
    const info = await api.getAsf();
    reachable = true;
    version = info && info.Version ? info.Version : null;
  } catch {
    reachable = false;
  }

  const prevReachable = st.ipcReachable;
  if (prevReachable === undefined) {
    st.ipcReachable = reachable;
  } else if (reachable) {
    st.ipcReachable = true;
    st._fails = 0;
  } else {
    st._fails = (st._fails || 0) + 1;
    if (st._fails >= 2) st.ipcReachable = false;
  }
  st.asfVersion = version;
  lastStatus = st;
  send('asf:status', st);
}

async function connectivityPoll() {
  try {
    const bots = (await api.getBots()) || {};
    const names = Object.keys(bots);
    const enabledCount = names.filter((n) => (bots[n].BotConfig ? bots[n].BotConfig.Enabled !== false : true)).length;
    const connectedCount = names.filter((n) => bots[n].IsConnectedAndLoggedOn).length;
    const pendingInputCount = names.filter((n) => (bots[n].RequiredInput || 0) > 0).length;
    manager.noteConnectivity({ reachable: true, botCount: names.length, enabledCount, connectedCount, pendingInputCount });
  } catch {
    manager.noteConnectivity({ reachable: false });
  }
}
