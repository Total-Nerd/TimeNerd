// main.js
// This file is the main entry point for the Electron application.
// It controls the application's lifecycle and creates the browser window.

const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell, Menu, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');
const Store = require('electron-store');
const { google } = require('googleapis');
const { autoUpdater } = require('electron-updater');

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

// --- Google API Setup ---
const CREDENTIALS_PATH = path.join(app.getAppPath(), 'credentials.json');
const TOKEN_PATH = path.join(app.getPath('userData'), 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
let oAuth2Client;
let credentials;

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


async function loadCredentialsAndAuthorize() {
    try {
        const credentialsContent = fs.readFileSync(CREDENTIALS_PATH);
        credentials = JSON.parse(credentialsContent).installed;
        
        oAuth2Client = new google.auth.OAuth2(
            credentials.client_id,
            credentials.client_secret,
            credentials.redirect_uris[0]
        );

        if (fs.existsSync(TOKEN_PATH)) {
            const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
            oAuth2Client.setCredentials(token);
        }
    } catch (err) {
        console.error('Error loading client secret file:', err);
        dialog.showErrorBox('Credentials Error', 'Could not load credentials.json. Please ensure it is in the root directory.');
        return null;
    }
}

function getNewToken() {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                const qs = new url.URL(req.url, 'http://localhost').searchParams;
                const code = qs.get('code');
                res.end('Authentication successful! You can now close this window.');
                
                server.close();

                if (!code) {
                    return reject(new Error("Authorization code not found."));
                }

                const { tokens } = await oAuth2Client.getToken(code);
                oAuth2Client.setCredentials(tokens);
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                resolve(true);
            } catch (e) {
                reject(e);
            }
        }).listen(0, () => { // Listen on a random available port
            const port = server.address().port;
            const redirectUri = `http://localhost:${port}`;
            oAuth2Client.redirectUri = redirectUri;

            const authUrl = oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: SCOPES,
            });
            shell.openExternal(authUrl);
        });

        server.on('error', (err) => {
            reject(err);
        });
    });
}

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

// --- Auto-Updater Setup ---
autoUpdater.autoDownload = false; // We want manual control via UI

autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update-available', info);
});

autoUpdater.on('update-not-available', (info) => {
    mainWindow.webContents.send('update-not-available', info);
});

autoUpdater.on('error', (err) => {
    mainWindow.webContents.send('update-error', err.message);
});

autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send('update-progress', progressObj);
});

autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update-downloaded', info);
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
    await loadCredentialsAndAuthorize();
    createWindow();

    // Check for updates on startup
    autoUpdater.checkForUpdatesAndNotify();
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

// IPC handlers for the offline sync queue
ipcMain.handle('get-pending-syncs', () => store.get('pendingSheetSyncs', []));
ipcMain.handle('set-pending-syncs', (event, queue) => store.set('pendingSheetSyncs', queue));


// IPC handler for Google Sheets URL
ipcMain.handle('get-sheet-url', () => store.get('google_sheet_url', ''));
ipcMain.handle('set-sheet-url', (event, url) => store.set('google_sheet_url', url));

// IPC handler for linking Google Sheet
ipcMain.handle('link-google-sheet', async () => {
    if (!oAuth2Client) return { success: false, error: 'Credentials not loaded.' };
    try {
        const tokenSuccess = await getNewToken();
        if (!tokenSuccess) {
            return { success: false, error: 'Authentication failed.' };
        }

        const sheetUrl = store.get('google_sheet_url');
        if (!sheetUrl) return { success: false, error: 'No Google Sheet URL configured.' };

        const match = sheetUrl.match(/\/d\/(.+?)\//);
        if (!match || !match[1]) return { success: false, error: 'Invalid Google Sheet URL format.' };
        const spreadsheetId = match[1];

        const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });
        
        const projects = store.get('projects', []);

        const headers = ['Project', 'Task', 'Customer', 'Tags', 'Start Date', 'Start Time', 'End Date', 'End Time', 'Duration (HH:MM:SS)'];
        const allRows = projects.flatMap(project =>
            project.tasks.flatMap(task =>
                task.logs.map(log => {
                    const startDate = new Date(log.start);
                    const endDate = new Date(log.end);
                    return [
                        project.name,
                        task.name,
                        project.customer || 'N/A', // <-- Corrected this line
                        task.tags.join(', '),
                        formatDate(startDate),
                        startDate.toLocaleTimeString(),
                        formatDate(endDate),
                        endDate.toLocaleTimeString(),
                        formatTime(endDate - startDate)
                    ];
                })
            )
        );

        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: 'Sheet1',
        });

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'A1',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [headers, ...allRows],
            },
        });

        return { success: true };
    } catch (error) {
        console.error("Linking sheet and syncing failed:", error);
        return { success: false, error: error.message };
    }
});

// IPC handler to append data to the sheet
ipcMain.handle('append-to-sheet', async (event, rowData) => {
    if (!oAuth2Client || !oAuth2Client.credentials || !oAuth2Client.credentials.access_token) {
        return { success: false, error: 'Not authenticated.' };
    }
    const sheetUrl = store.get('google_sheet_url');
    if (!sheetUrl) return { success: false, error: 'No Google Sheet URL configured.' };

    const match = sheetUrl.match(/\/d\/(.+?)\//);
    if (!match || !match[1]) return { success: false, error: 'Invalid Google Sheet URL format.' };
    const spreadsheetId = match[1];

    const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId, range: 'A1', valueInputOption: 'USER_ENTERED',
            resource: { values: [rowData] },
        });
        return { success: true };
    } catch (err) {
        console.error('The API returned an error: ' + err);
        return { success: false, error: err.message };
    }
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

// --- App Updates (electron-updater) ---
ipcMain.handle('check-for-updates', () => {
    return autoUpdater.checkForUpdates();
});

ipcMain.handle('download-update', () => {
    return autoUpdater.downloadUpdate();
});

ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall();
});