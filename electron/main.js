const { app, BrowserWindow, protocol } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let serverProcess;
const SERVER_PORT = 3000;

// Enable live reload for development
const isDev = !app.isPackaged;

function startUnifiedServer() {
  console.log('🚀 Starting unified-server...');
  
  // In production (packaged), files are in app.asar.unpacked
  // In development, files are in project root
  const appPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : path.join(__dirname, '..');
  
  const serverPath = path.join(appPath, 'unified-server.js');
  
  if (!fs.existsSync(serverPath)) {
    console.error('❌ unified-server.js not found at:', serverPath);
    console.error('   App path:', appPath);
    console.error('   Resources path:', process.resourcesPath);
    return null;
  }
  
  console.log('✅ Found server at:', serverPath);
  console.log('   Working directory:', appPath);
  
  // Start unified-server as child process
  const server = spawn('node', [serverPath], {
    cwd: appPath, // Important: set working directory so dist/ is found
    env: {
      ...process.env,
      PORT: SERVER_PORT,
      NODE_ENV: isDev ? 'development' : 'production'
    },
    stdio: 'inherit'
  });
  
  server.on('error', (err) => {
    console.error('❌ Failed to start unified-server:', err);
  });
  
  server.on('exit', (code) => {
    console.log(`📡 unified-server exited with code ${code}`);
  });
  
  return server;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    frame: false, // Remove window decorations
    transparent: false, // Keep opaque background
    titleBarStyle: 'hidden', // Hide title bar on macOS
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    title: 'SubCaster',
    backgroundColor: '#1a1a1a',
    show: false // Don't show until ready
  });
  
  // Show window when ready to prevent flashing
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  // Handle window controls
  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximized');
  });
  
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-unmaximized');
  });
  
  // Wait for server to start, then load the app
  console.log('⏳ Waiting for server to start...');
  
  setTimeout(() => {
    const startUrl = `http://localhost:${SERVER_PORT}`;
    console.log('🌐 Loading app from:', startUrl);
    mainWindow.loadURL(startUrl);
  }, 2000); // Give server 2 seconds to start
  
  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Handle window control IPC messages
  const { ipcMain } = require('electron');
  
  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });
  
  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });
  
  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });
  
  // Start the unified server
  serverProcess = startUnifiedServer();
  
  // Create the browser window
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Kill server process when app closes
  if (serverProcess) {
    console.log('🛑 Stopping unified-server...');
    serverProcess.kill();
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Ensure server is killed before quitting
  if (serverProcess) {
    serverProcess.kill();
  }
});

// Handle any uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
