// Preload script for Electron renderer process
const { contextBridge, ipcRenderer } = require('electron');

// We can expose specific IPC methods here if needed
contextBridge.exposeInMainWorld('electronAPI', {
    // Basic examples
    sendMessage: (channel, data) => ipcRenderer.send(channel, data),
    onMessage: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args))
});
