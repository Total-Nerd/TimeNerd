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
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, info) => callback(info)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', (event, info) => callback(info)),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (event, message) => callback(message)),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (event, progressObj) => callback(progressObj)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, info) => callback(info))
});