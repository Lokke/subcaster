const { app, BrowserWindow, protocol } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let serverProcess;
const SERVER_PORT = 3000;

// Enable live reload for development
const isDev = !app.isPackaged;

// ============================================================================
// CRASH REPORTING & DEBUGGING
// ============================================================================

// Enable detailed Chromium logging
if (isDev) {
  app.commandLine.appendSwitch('enable-logging');
  app.commandLine.appendSwitch('v', '1'); // Verbose logging level
  app.commandLine.appendSwitch('vmodule', '*=1'); // Enable all module logging
  
  // Enable crash dumping
  app.commandLine.appendSwitch('enable-crash-reporter');
}

// Log file path for crash dumps
const crashDumpPath = path.join(app.getPath('userData'), 'crashes');
if (!fs.existsSync(crashDumpPath)) {
  fs.mkdirSync(crashDumpPath, { recursive: true });
}

console.log(`💾 [ELECTRON] Crash dumps will be saved to: ${crashDumpPath}`);

// Set crash reporter
const { crashReporter } = require('electron');
crashReporter.start({
  productName: 'SubCaster',
  companyName: 'SubCaster',
  submitURL: '', // We don't upload crashes, just save locally
  uploadToServer: false,
  compress: true,
  extra: {
    isDev: isDev ? 'true' : 'false',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  }
});

console.log(`🔍 [ELECTRON] Crash reporter started`);
console.log(`🔍 [ELECTRON] Crash dumps path: ${crashDumpPath}`);

// Monitor for crash dump files
const crashWatcher = setInterval(() => {
  try {
    const files = fs.readdirSync(crashDumpPath);
    const recentCrashes = files.filter(f => f.endsWith('.dmp'));
    if (recentCrashes.length > 0) {
      console.log(`💥 [ELECTRON] Found ${recentCrashes.length} crash dump(s):`);
      recentCrashes.forEach(crash => {
        console.log(`   - ${crash}`);
      });
    }
  } catch (err) {
    // Ignore errors in crash monitoring
  }
}, 5000);

// ============================================================================
// SERVER MANAGEMENT
// ============================================================================

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
    stdio: ['ignore', 'pipe', 'pipe'] // Capture stdout and stderr for logging
  });
  
  // Log unified-server output
  server.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      console.log(`[UNIFIED-SERVER] ${output}`);
    }
  });
  
  server.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      console.error(`[UNIFIED-SERVER ERROR] ${output}`);
    }
  });
  
  server.on('error', (err) => {
    console.error('❌ [ELECTRON] Failed to start unified-server:', err);
  });
  
  server.on('exit', (code, signal) => {
    console.log(`📡 [ELECTRON] unified-server exited with code ${code}, signal ${signal}`);
    if (code !== 0 && code !== null) {
      console.error(`⚠️ [ELECTRON] Unexpected unified-server exit!`);
    }
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
    console.log('✅ [ELECTRON] Window shown');
  });
  
  // Monitor renderer process crashes
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('💥 [ELECTRON] ========================================');
    console.error('💥 [ELECTRON] RENDERER PROCESS CRASHED!');
    console.error('💥 [ELECTRON] ========================================');
    console.error('💥 [ELECTRON] Timestamp:', new Date().toISOString());
    console.error('💥 [ELECTRON] Reason:', details.reason);
    console.error('💥 [ELECTRON] Exit Code:', details.exitCode, `(0x${(details.exitCode >>> 0).toString(16).toUpperCase()})`);
    
    // Decode exit code
    if (details.exitCode === -1073741819 || details.exitCode === 0xC0000005) {
      console.error('💥 [ELECTRON] ⚠️  ACCESS VIOLATION (0xC0000005)');
      console.error('💥 [ELECTRON] This means: Attempted to read/write invalid memory');
      console.error('💥 [ELECTRON] Common causes:');
      console.error('💥 [ELECTRON]   - Null pointer dereference');
      console.error('💥 [ELECTRON]   - Use-after-free');
      console.error('💥 [ELECTRON]   - Buffer overflow');
      console.error('💥 [ELECTRON]   - Audio decoder crash (LIKELY IN THIS CASE)');
    }
    
    console.error('💥 [ELECTRON] Full details:', JSON.stringify(details, null, 2));
    console.error('💥 [ELECTRON] Check crash dumps in:', crashDumpPath);
    console.error('💥 [ELECTRON] ========================================');
    
    // Try to read recent Chromium logs
    try {
      const logPath = path.join(app.getPath('userData'), 'chrome_debug.log');
      if (fs.existsSync(logPath)) {
        const logContent = fs.readFileSync(logPath, 'utf8');
        const lastLines = logContent.split('\n').slice(-50).join('\n');
        console.error('💥 [ELECTRON] Last 50 lines of chrome_debug.log:');
        console.error(lastLines);
      }
    } catch (err) {
      console.error('💥 [ELECTRON] Could not read chrome_debug.log:', err.message);
    }
    
    if (details.reason === 'crashed') {
      console.error('💥 [ELECTRON] Renderer process crashed - this is the DRAG & DROP BUG!');
    } else if (details.reason === 'oom') {
      console.error('💥 [ELECTRON] Out of memory!');
    } else if (details.reason === 'killed') {
      console.error('💥 [ELECTRON] Process was killed');
    }
  });
  
  // Monitor unresponsive renderer
  mainWindow.webContents.on('unresponsive', () => {
    console.error('⚠️ [ELECTRON] Renderer process became unresponsive!');
    console.error('⚠️ [ELECTRON] Timestamp:', new Date().toISOString());
  });
  
  mainWindow.webContents.on('responsive', () => {
    console.log('✅ [ELECTRON] Renderer process is responsive again');
  });
  
  // Log console messages from renderer
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelMap = ['VERBOSE', 'INFO', 'WARNING', 'ERROR'];
    console.log(`[RENDERER ${levelMap[level]}] ${message}`);
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
