const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  exportJson: (data) => ipcRenderer.invoke('data:exportJson', data),
  exportCsv: (csv) => ipcRenderer.invoke('data:exportCsv', csv),
  importJson: () => ipcRenderer.invoke('data:importJson'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, payload) => cb(payload)),
});
