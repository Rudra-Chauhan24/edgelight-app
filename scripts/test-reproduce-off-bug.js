const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

ipcMain.handle('get-app-version', () => '1.0.3');
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('is-fullscreen', () => false);
ipcMain.on('set-ignore-mouse-events', () => {});
ipcMain.on('light-state-changed', () => {});
ipcMain.on('controls-visibility-changed', () => {});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const errors = [];
  win.webContents.on('console-message', (event, level, message) => {
    console.log('[BROWSER CONSOLE]:', message);
  });

  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  await wait(500);

  // Simulate mouse hovering at bottom edge near power button
  const res = await win.webContents.executeJavaScript(`(async () => {
    const power = document.getElementById('power');
    const bar = document.getElementById('bar');
    
    // Position mouse near edge so currentProximity > 0
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 640, clientY: 770 }));
    await new Promise(r => setTimeout(r, 200));

    let caughtError = null;
    window.onerror = (msg, url, line, col, error) => {
      caughtError = { msg, line, error: error ? error.stack : null };
    };

    // Click power button to turn OFF
    power.click();

    // Wait during animation
    await new Promise(r => setTimeout(r, 600));

    return {
      caughtError,
      thickScale: window.__renderState.thickScale,
      on: window.__state.on
    };
  })()`);

  console.log('REPRODUCTION RESULT:', res);
  app.quit();
});
