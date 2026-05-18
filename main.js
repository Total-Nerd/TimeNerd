// main.js
const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell, Menu, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { getDatabase } = require('./db');
const axios = require('axios');
const { replicateRxCollection } = require('rxdb/plugins/replication');

// Add this line for auto-reloading in development
try {
    require('electron-reloader')(module);
} catch (_) {}

const store = new Store();
let mainWindow;
let db;

async function migrateData() {
    const projects = store.get('projects', []);
    const customers = store.get('customers', []);
    
    if (projects.length > 0 || customers.length > 0) {
        console.log('Migrating data to RxDB...');
        for (const p of projects) {
            await db.projects.insert({
                ...p,
                id: String(p.id),
                updatedAt: Date.now()
            });
        }
        for (const c of customers) {
            await db.customers.insert({
                ...c,
                id: String(c.id),
                updatedAt: Date.now()
            });
        }
        // Clear old store to prevent re-migration
        store.delete('projects');
        store.delete('customers');
        console.log('Migration complete.');
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: true,
        titleBarStyle: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    nativeTheme.on('updated', () => {
        mainWindow.webContents.send('theme-updated', nativeTheme.shouldUseDarkColors);
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(async () => {
    const storagePath = app.getPath('userData');
    db = await getDatabase(storagePath);
    
    await migrateData();
    setupSync();
    
    const win = createWindow();
    setupDataListeners(win);

    if (process.platform === 'win32') {
        Menu.setApplicationMenu(null);
    }

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) {
            const newWin = createWindow();
            setupDataListeners(newWin);
        }
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handlers (RxDB) ---

ipcMain.handle('get-data', async () => {
    const docs = await db.projects.find().exec();
    return docs.map(d => d.toJSON());
});

ipcMain.handle('set-data', async (event, projects) => {
    // RxDB prefers atomic updates, but for now we'll do upserts to match the bulk 'set-data' call
    for (const p of projects) {
        await db.projects.upsert({
            ...p,
            id: String(p.id),
            updatedAt: Date.now()
        });
    }
});

ipcMain.handle('get-customers', async () => {
    const docs = await db.customers.find().exec();
    return docs.map(d => d.toJSON());
});

ipcMain.handle('set-customers', async (event, customers) => {
    for (const c of customers) {
        await db.customers.upsert({
            ...c,
            id: String(c.id),
            updatedAt: Date.now()
        });
    }
});

ipcMain.handle('set-theme', (event, theme) => {
    nativeTheme.themeSource = theme;
    return nativeTheme.shouldUseDarkColors;
});

// --- Sync Handlers ---

let replications = [];

async function setupSync() {
    const settings = await db.settings.findOne('current').exec();
    if (settings && settings.isSyncEnabled && settings.syncServerUrl && settings.syncToken) {
        startReplication(settings.syncServerUrl, settings.syncToken);
    }
}

function startReplication(url, token) {
    // Stop existing
    replications.forEach(r => r.cancel());
    replications = [];

    const collections = ['projects', 'customers'];
    collections.forEach(colName => {
        const replicationState = replicateRxCollection({
            collection: db[colName],
            replicationIdentifier: `http-sync-${colName}`,
            waitForLeadership: true,
            pull: {
                async handler(lastPulledCheckpoint, batchSize) {
                    try {
                        const res = await axios.post(`${url}/api/sync/pull`, {
                            collection: colName,
                            lastCheckpoint: lastPulledCheckpoint,
                            limit: batchSize
                        }, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        return {
                            documents: res.data.documents,
                            checkpoint: res.data.checkpoint
                        };
                    } catch (err) {
                        console.error(`Pull error for ${colName}:`, err.message);
                        return { documents: [], checkpoint: lastPulledCheckpoint };
                    }
                }
            },
            push: {
                async handler(docs) {
                    try {
                        await axios.post(`${url}/api/sync/push`, {
                            collection: colName,
                            events: docs
                        }, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        return []; // Success returns empty array
                    } catch (err) {
                        console.error(`Push error for ${colName}:`, err.message);
                        return docs; // Return failed docs to retry
                    }
                }
            }
        });
        replications.push(replicationState);
    });
}

ipcMain.handle('get-sync-settings', async () => {
    const settings = await db.settings.findOne('current').exec();
    return settings ? settings.toJSON() : null;
});

ipcMain.handle('save-sync-settings', async (event, settings) => {
    const current = await db.settings.upsert({
        ...settings,
        id: 'current',
        updatedAt: Date.now()
    });
    if (current.isSyncEnabled && current.syncServerUrl && current.syncToken) {
        startReplication(current.syncServerUrl, current.syncToken);
    } else {
        replications.forEach(r => r.cancel());
        replications = [];
    }
    return current.toJSON();
});

ipcMain.handle('server-request', async (event, { url, method, data, token }) => {
    try {
        const config = {
            method,
            url,
            data,
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        };
        const res = await axios(config);
        return { success: true, data: res.data };
    } catch (err) {
        return { success: false, error: err.response?.data?.error || err.message };
    }
});

// --- Other Handlers ---

ipcMain.handle('export-data', async (event, data) => {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const { filePath } = await dialog.showSaveDialog({
        title: 'Export Data Backup',
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

ipcMain.handle('save-csv', async (event, payload) => {
    const { data, defaultPath } = payload;
    const { filePath } = await dialog.showSaveDialog({
        title: 'Save Time Log as CSV',
        defaultPath: `${defaultPath}.csv`,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (filePath) {
        try {
            fs.writeFileSync(filePath, data, 'utf-8');
            return { success: true, path: filePath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    return { success: false, error: 'Save dialog cancelled.' };
});

ipcMain.handle('get-system-idle-time', () => {
    return powerMonitor.getSystemIdleTime();
});

function setupDataListeners(mainWindow) {
    const collections = ['projects', 'customers', 'settings'];
    collections.forEach(colName => {
        db[colName].$.subscribe(changeEvent => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('data-updated', {
                    collection: colName,
                    event: changeEvent
                });
            }
        });
    });
}