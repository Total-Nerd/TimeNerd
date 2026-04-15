// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Data
  getData: () => ipcRenderer.invoke('get-data'),
  setData: (data) => ipcRenderer.invoke('set-data', data),
  
  // Theme
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  onThemeUpdate: (callback) => ipcRenderer.on('theme-updated', (event, ...args) => callback(...args)),
  
  // File System
  saveCsv: (payload) => ipcRenderer.invoke('save-csv', payload),
  exportData: (data) => ipcRenderer.invoke('export-data', data),
  importData: () => ipcRenderer.invoke('import-data'),
  
  // Idle Time
  getSystemIdleTime: () => ipcRenderer.invoke('get-system-idle-time'),
  
  // Google Sheets
  getSheetUrl: () => ipcRenderer.invoke('get-sheet-url'),
  setSheetUrl: (url) => ipcRenderer.invoke('set-sheet-url', url),
  linkGoogleSheet: () => ipcRenderer.invoke('link-google-sheet'),
  appendToSheet: (data) => ipcRenderer.invoke('append-to-sheet', data),

  // Expose sync queue handlers
  getPendingSyncs: () => ipcRenderer.invoke('get-pending-syncs'),
  setPendingSyncs: (queue) => ipcRenderer.invoke('set-pending-syncs', queue),

  // App Updates
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  performUpdate: () => ipcRenderer.invoke('perform-update'),
  restartApp: () => ipcRenderer.invoke('restart-app')
});