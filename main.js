const { app, BrowserWindow, Menu, Tray } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;
let serverProcess;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        titleBarStyle: 'hiddenInset', // Better for macOS
        vibrancy: 'under-window', // macOS specific glassmorphism
        visualEffectState: 'active',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false
    });

    // Start the express server
    serverProcess = fork(path.join(__dirname, 'index.js'), [], {
        env: { ...process.env, ELECTRON_RUN: 'true' }
    });

    serverProcess.on('message', (msg) => {
        if (msg === 'server-started') {
            mainWindow.loadURL('http://localhost:3000');
            mainWindow.once('ready-to-show', () => {
                mainWindow.show();
            });
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.on('ready', () => {
    createWindow();
    
    // Set up a basic menu
    const template = [
        {
            label: 'Mouse Control',
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        }
    ];
    
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// Clean up server process on quit
app.on('will-quit', () => {
    if (serverProcess) {
        serverProcess.kill();
    }
});
