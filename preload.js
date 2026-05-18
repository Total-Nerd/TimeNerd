// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Data
  getData: () => ipcRenderer.invoke('get-data'),
  setData: (data) => ipcRenderer.invoke('set-data', data),
  getCustomers: () => ipcRenderer.invoke('get-customers'),
  setCustomers: (customers) => ipcRenderer.invoke('set-customers', customers),
  
  // Theme
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  onThemeUpdate: (callback) => ipcRenderer.on('theme-updated', (event, ...args) => callback(...args)),
  
  // File System
  saveCsv: (payload) => ipcRenderer.invoke('save-csv', payload),
  exportData: (data) => ipcRenderer.invoke('export-data', data),
  importData: () => ipcRenderer.invoke('import-data'),
  
  // Sync & Auth
  getSyncSettings: () => ipcRenderer.invoke('get-sync-settings'),
  saveSyncSettings: (settings) => ipcRenderer.invoke('save-sync-settings', settings),
  serverRequest: (payload) => ipcRenderer.invoke('server-request', payload),
  onDataUpdated: (callback) => ipcRenderer.on('data-updated', (event, ...args) => callback(...args)),

  // Idle Time
  getSystemIdleTime: () => ipcRenderer.invoke('get-system-idle-time')
});