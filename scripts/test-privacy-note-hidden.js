const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  ipcMain.handle('get-app-version', () => '1.0.3');
  ipcMain.handle('toggle-fullscreen', () => false);
  ipcMain.handle('is-fullscreen', () => false);
  ipcMain.on('set-ignore-mouse-events', () => {});
  ipcMain.on('light-state-changed', () => {});
  ipcMain.on('controls-visibility-changed', () => {});

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
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(800);

  const results = await win.webContents.executeJavaScript(`(async () => {
    const report = [];
    const assert = (name, cond, details) => {
      report.push({ name, passed: !!cond, details: details || '' });
    };

    const power = document.getElementById('power');
    const bar = document.getElementById('bar');
    const dismissBtn = document.getElementById('dismissBtn');
    const privacyNote = document.getElementById('privacy-note');
    const autoSwitch = document.getElementById('autoSwitch');

    const isVisuallyDisplayed = (el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
    };

    // Initial state: dock is shown initially on startup
    assert('Precondition: privacyNote exists', !!privacyNote);
    assert('Initial state: privacyNote NOT displayed on startup when auto is off', !isVisuallyDisplayed(privacyNote));

    // Mock active camera
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#222222';
    ctx.fillRect(0, 0, 64, 48);
    const mockStream = canvas.captureStream(20);
    navigator.mediaDevices.getUserMedia = async () => mockStream;
    HTMLMediaElement.prototype.play = async function() {};

    // ── SCENARIO 1: Turn Auto ON while dock is visible
    bar.classList.add('visible');
    autoSwitch.click();
    await new Promise(r => setTimeout(r, 600));

    assert('Auto ON & Bar visible: privacyNote is visible', isVisuallyDisplayed(privacyNote),
      'aria-checked: ' + autoSwitch.getAttribute('aria-checked') +
      ', privacyNote class: ' + privacyNote.className +
      ', display: ' + window.getComputedStyle(privacyNote).display +
      ', opacity: ' + window.getComputedStyle(privacyNote).opacity);

    // ── SCENARIO 2: Hide dock (Dismiss button or mouse leave)
    dismissBtn.click();
    await new Promise(r => setTimeout(r, 200));

    assert('Bar hidden: privacyNote is NOT displayed', !isVisuallyDisplayed(privacyNote),
      'computed display: ' + window.getComputedStyle(privacyNote).display + ', opacity: ' + window.getComputedStyle(privacyNote).opacity);

    // ── SCENARIO 3: Resummon dock while Auto is active
    bar.classList.add('visible');
    // Trigger showDock via hover
    const hoverZone = document.getElementById('hover-zone');
    hoverZone.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 200));

    assert('Dock resummoned: privacyNote is visible again', isVisuallyDisplayed(privacyNote));

    // ── SCENARIO 4: Turn Light OFF via power button
    power.click();
    await new Promise(r => setTimeout(r, 200));

    assert('Light OFF: Light is inactive', !power.classList.contains('active'));
    assert('Light OFF: privacyNote MUST NOT be displayed', !isVisuallyDisplayed(privacyNote),
      'computed display: ' + window.getComputedStyle(privacyNote).display + ', opacity: ' + window.getComputedStyle(privacyNote).opacity);

    // ── SCENARIO 5: Ensure privacyNote never displays when light is OFF even if dock is hovered
    hoverZone.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 200));
    assert('Light OFF & Dock Hovered: privacyNote still NOT displayed', !isVisuallyDisplayed(privacyNote));

    // Turn light back ON
    power.click();
    await new Promise(r => setTimeout(r, 200));

    return report;
  })()`);

  console.log('\\n==================== PRIVACY NOTE VISIBILITY TESTS ====================');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] ${r.name} ${r.details ? '(' + r.details + ')' : ''}`);
    if (!r.passed) allPassed = false;
  }
  console.log('========================================================================\\n');

  win.destroy();
  app.quit();
  process.exit(allPassed ? 0 : 1);
});
