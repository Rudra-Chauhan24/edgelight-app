const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut, session, clipboard, shell } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const { LicenseManager } = require('./license-manager');
const { AppUpdater } = require('./updater');

let mainWindow = null;
let tray = null;
let currentLightState = true;
const licenseManager = new LicenseManager();
const appUpdater = new AppUpdater();
let currentLicenseStatus = null;

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let isControlsVisible = false;

function updateTrayMenu(isOn, controlsShown = isControlsVisible) {
  currentLightState = isOn;
  isControlsVisible = controlsShown;
  if (!tray) return;

  const licStatus = currentLicenseStatus?.status;
  let licLabel = 'Trial Active';
  if (licStatus === 'approved') licLabel = '✓ Pro License: Active';
  else if (licStatus === 'rejected') licLabel = '🚫 License: Rejected';
  else if (licStatus === 'expired') licLabel = '⌛ Trial Expired';
  else if (licStatus === 'clock_tampered') licLabel = '⚠️ Tampering Detected';
  else if (currentLicenseStatus?.trialRemainingHours !== undefined) {
    const days = currentLicenseStatus.trialRemainingDays;
    const hours = currentLicenseStatus.trialRemainingHours % 24;
    licLabel = `Trial: ${days > 0 ? days + 'd ' : ''}${hours}h remaining`;
  }

  try {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Edge Light',
        enabled: false
      },
      {
        label: isOn ? 'Illumination on' : 'Illumination off',
        enabled: false
      },
      { type: 'separator' },
      {
        label: licLabel,
        enabled: false
      },
      {
        label: `Device HWID: ${licenseManager.getShortHWID()}`,
        click: () => {
          clipboard.writeText(licenseManager.getShortHWID());
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
            mainWindow.moveTop();
            mainWindow.focus();
            mainWindow.webContents.send('show-license-modal');
          }
        }
      },
      {
        label: 'Manage License…',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
            mainWindow.moveTop();
            mainWindow.focus();
            mainWindow.webContents.send('show-license-modal');
          }
        }
      },
      {
        label: 'Setup Wizard & Plans…',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
            mainWindow.moveTop();
            mainWindow.focus();
            mainWindow.webContents.send('show-setup-wizard');
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Toggle Edge Light',
        accelerator: 'Ctrl+Shift+L',
        click: () => {
          if (!licenseManager.isAuthorized()) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
              mainWindow.moveTop();
              mainWindow.focus();
              mainWindow.webContents.send('show-license-modal');
            }
            return;
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('toggle-light');
          }
        }
      },
      {
        label: controlsShown ? 'Hide Controls' : 'Show Controls',
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('toggle-controls');
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Launch at Login',
        type: 'checkbox',
        checked: getLaunchAtLogin(),
        click: (menuItem) => {
          setLaunchAtLogin(menuItem.checked);
          updateTrayMenu(currentLightState);
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'Ctrl+Shift+Q',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip(`Edge Light (${isOn ? 'On' : 'Off'}) - ${licLabel}`);
  } catch (err) {
    console.error('Tray update error:', err);
  }
}

function setLaunchAtLogin(enable) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enable,
      path: process.execPath,
      args: []
    });
  } catch (err) {
    console.error('Failed to set login item settings:', err);
  }
}

function getLaunchAtLogin() {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (err) {
    return false;
  }
}

function createTray() {
  try {
    const trayPngPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
    let trayIcon = nativeImage.createFromPath(trayPngPath);
    if (trayIcon.isEmpty()) {
      const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');
      trayIcon = nativeImage.createFromPath(icoPath);
    }
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 16, height: 16 });
    }

    tray = new Tray(trayIcon);
    updateTrayMenu(currentLightState);

    tray.on('click', () => {
      if (!licenseManager.isAuthorized()) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
          mainWindow.moveTop();
          mainWindow.focus();
          mainWindow.webContents.send('show-license-modal');
        }
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toggle-light');
      }
    });
  } catch (e) {
    console.error('Tray creation error:', e);
  }
}

let keepTopInterval = null;

function ensureTopmost(moveTop = false) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    if (moveTop) {
      mainWindow.moveTop();
    }
  }
}

