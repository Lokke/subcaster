const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,
  
  // Example: Add app-specific APIs here if needed
  // For now, SubCaster works fully through the web interface
});

// Log that preload script has loaded
console.log('✅ Electron preload script loaded');
