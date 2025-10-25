const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,
  
  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  
  // Check if window is maximized
  onMaximizeChange: (callback) => ipcRenderer.on('window-maximized', callback),
  onUnmaximizeChange: (callback) => ipcRenderer.on('window-unmaximized', callback)
});

// Log that preload script has loaded
console.log('✅ Electron preload script loaded');
