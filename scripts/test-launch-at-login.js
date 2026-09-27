const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mockLoginState = false;
ipcMain.handle('get-app-version', () => '1.0.3');
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('is-fullscreen', () => false);
ipcMain.handle('get-launch-at-login', () => {
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('set-launch-at-login', (event, enable) => {
  app.setLoginItemSettings({
    openAtLogin: !!enable,
    path: process.execPath
  });
  return app.getLoginItemSettings().openAtLogin;
});
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
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const results = await win.webContents.executeJavaScript(`(async () => {
    const report = [];
    const assert = (name, cond, details) => {
      report.push({ name, passed: !!cond, details: details || '' });
    };

    assert('edgeLightAPI exposes getLaunchAtLogin', typeof window.edgeLightAPI.getLaunchAtLogin === 'function');
    assert('edgeLightAPI exposes setLaunchAtLogin', typeof window.edgeLightAPI.setLaunchAtLogin === 'function');

    // 1. Enable launch at login
    const s1 = await window.edgeLightAPI.setLaunchAtLogin(true);
    const read1 = await window.edgeLightAPI.getLaunchAtLogin();
    assert('setLaunchAtLogin(true) enables openAtLogin', read1 === true, 'read1: ' + read1);

    // 2. Disable launch at login
    const s2 = await window.edgeLightAPI.setLaunchAtLogin(false);
    const read2 = await window.edgeLightAPI.getLaunchAtLogin();
    assert('setLaunchAtLogin(false) disables openAtLogin', read2 === false, 'read2: ' + read2);

    // 3. Re-enable launch at login as requested by user
    const s3 = await window.edgeLightAPI.setLaunchAtLogin(true);
    const read3 = await window.edgeLightAPI.getLaunchAtLogin();
    assert('Re-enabled launch at login by default', read3 === true, 'read3: ' + read3);

    return report;
  })()`);

  console.log('\\n================ LAUNCH AT LOGIN TEST ================');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] ${r.name} ${r.details ? '(' + r.details + ')' : ''}`);
    if (!r.passed) allPassed = false;
  }
  console.log('======================================================\\n');

  win.destroy();
  app.quit();
  process.exit(allPassed ? 0 : 1);
});
