const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Pin the data folder to a fixed name so renaming the app never "loses" data.
// Lives in %APPDATA%\BudgetTracker — installers and updates never touch it.
app.setPath('userData', path.join(app.getPath('appData'), 'BudgetTracker'));

const DATA_DIR = app.getPath('userData');
const DATA_FILE = path.join(DATA_DIR, 'budget-data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 30;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let mainWindow = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---------- Data storage ----------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .map((f) => path.join(BACKUP_DIR, f));
}

function readData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      return readJson(DATA_FILE);
    } catch (err) {
      console.error('Data file unreadable, falling back to latest backup:', err);
    }
  }
  for (const backup of listBackups()) {
    try {
      return readJson(backup);
    } catch {
      // try the next older backup
    }
  }
  return null;
}

function writeData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

// One backup per day, keeping the most recent MAX_BACKUPS.
function backupDaily() {
  if (!fs.existsSync(DATA_FILE)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(BACKUP_DIR, `budget-data-${stamp}.json`);
  if (!fs.existsSync(target)) fs.copyFileSync(DATA_FILE, target);
  for (const old of listBackups().slice(MAX_BACKUPS)) fs.unlinkSync(old);
}

// ---------- Window ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Budget Tracker',
    backgroundColor: '#0f172a',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => (mainWindow = null));
}

function sendUpdateStatus(status, detail = '') {
  if (mainWindow) mainWindow.webContents.send('update:status', { status, detail });
}

// ---------- Auto-update (GitHub Releases) ----------

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', (info) => sendUpdateStatus('downloading', info.version));
  autoUpdater.on('update-not-available', () => sendUpdateStatus('current'));
  autoUpdater.on('download-progress', (p) => sendUpdateStatus('downloading', `${Math.round(p.percent)}%`));
  autoUpdater.on('error', (err) => sendUpdateStatus('error', err ? err.message : ''));
  autoUpdater.on('update-downloaded', async (info) => {
    sendUpdateStatus('ready', info.version);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Budget Tracker ${info.version} has been downloaded.`,
      detail: 'Restart to finish updating. Your data is kept. If you choose Later, it installs the next time you close the app.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), UPDATE_CHECK_INTERVAL_MS);
}

// ---------- IPC ----------

ipcMain.handle('data:load', () => readData());

ipcMain.handle('data:save', (_e, data) => {
  writeData(data);
  return true;
});

ipcMain.handle('data:exportJson', async (_e, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export backup',
    defaultPath: `budget-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return true;
});

ipcMain.handle('data:exportCsv', async (_e, csv) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export transactions',
    defaultPath: `transactions-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, '﻿' + csv, 'utf8');
  return true;
});

ipcMain.handle('data:importJson', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import backup',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return null;
  return readJson(filePaths[0]);
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  dataFile: DATA_FILE,
  packaged: app.isPackaged,
}));

ipcMain.handle('app:openDataFolder', () => shell.openPath(DATA_DIR));

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) {
    sendUpdateStatus('dev');
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    sendUpdateStatus('error', err.message);
  }
});

// ---------- Lifecycle ----------

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  try {
    backupDaily();
  } catch (err) {
    console.error('Backup failed:', err);
  }
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => app.quit());
