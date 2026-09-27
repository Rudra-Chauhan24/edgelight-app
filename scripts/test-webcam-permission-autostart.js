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
    show: true,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(800);

  const results = await win.webContents.executeJavaScript(`(async () => {
    const report = [];
    const assert = (name, cond, details) => {
      report.push({ name, passed: !!cond, details: details || '' });
    };

    const power = document.getElementById('power');
    const autoSwitch = document.getElementById('autoSwitch');
    const status = document.getElementById('status');

    // 0. Ensure Auto switch is active by default
    assert('Auto switch is checked active by default', autoSwitch.getAttribute('aria-checked') === 'true');

    // Turn light OFF manually to test cold camera autostart
    power.click();
    await new Promise(r => setTimeout(r, 200));
    assert('Precondition: Light turned OFF', !power.classList.contains('active') && window.__state.on === false);

    // 1. Simulate website accessing webcam in Google Chrome
    window.__handleWebcamAccessChange(true, ['C:#Program Files#Google#Chrome#Application#chrome.exe']);
    await new Promise(r => setTimeout(r, 300));

    assert('Edge Light automatically starts when website accesses webcam in Chrome',
      power.classList.contains('active') && window.__state.on === true);
    assert('Status notification shows Chrome camera active',
      status.textContent.includes('Chrome') && status.textContent.includes('Camera active'),
      status.textContent);

    // 2. Simulate website/app releasing webcam
    window.__handleWebcamAccessChange(false, []);
    await new Promise(r => setTimeout(r, 300));

    assert('Edge Light automatically turns off when camera is released',
      !power.classList.contains('active') && window.__state.on === false);
    assert('Status notification shows camera released',
      status.textContent.includes('Camera released') && status.textContent.includes('off'),
      status.textContent);

    // 3. Test with Zoom application
    window.__handleWebcamAccessChange(true, ['C:#Users#test#AppData#Roaming#Zoom#bin#Zoom.exe']);
    await new Promise(r => setTimeout(r, 300));

    assert('Edge Light automatically starts when Zoom accesses webcam',
      power.classList.contains('active') && window.__state.on === true);
    assert('Status notification shows Zoom camera active',
      status.textContent.includes('Zoom'),
      status.textContent);

    // 4. Test manual override: User manually turns light OFF while camera still in use
    power.click();
    await new Promise(r => setTimeout(r, 200));
    assert('User manually clicked OFF during video call', !power.classList.contains('active') && window.__state.on === false);

    // Re-firing same camera active event should NOT override user's manual OFF
    window.__handleWebcamAccessChange(true, ['Zoom.exe']);
    await new Promise(r => setTimeout(r, 200));
    assert('Manual override respected (does not force back on during same session)',
      !power.classList.contains('active') && window.__state.on === false);

    // When camera releases, reset session
    window.__handleWebcamAccessChange(false, []);
    await new Promise(r => setTimeout(r, 200));

    // Next time camera starts (e.g. Teams call), Edge Light autostarts again
    window.__handleWebcamAccessChange(true, ['Teams.exe']);
    await new Promise(r => setTimeout(r, 300));
    assert('Next new camera session autostarts Edge Light again',
      power.classList.contains('active') && window.__state.on === true);

    // Clean up
    window.__handleWebcamAccessChange(false, []);
    await new Promise(r => setTimeout(r, 300));

    return report;
  })()`);

  console.log('\\n================ WEBCAM PERMISSION AUTOSTART TEST ================');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] ${r.name} ${r.details ? '(' + r.details + ')' : ''}`);
    if (!r.passed) allPassed = false;
  }
  console.log('===================================================================\\n');

  win.destroy();
  app.quit();
  process.exit(allPassed ? 0 : 1);
});
