const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut, session, clipboard, shell, powerMonitor } = require('electron');
const { execFile, fork } = require('child_process');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { LicenseManager } = require('./license-manager');
const { AppUpdater } = require('./updater');

// Optimize Chromium hardware acceleration and prevent background stutter
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// Ensure consistent persistent userData across portable and installed executions
try {
  const currentAppPath = app.getPath('userData');
  const isTempPath = /\\temp\\|\\tmp\\/i.test(currentAppPath);
  if (isTempPath && process.env.APPDATA) {
    const persistentUserData = path.join(process.env.APPDATA, 'EdgeLight');
    app.setPath('userData', persistentUserData);
  }
} catch (_) {}

// ── LOCAL LICENSING BACKEND SERVICE INTEGRATION ────────────────────
let localBackendProcess = null;

function ensureLocalBackendService() {
  const backendServerPath = path.resolve(__dirname, '..', 'backend', 'server.js');
  if (!fs.existsSync(backendServerPath)) return;

  const req = http.get('http://127.0.0.1:4000/api/health', { timeout: 1000 }, (res) => {
    res.resume();
  });

  req.on('error', () => {
    try {
      const backendDir = path.resolve(__dirname, '..', 'backend');
      localBackendProcess = fork(backendServerPath, [], {
        cwd: backendDir,
        env: { ...process.env, PORT: '4000', ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'ignore'
      });
      localBackendProcess.unref();
      console.log('[Backend] Local licensing backend service spawned on port 4000.');
    } catch (err) {
      console.warn('[Backend] Could not spawn local backend service:', err.message);
    }
  });

  req.on('timeout', () => {
    req.destroy();
  });
}

function stopLocalBackendService() {
  if (localBackendProcess) {
    try {
      localBackendProcess.kill();
    } catch (_) {}
    localBackendProcess = null;
  }
}

// ── INTERNET CONNECTIVITY MONITOR ─────────────────────────────────
let isOnline = true;
let lastOnlineTime = Date.now();
let connectivityCheckInterval = null;
let isCheckingConnectivity = false;

function checkConnectivity() {
  if (isCheckingConnectivity) return;
  isCheckingConnectivity = true;
  const finishCheck = () => { isCheckingConnectivity = false; };

  const req = https.get('https://firestore.googleapis.com', { timeout: 4000 }, (res) => {
    finishCheck();
    const wasOffline = !isOnline;
    isOnline = true;
    lastOnlineTime = Date.now();
    // Record online timestamp in encrypted license vault
    try { licenseManager.recordOnline(); } catch (e) {}
    if (wasOffline && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connectivity-changed', true);
      // Trigger immediate license re-check on reconnect
      licenseManager.refresh().then(status => {
        currentLicenseStatus = status;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('license-status-changed', status);
        }
        updateTrayMenu(currentLightState);
      }).catch(() => {});
    }
    res.resume();
  });
  req.on('error', () => {
    finishCheck();
    const wasOnline = isOnline;
    isOnline = false;
    if (wasOnline && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connectivity-changed', false);
    }
    // If offline for >= 48h, send warning; >= 72h, lock
    const offlineDuration = Date.now() - lastOnlineTime;
    const offlineHours = offlineDuration / 3600000;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('offline-duration-update', offlineHours);
    }
  });
  req.on('timeout', () => {
    finishCheck();
    req.destroy();
  });
  req.end();
}

function startConnectivityMonitor() {
  if (connectivityCheckInterval) clearInterval(connectivityCheckInterval);
  checkConnectivity();
  connectivityCheckInterval = setInterval(checkConnectivity, 30000); // Check every 30s
}