function startKeepTop() {
  if (keepTopInterval) clearInterval(keepTopInterval);
  ensureTopmost(false);
  keepTopInterval = setInterval(() => {
    ensureTopmost(false);
  }, 2000);
}

function stopKeepTop() {
  if (keepTopInterval) {
    clearInterval(keepTopInterval);
    keepTopInterval = null;
  }
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  // Keep on top even over full screen windows and presentations
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Ensure window strictly stays forward (topmost) above all apps, even when another app is focused
  mainWindow.on('blur', () => {
    ensureTopmost();
  });

  // Prevent Windows from minimizing or demoting overlay when another app switches to fullscreen
  mainWindow.on('minimize', (e) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.restore();
      ensureTopmost();
    }
  });

  // Initial mouse events ignore mode (clicks pass through transparent areas)
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    startKeepTop();

    // Check for OTA updates 3.5s after launch
    setTimeout(async () => {
      try {
        const update = await appUpdater.checkForUpdates();
        if (update && update.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-available', update);
        }
      } catch (e) {}
    }, 3500);
  });

  // Handle display resolution, scaling, or monitor connect/disconnect changes
  const handleDisplayChange = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = screen.getPrimaryDisplay().bounds;
      mainWindow.setBounds(bounds);
      ensureTopmost();
    }
  };

  screen.on('display-metrics-changed', handleDisplayChange);
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);

  mainWindow.on('closed', () => {
    screen.removeListener('display-metrics-changed', handleDisplayChange);
    screen.removeListener('display-added', handleDisplayChange);
    screen.removeListener('display-removed', handleDisplayChange);
    stopKeepTop();
    mainWindow = null;
  });
}

function registerShortcuts() {
  // Global shortcut to toggle light on/off
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    if (!licenseManager.isAuthorized()) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        mainWindow.moveTop();
        mainWindow.focus();
        mainWindow.webContents.send('show-license-modal');
      }
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('toggle-light');
    }
  });

  // Global shortcut to quit cleanly
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    app.isQuitting = true;
    app.quit();
  });
}

// IPC Handlers
ipcMain.handle('get-license-info', () => {
  return licenseManager.getStatus();
});

ipcMain.handle('refresh-license-info', async () => {
  try {
    const updated = await licenseManager.refresh();
    currentLicenseStatus = updated;
    updateTrayMenu(currentLightState);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('license-status-changed', updated);
    }
    return updated;
  } catch (e) {
    return licenseManager.getStatus();
  }
});

ipcMain.handle('get-payment-config', () => {
  return licenseManager.getPaymentConfig();
});

ipcMain.handle('open-external', async (event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('upi://'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('copy-hwid', () => {
  clipboard.writeText(licenseManager.getShortHWID());
  return true;
});

// ── OTA UPDATER IPC HANDLERS ──────────────────────────────────────
ipcMain.handle('check-for-updates', async () => {
  return await appUpdater.checkForUpdates();
});

ipcMain.handle('download-update', async (event, url) => {
  return await appUpdater.downloadUpdate(url, (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', progress);
    }
  });
});

ipcMain.handle('install-update', () => {
  return appUpdater.installUpdate();
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    if (ignore) {
      win.setIgnoreMouseEvents(true, { forward: true });
    } else {
      win.setIgnoreMouseEvents(false);
      win.setAlwaysOnTop(true, 'screen-saver', 1);
      win.moveTop();
      win.focus();
    }
    // Maintain highest z-order so edge light strictly stays forward over all apps
    ensureTopmost(true);
  }
});

ipcMain.on('bring-to-front', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.moveTop();
    win.focus();
  }
});

ipcMain.on('light-state-changed', (event, isOn) => {
  currentLightState = isOn;
  if (isOn) {
    ensureTopmost(true);
  }
  updateTrayMenu(isOn, isControlsVisible);
});

ipcMain.on('controls-visibility-changed', (event, visible) => {
  isControlsVisible = visible;
  updateTrayMenu(currentLightState, visible);
});

