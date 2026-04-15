// main.js
// This file is the main entry point for the Electron application.
// It controls the application's lifecycle and creates the browser window.

const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell, Menu, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');
const Store = require('electron-store');

// Add this line for auto-reloading in development
try {
    require('electron-reloader')(module);
} catch (_) {}

// Initialize electron-store to persist application data.
const store = new Store({
    defaults: {
        projects: []
    }
});

let mainWindow;

// --- Utility Functions ---
const formatTime = (ms) => {
    if (isNaN(ms) || ms < 0) return '00:00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
};

const formatDate = (date) => {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
};


function createWindow() {
    // Create the browser window.
    const isWindows = process.platform === 'win32';
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: true,
        titleBarStyle: true,
        webPreferences: {
            // Preload script to securely expose Node.js APIs to the renderer process.
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Listen for changes in the OS theme and notify the renderer process.
    nativeTheme.on('updated', () => {
        mainWindow.webContents.send('theme-updated', nativeTheme.shouldUseDarkColors);
    });

    // Load the index.html of the app.
    mainWindow.loadFile('index.html');
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
    createWindow();
    if (process.platform === 'win32') {
        Menu.setApplicationMenu(null);
    }

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// IPC handler to get data from storage.
ipcMain.handle('get-data', async () => {
    return store.get('projects', []);
});

// IPC handler to set data in storage.
ipcMain.handle('set-data', async (event, projects) => {
    store.set('projects', projects);
});

// IPC handler to set the application's theme source.
ipcMain.handle('set-theme', (event, theme) => {
    nativeTheme.themeSource = theme; // 'system', 'light', or 'dark'
    return nativeTheme.shouldUseDarkColors;
});

// IPC handler to export all data as a JSON file.
ipcMain.handle('export-data', async (event, data) => {
    // --- Create a formatted timestamp ---
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}${month}${day}-${hours}${minutes}${seconds}`;
    // --- End of timestamp creation ---

    const { filePath } = await dialog.showSaveDialog({
        title: 'Export Data Backup',
        // Use the timestamp in the default filename
        defaultPath: `time-nerd-backup-${timestamp}.json`,
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (filePath) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            return { success: true, path: filePath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    return { success: false, error: 'Save dialog cancelled.' };
});

// IPC handler to import all data as a JSON file.
ipcMain.handle('import-data', async (event) => {
    const { filePaths } = await dialog.showOpenDialog({
        title: 'Import Backup',
        properties: ['openFile'],
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (filePaths && filePaths.length > 0) {
        try {
            const data = fs.readFileSync(filePaths[0], 'utf-8');
            return { success: true, data: JSON.parse(data) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    return { success: false, error: 'Open dialog cancelled.' };
});

// IPC handler to save a CSV file.
ipcMain.handle('save-csv', async (event, payload) => {
    const { data, defaultPath } = payload; // Destructure the payload object here
    
    const { filePath } = await dialog.showSaveDialog({
        title: 'Save Time Log as CSV',
        defaultPath: `${defaultPath}.csv`,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (filePath) {
        try {
            // Ensure 'data' is a string before writing.
            if (typeof data !== 'string') {
                throw new Error('Invalid data format: CSV data must be a string.');
            }
            fs.writeFileSync(filePath, data, 'utf-8');
            return { success: true, path: filePath };
        } catch (error) {
            console.error('Failed to save the file:', error);
            return { success: false, error: error.message };
        }
    }
    return { success: false, error: 'Save dialog cancelled by user.' };
});

// IPC handler to handle Idle Time Detection
ipcMain.handle('get-system-idle-time', () => {
    return powerMonitor.getSystemIdleTime();
});