function stopConnectivityMonitor() {
  if (connectivityCheckInterval) {
    clearInterval(connectivityCheckInterval);
    connectivityCheckInterval = null;
  }
}

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
  else if (currentLicenseStatus?.trialExpiresAt || currentLicenseStatus?.trialRemainingHours !== undefined) {
    const expiresAt = currentLicenseStatus?.trialExpiresAt || (Date.now() + (currentLicenseStatus?.trialRemainingHours || 72) * 3600000);
    const remMs = Math.max(0, expiresAt - Date.now());
    const days = Math.floor(remMs / 86400000);
    const hours = Math.floor((remMs % 86400000) / 3600000);
    const mins = Math.floor((remMs % 3600000) / 60000);
    if (remMs <= 0) {
      licLabel = '⌛ Trial Expired';
    } else if (days > 0) {
      licLabel = `Trial: ${days}d ${hours}h remaining`;
    } else if (hours > 0) {
      licLabel = `Trial: ${hours}h ${mins}m remaining`;
    } else {
      licLabel = `Trial: ${mins}m remaining`;
    }
  }

  try {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Edge Light v${app.getVersion()}`,
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
      {
        label: 'Check for Updates…',
        click: async () => {
          try {
            const update = await appUpdater.checkForUpdates();
            if (update && update.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('update-available', { ...update, isManualCheck: true });
            } else if (mainWindow && !mainWindow.isDestroyed()) {
              const cur = update?.currentVersion || app.getVersion();
              mainWindow.webContents.send('show-status', `✓ Edge Light is up to date (v${cur})`);
            }
          } catch (err) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('show-status', 'Update check failed: ' + err.message);
            }
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
    tray.setToolTip(`Edge Light v${app.getVersion()} (${isOn ? 'On' : 'Off'}) - ${licLabel}`);
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
let isPaymentSessionActive = false;

function ensureTopmost(moveTop = false) {
  if (isPaymentSessionActive) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isAlwaysOnTop()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    }
    if (moveTop) {
      mainWindow.moveTop();
    }
  }
}

function startKeepTop() {
  if (keepTopInterval) clearInterval(keepTopInterval);
  if (isPaymentSessionActive) return;
  ensureTopmost(false);
  keepTopInterval = setInterval(() => {
    if (!isPaymentSessionActive && mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isAlwaysOnTop()) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      }
    }
  }, 5000);
}

function stopKeepTop() {
  if (keepTopInterval) {
    clearInterval(keepTopInterval);
    keepTopInterval = null;
  }
}

// OS-level cursor tracking loop for rock-solid cursor hole cutout (even when window is unfocused/startup)
let lastCursorX = -9999;
let lastCursorY = -9999;
let cursorTrackerInterval = null;

function startCursorTracker() {
  if (cursorTrackerInterval) return;
  cursorTrackerInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    if (!currentLightState) return;
    try {
      const pt = screen.getCursorScreenPoint();
      if (Math.abs(pt.x - lastCursorX) >= 2 || Math.abs(pt.y - lastCursorY) >= 2) {
        lastCursorX = pt.x;
        lastCursorY = pt.y;
        const bounds = mainWindow.getBounds();
        const relX = pt.x - bounds.x;
        const relY = pt.y - bounds.y;
        mainWindow.webContents.send('cursor-position', { x: relX, y: relY });
      }
    } catch (e) {}
  }, 25);
}

function stopCursorTracker() {
  if (cursorTrackerInterval) {
    clearInterval(cursorTrackerInterval);
    cursorTrackerInterval = null;
  }
}

let otaInterval = null;
let otaStartupTimeout = null;

function stopOtaInterval() {
  if (otaInterval) {
    clearInterval(otaInterval);
    otaInterval = null;
  }
  if (otaStartupTimeout) {
    clearTimeout(otaStartupTimeout);
    otaStartupTimeout = null;
  }
}

// Helper to resolve active display for current window or cursor
function getActiveDisplay() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const curBounds = mainWindow.getBounds();
      const display = screen.getDisplayMatching(curBounds);
      if (display) return display;
    }
  } catch (_) {}
  return screen.getPrimaryDisplay();
}

// Handle display resolution, scaling, or monitor connect/disconnect changes
function handleDisplayChange() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const display = getActiveDisplay();
    const bounds = display.bounds;
    mainWindow.setBounds(bounds);
    ensureTopmost();
    try {
      mainWindow.webContents.send('display-configuration-changed', {
        bounds: display.bounds,
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        displayId: display.id
      });
    } catch (_) {}
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

  // When another app is focused, preserve always-on-top without re-stacking DWM
  mainWindow.on('blur', () => {
    // Window already has screen-saver level always-on-top; do not churn DWM on blur
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

  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed() && lastWebcamInUse) {
      mainWindow.webContents.send('webcam-access-changed', lastWebcamInUse, lastActiveApps);
    }
  });

  mainWindow.once('ready-to-show', () => {
    // Show overlay window without stealing keyboard focus from active apps
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
    }
    startKeepTop();
    startCursorTracker();

    // Broadcast immediate cursor position on launch
    try {
      const pt = screen.getCursorScreenPoint();
      const bounds = mainWindow.getBounds();
      mainWindow.webContents.send('cursor-position', { x: pt.x - bounds.x, y: pt.y - bounds.y });
    } catch (e) {}

    // Check for OTA updates 3.5s after launch
    stopOtaInterval();
    otaStartupTimeout = setTimeout(async () => {
      try {
        const update = await appUpdater.checkForUpdates();
        if (update && update.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-available', update);
        }
      } catch (e) {}
    }, 3500);

    // Periodic OTA update check every 15 minutes while running
    otaInterval = setInterval(async () => {
      try {
        const update = await appUpdater.checkForUpdates();
        if (update && update.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-available', update);
        }
      } catch (e) {}
    }, 15 * 60 * 1000);
  });

  screen.on('display-metrics-changed', handleDisplayChange);
  screen.on('display-added', handleDisplayChange);
  screen.on('display-removed', handleDisplayChange);

  mainWindow.on('closed', () => {
    screen.removeListener('display-metrics-changed', handleDisplayChange);
    screen.removeListener('display-added', handleDisplayChange);
    screen.removeListener('display-removed', handleDisplayChange);
    stopKeepTop();
    stopCursorTracker();
    stopOtaInterval();
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

ipcMain.handle('verify-hardware-id', async (event, inputHwid) => {
  try {
    return await licenseManager.verifyHardwareId(inputHwid);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-display-info', () => {
  try {
    const primary = screen.getPrimaryDisplay();
    let active = primary;
    if (mainWindow && !mainWindow.isDestroyed()) {
      active = screen.getDisplayMatching(mainWindow.getBounds()) || primary;
    }
    const all = screen.getAllDisplays().map(d => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      isPrimary: d.id === primary.id
    }));
    return {
      activeDisplay: {
        id: active.id,
        bounds: active.bounds,
        workArea: active.workArea,
        scaleFactor: active.scaleFactor
      },
      displays: all
    };
  } catch (e) {
    const primary = screen.getPrimaryDisplay();
    return {
      activeDisplay: {
        id: primary.id,
        bounds: primary.bounds,
        workArea: primary.workArea,
        scaleFactor: primary.scaleFactor
      },
      displays: []
    };
  }
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

ipcMain.handle('reset-trial', async () => {
  const updated = await licenseManager.resetTrial();
  currentLicenseStatus = updated;
  updateTrayMenu(currentLightState);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('license-status-changed', updated);
  }
  return updated;
});

ipcMain.handle('open-external', async (event, url) => {
  if (typeof url === 'string') {
    try {
      if (url.startsWith('upi://')) {
        await shell.openExternal(url);
        return true;
      }
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        await shell.openExternal(url);
        return true;
      }
    } catch (_) {}
  }
  return false;
});

// ── IN-APP PAYMENT WINDOW & BROWSER CHECKOUT ──────────────────────
// Completely isolates payment checkout so mainWindow never obscures
// or blocks clicks from the Razorpay popup or user's browser.
let paymentWindow = null;

ipcMain.handle('start-payment-session', () => {
  isPaymentSessionActive = true;
  stopKeepTop();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.webContents.send('payment-session-started');
  }
  return true;
});

ipcMain.handle('end-payment-session', () => {
  isPaymentSessionActive = false;
  if (paymentWindow && !paymentWindow.isDestroyed()) {
    try { paymentWindow.close(); } catch (e) {}
    paymentWindow = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    startKeepTop();
    mainWindow.webContents.send('payment-session-ended');
  }
  return true;
});

// ── SECURE PAYMENT DOMAIN & URL VALIDATOR ──────────────────────────
function isTrustedPaymentUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    const isRazorpay = hostname === 'rzp.io' ||
                       hostname.endsWith('.rzp.io') ||
                       hostname === 'razorpay.com' ||
                       hostname.endsWith('.razorpay.com');
    const isBackend = hostname === 'edgelight-backend.vercel.app' ||
                      hostname === 'edge-light-24.web.app' ||
                      hostname === 'edge-light-24.firebaseapp.com' ||
                      hostname === 'localhost' ||
                      hostname === '127.0.0.1';
    return isRazorpay || isBackend;
  } catch (_) {
    return false;
  }
}

ipcMain.handle('open-payment-window', async (event, params) => {
  const { url, planId, hwid } = params || {};
  if (!isTrustedPaymentUrl(url)) {
    return { success: false, error: 'Payment URL rejected: only verified HTTPS checkout domains are permitted.' };
  }

  // Close any existing payment window
  if (paymentWindow && !paymentWindow.isDestroyed()) {
    try { paymentWindow.close(); } catch (e) {}
    paymentWindow = null;
  }

  isPaymentSessionActive = true;
  stopKeepTop();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  return new Promise((resolve) => {
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const winW = Math.min(620, sw - 40);
    const winH = Math.min(800, sh - 40);

    paymentWindow = new BrowserWindow({
      width: winW,
      height: winH,
      x: Math.round((sw - winW) / 2),
      y: Math.round((sh - winH) / 2),
      title: 'Edge Light — Secure Razorpay Checkout',
      parent: (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : undefined,
      modal: false,
      frame: true,
      transparent: false,
      alwaysOnTop: true,
      resizable: true,
      minimizable: true,
      maximizable: true,
      show: true,
      skipTaskbar: false,
      backgroundColor: '#111827',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    paymentWindow.setMenuBarVisibility(false);
    paymentWindow.setAlwaysOnTop(true, 'screen-saver', 99999);
    paymentWindow.moveTop();
    paymentWindow.focus();

    // Security: Restrict navigation to HTTPS and prevent arbitrary window spawning
    paymentWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (isTrustedPaymentUrl(targetUrl) || targetUrl.startsWith('https://')) {
        return { action: 'allow' };
      }
      return { action: 'deny' };
    });

    paymentWindow.webContents.on('will-navigate', (e, navUrl) => {
      if (!navUrl.startsWith('https://')) {
        e.preventDefault();
      }
    });

    // Ensure paymentWindow stays above all else when focused
    paymentWindow.on('focus', () => {
      if (paymentWindow && !paymentWindow.isDestroyed()) {
        paymentWindow.setAlwaysOnTop(true, 'screen-saver', 9999);
        paymentWindow.moveTop();
      }
    });

    const restoreMainWindow = () => {
      isPaymentSessionActive = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        mainWindow.moveTop();
        startKeepTop();
        mainWindow.webContents.send('payment-session-ended');
      }
    };

    let resolved = false;

    function safeResolve(result) {
      if (!resolved) {
        resolved = true;
        restoreMainWindow();
        resolve(result);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('payment-window-closed', result);
        }
      }
    }

    function extractPaymentId(navUrl) {
      if (!navUrl) return null;
      try {
        const u = new URL(navUrl);
        return u.searchParams.get('payment_id') ||
               u.searchParams.get('razorpay_payment_id') ||
               u.searchParams.get('pay_id') ||
               null;
      } catch (err) {
        const m = String(navUrl).match(/(?:payment_id|razorpay_payment_id)=([a-zA-Z0-9_-]+)/i);
        return m ? m[1] : null;
      }
    }

    async function handlePaymentNav(navUrl) {
      if (!navUrl) return;
      const detectedPaymentId = extractPaymentId(navUrl);

      // Require real cryptographic/backend verification rather than unverified substring matching
      if (detectedPaymentId) {
        try {
          const actResult = await licenseManager.activateWithPaymentRef(detectedPaymentId, planId);
          if (actResult && actResult.success) {
            safeResolve({
              success: true,
              verified: true,
              paymentId: detectedPaymentId,
              planId,
              licenseInfo: actResult.licenseInfo
            });
            setTimeout(() => {
              if (paymentWindow && !paymentWindow.isDestroyed()) paymentWindow.close();
            }, 1200);
          }
        } catch (e) {
          console.error('[PaymentWindow] Verification error:', e);
        }
      }
    }

    // Check for verified payment ID after navigation
    paymentWindow.webContents.on('did-navigate', (e, navUrl) => {
      handlePaymentNav(navUrl);
    });

    // Also watch for URL changes in-frame (SPA Razorpay checkout)
    paymentWindow.webContents.on('did-navigate-in-page', (e, navUrl) => {
      handlePaymentNav(navUrl);
    });

    paymentWindow.on('closed', () => {
      paymentWindow = null;
      restoreMainWindow();
      safeResolve({ success: false, closed: true });
    });

    // Notify renderer that payment window is open so it can show active state
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('payment-window-opened', { planId, url });
    }

    paymentWindow.loadURL(url);
  });
});

ipcMain.handle('focus-payment-window', () => {
  if (paymentWindow && !paymentWindow.isDestroyed()) {
    paymentWindow.show();
    paymentWindow.setAlwaysOnTop(true, 'screen-saver', 9999);
    paymentWindow.moveTop();
    paymentWindow.focus();
    return true;
  }
  return false;
});

ipcMain.handle('close-payment-window', () => {
  if (paymentWindow && !paymentWindow.isDestroyed()) {
    try { paymentWindow.close(); } catch (e) {}
    paymentWindow = null;
    return true;
  }
  return false;
});

ipcMain.handle('open-payment-in-browser', async (event, url) => {
  if (paymentWindow && !paymentWindow.isDestroyed()) {
    try { paymentWindow.close(); } catch (e) {}
    paymentWindow = null;
  }
  isPaymentSessionActive = true;
  stopKeepTop();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.webContents.send('payment-session-started', { url, mode: 'browser' });
  }
  if (isTrustedPaymentUrl(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('activate-payment-ref', async (event, params) => {
  try {
    const { paymentRef, planId } = params || {};
    const res = await licenseManager.activateWithPaymentRef(paymentRef, planId);
    if (res && res.success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('license-status-changed', res.licenseInfo);
    }
    return res;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('activate-admin-lifetime', async (event, params) => {
  try {
    const token = typeof params === 'string' ? params : params?.adminToken;
    const identity = typeof params === 'object' ? params?.adminIdentity : null;
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'Admin authorization token is required.' };
    }
    let res = await licenseManager.activateAdminLifetime(token, identity);
    if (!res.success && res.error && res.error.includes('Connection failed') && (!process.env.BACKEND_URL || process.env.BACKEND_URL.includes('localhost') || process.env.BACKEND_URL.includes('127.0.0.1'))) {
      ensureLocalBackendService();
      await new Promise(r => setTimeout(r, 1200));
      res = await licenseManager.activateAdminLifetime(token, identity);
    }
    if (res && res.success && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('license-status-changed', res.licenseInfo);
    }
    return res;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-connectivity-status', () => {
  return {
    isOnline,
    lastOnlineTime,
    offlineHours: isOnline ? 0 : (Date.now() - lastOnlineTime) / 3600000
  };
});

ipcMain.handle('force-connectivity-check', async () => {
  checkConnectivity();
  return { isOnline, lastOnlineTime };
});

ipcMain.handle('create-razorpay-link', async (event, params) => {
  try {
    const planId = params?.planId || 'quarterly';
    const hwid = params?.hwid || licenseManager.getShortHWID();
    const plans = {
      monthly: { amount: 2900, name: 'Monthly Pass', fallback: 'https://rzp.io/rzp/WY3lkA6' },
      quarterly: { amount: 4900, name: '3-Month Pass', fallback: 'https://rzp.io/rzp/01mOm4K' },
      lifetime: { amount: 9900, name: 'Lifetime Pro', fallback: 'https://rzp.io/rzp/K30Pa9v' }
    };
    const target = plans[planId] || plans.quarterly;
    const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_live_TbF2T3PxIu4EAn';
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return { success: true, url: target.fallback, source: 'fallback' };
    }
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    const postData = JSON.stringify({
      amount: target.amount,
      currency: 'INR',
      accept_partial: false,
      description: `Edge Light ${target.name} License`,
      notes: {
        hwid: String(hwid).trim(),
        plan: planId
      }
    });

    return await new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.razorpay.com',
        path: '/v1/payment_links',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 2000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed && parsed.short_url) {
              resolve(parsed.short_url);
            } else {
              resolve(target.fallback);
            }
          } catch (e) {
            resolve(target.fallback);
          }
        });
      });
      req.on('error', () => resolve(target.fallback));
      req.on('timeout', () => { req.destroy(); resolve(target.fallback); });
      req.write(postData);
      req.end();
    });
  } catch (err) {
    return 'https://rzp.io/rzp/01mOm4K';
  }
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
    }
  }
});

ipcMain.on('bring-to-front', (event, shouldFocus = false) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    if (!win.isAlwaysOnTop()) {
      win.setAlwaysOnTop(true, 'screen-saver', 1);
    }
    win.moveTop();
    if (shouldFocus) {
      win.focus();
    }
  }
});

ipcMain.on('light-state-changed', (event, isOn) => {
  currentLightState = isOn;
  if (isOn) {
    ensureTopmost(false);
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

ipcMain.handle('get-cursor-position', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { x: -9999, y: -9999 };
  try {
    const pt = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    return { x: pt.x - bounds.x, y: pt.y - bounds.y };
  } catch (e) {
    return { x: -9999, y: -9999 };
  }
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
let lastActiveApps = [];
let isCheckingWebcam = false;

function checkWebcamUsage() {
  if (process.platform !== 'win32' || isCheckingWebcam) return;
  isCheckingWebcam = true;

  const queries = [
    ['query', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam', '/s'],
    ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam', '/s']
  ];

  let pending = queries.length;
  let combinedStdout = '';

  queries.forEach(args => {
    execFile('reg.exe', args, { windowsHide: true, timeout: 3500 }, (err, stdout) => {
      if (!err && stdout) combinedStdout += '\n' + stdout;
      pending--;
      if (pending === 0) {
        isCheckingWebcam = false;
        processWebcamRegistry(combinedStdout);
      }
    });
  });
}

function processWebcamRegistry(stdout) {
  if (!stdout) return;

  const sections = stdout.split(/(?=HKEY_)/i);
  let inUse = false;
  const activeApps = [];

  const filetimeNow = (BigInt(Date.now()) + 11644473600000n) * 10000n;
  const maxAge = BigInt(Math.max(3600, Math.floor(os.uptime() + 60))) * 10000000n;

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

        // Verify entry is not stale from a previous boot session
        const isStale = (filetimeNow > start) && ((filetimeNow - start) > maxAge);
        if (isStale) continue;

        // When an application or website accesses the camera,
        // Windows sets LastUsedTimeStop to 0x0 or start > stop
        if (stop === 0n || start > stop) {
          inUse = true;
          const appName = header.split('\\').pop() || header;
          if (!activeApps.includes(appName)) {
            activeApps.push(appName);
          }
        }
      } catch (e) {}
    }
  }

  const stateChanged = (inUse !== lastWebcamInUse);
  lastWebcamInUse = inUse;
  lastActiveApps = activeApps;

  if (stateChanged) {
    if (inUse) {
      ensureTopmost(true);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('webcam-access-changed', inUse, activeApps);
    }
  }
}

function startWebcamMonitoring() {
  if (webcamMonitorInterval) clearInterval(webcamMonitorInterval);
  checkWebcamUsage();
  webcamMonitorInterval = setInterval(checkWebcamUsage, 1000);
}

function stopWebcamMonitoring() {
  if (webcamMonitorInterval) {
    clearInterval(webcamMonitorInterval);
    webcamMonitorInterval = null;
  }
}

ipcMain.handle('get-webcam-status', () => {
  return {
    inUse: lastWebcamInUse,
    activeApps: lastActiveApps
  };
});

app.whenReady().then(async () => {
  // Allow internal media access for ambient metering while protecting external requests
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'camera' || permission === 'video') {
      return callback(true);
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'camera' || permission === 'video') {
      return true;
    }
    return false;
  });

  if (session.defaultSession.setDevicePermissionHandler) {
    session.defaultSession.setDevicePermissionHandler(() => true);
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
  startConnectivityMonitor();
  ensureLocalBackendService();

  // Handle Windows Sleep / Suspend / Resume gracefully
  if (powerMonitor) {
    powerMonitor.on('suspend', () => {
      stopWebcamMonitoring();
      stopCursorTracker();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('system-suspend');
      }
    });

    powerMonitor.on('resume', () => {
      setTimeout(() => {
        handleDisplayChange();
        startWebcamMonitoring();
        startCursorTracker();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('system-resume');
        }
      }, 1500);
    });
  }

  // Preserve user Windows startup setting without forcing changes silently
  const currentStartupSetting = getLaunchAtLogin();
  if (currentStartupSetting) {
    setLaunchAtLogin(true);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  stopLocalBackendService();
  licenseManager.stop();
  stopKeepTop();
  stopCursorTracker();
  stopOtaInterval();
  stopWebcamMonitoring();
  stopConnectivityMonitor();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