ipcMain.on('quit-app', () => {
  app.isQuitting = true;
  app.quit();
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const isFS = mainWindow.isFullScreen();
    mainWindow.setFullScreen(!isFS);
    return !isFS;
  }
  return false;
});

ipcMain.handle('is-fullscreen', () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false;
});

ipcMain.handle('get-launch-at-login', () => {
  return getLaunchAtLogin();
});

ipcMain.handle('set-launch-at-login', (event, enable) => {
  setLaunchAtLogin(enable);
  updateTrayMenu(currentLightState);
  return getLaunchAtLogin();
});

// ── Windows CapabilityAccessManager Real-Time Webcam Monitor ─────────
let webcamMonitorInterval = null;
let lastWebcamInUse = false;
let isCheckingWebcam = false;

function checkWebcamUsage() {
  if (process.platform !== 'win32' || isCheckingWebcam) return;
  isCheckingWebcam = true;

  execFile('reg.exe', [
    'query',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam',
    '/s'
  ], { windowsHide: true }, (err, stdout) => {
    isCheckingWebcam = false;
    if (err || !stdout) return;

    const sections = stdout.split(/(?=HKEY_CURRENT_USER)/i);
    let inUse = false;
    const activeApps = [];

    for (const section of sections) {
      const lines = section.trim().split(/\r?\n/);
      if (!lines.length) continue;
      const header = lines[0].trim();
      const lowerHeader = header.toLowerCase();

      // Exclude Edge Light itself and Electron dev environment
      if (
        lowerHeader.includes('edge light') ||
        lowerHeader.includes('edgelight') ||
        lowerHeader.includes('electron.exe')
      ) {
        continue;
      }

      let startVal = null;
      let stopVal = null;

      for (const line of lines) {
        const matchStart = line.match(/LastUsedTimeStart\s+REG_QWORD\s+(0x[0-9a-fA-F]+|\d+)/i);
        if (matchStart) startVal = matchStart[1];
        const matchStop = line.match(/LastUsedTimeStop\s+REG_QWORD\s+(0x[0-9a-fA-F]+|\d+)/i);
        if (matchStop) stopVal = matchStop[1];
      }

      if (startVal !== null) {
        try {
          const start = BigInt(startVal);
          const stop = stopVal !== null ? BigInt(stopVal) : 0n;
          // When an application or website accesses the camera,
          // Windows sets LastUsedTimeStop to 0x0 or start > stop
          if (stop === 0n || start > stop) {
            inUse = true;
            const appName = header.split('\\').pop() || header;
            activeApps.push(appName);
          }
        } catch (e) {}
      }
    }

    if (inUse !== lastWebcamInUse) {
      lastWebcamInUse = inUse;
      if (inUse) {
        ensureTopmost(true);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('webcam-access-changed', inUse, activeApps);
      }
    }
  });
}

function startWebcamMonitoring() {
  if (webcamMonitorInterval) clearInterval(webcamMonitorInterval);
  checkWebcamUsage();
  webcamMonitorInterval = setInterval(checkWebcamUsage, 800);
}

function stopWebcamMonitoring() {
  if (webcamMonitorInterval) {
    clearInterval(webcamMonitorInterval);
    webcamMonitorInterval = null;
  }
}

app.whenReady().then(async () => {
  // Ensure Edge Light NEVER locks or interrupts hardware camera streams from WhatsApp, Zoom, etc.
  // Camera usage detection is handled 100% passively via Windows Registry CapabilityAccessManager.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'camera' || permission === 'video') {
      return callback(false);
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return false;
  });

  if (session.defaultSession.setDevicePermissionHandler) {
    session.defaultSession.setDevicePermissionHandler(() => false);
  }

  // Initialize licensing and hardware check
  currentLicenseStatus = await licenseManager.initialize();
  licenseManager.startPeriodicSync((updatedStatus) => {
    currentLicenseStatus = updatedStatus;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('license-status-changed', updatedStatus);
    }
    updateTrayMenu(currentLightState);
  });

  createWindow();
  createTray();
  registerShortcuts();
  startWebcamMonitoring();
  setLaunchAtLogin(true);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  licenseManager.stop();
  stopKeepTop();
  stopWebcamMonitoring();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
