const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  let isFS = false;
  ipcMain.handle('get-app-version', () => '1.0.3');
  ipcMain.handle('toggle-fullscreen', () => {
    isFS = !isFS;
    return isFS;
  });
  ipcMain.handle('is-fullscreen', () => isFS);
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
    const autoSwitch = document.getElementById('autoSwitch');
    const thresholdWrap = document.getElementById('thresholdWrap');
    const liveLux = document.getElementById('liveLux');
    const bar = document.getElementById('bar');
    const thicknessDec = document.getElementById('thicknessDec');
    const thicknessInc = document.getElementById('thicknessInc');
    const thicknessVal = document.getElementById('thicknessVal');

    // ── TEST 1: Black Frame Camera (Privacy shutter closed / hardware switch off)
    const blackCanvas = document.createElement('canvas');
    blackCanvas.width = 64;
    blackCanvas.height = 48;
    const bctx = blackCanvas.getContext('2d');
    bctx.fillStyle = '#000000';
    bctx.fillRect(0, 0, 64, 48);
    const mockBlackStream = blackCanvas.captureStream(20);

    navigator.mediaDevices.getUserMedia = async () => mockBlackStream;
    HTMLMediaElement.prototype.play = async function() {};

    // Ensure edge light is initially ON
    if (!power.classList.contains('active')) {
      power.click();
    }
    assert('Precondition: Light initially ON', power.classList.contains('active'));

    // Turn ON Auto Mode with camera delivering black frames
    autoSwitch.click();
    await new Promise(r => setTimeout(r, 400));

    // When camera is off / black frames: Edge Light must NOT turn ON; it must turn OFF!
    assert('Camera Off: Auto switch active', autoSwitch.getAttribute('aria-checked') === 'true');
    assert('Camera Off: Live Lux shows Off', liveLux.textContent.includes('Off'), 'liveLux: ' + liveLux.textContent);
    assert('Camera Off: Edge Light turned OFF', !power.classList.contains('active'), 'power active: ' + power.classList.contains('active'));

    // ── TEST 2: Buttons remain fully responsive while Auto is active and camera is off
    const tBefore = thicknessVal.textContent;
    thicknessInc.click();
    const tAfter = thicknessVal.textContent;
    assert('Button Click: Thickness Inc (+) responsive', tBefore !== tAfter, 'before: ' + tBefore + ', after: ' + tAfter);

    thicknessDec.click();
    assert('Button Click: Thickness Dec (-) responsive', thicknessVal.textContent === tBefore);

    // Power click cleanly stops auto and turns light on manually
    power.click();
    await new Promise(r => setTimeout(r, 200));
    assert('Button Click: Power button turns light ON manually', power.classList.contains('active'));
    assert('Button Click: Auto cleanly stopped on manual power click', autoSwitch.getAttribute('aria-checked') === 'false');

    // ── TEST 3: Track Muted / Ended Detection
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = 64;
    colorCanvas.height = 48;
    const cctx = colorCanvas.getContext('2d');
    cctx.fillStyle = '#999999';
    cctx.fillRect(0, 0, 64, 48);
    const mockColorStream = colorCanvas.captureStream(20);
    navigator.mediaDevices.getUserMedia = async () => mockColorStream;

    autoSwitch.click();
    await new Promise(r => setTimeout(r, 300));
    assert('Active Camera: Lux has numerical reading', liveLux.textContent.match(/\\d+/), 'liveLux: ' + liveLux.textContent);

    // Simulate track muted (hardware camera toggle pressed)
    const track = mockColorStream.getVideoTracks()[0];
    track.dispatchEvent(new Event('mute'));
    await new Promise(r => setTimeout(r, 300));

    assert('Muted Track: Lux shows Off', liveLux.textContent.includes('Off'), 'liveLux: ' + liveLux.textContent);
    assert('Muted Track: Light turned OFF', !power.classList.contains('active'));

    // Turn auto off cleanly
    autoSwitch.click();
    await new Promise(r => setTimeout(r, 100));

    return report;
  })()`);

  console.log('\\n==================== CAMERA OFF & BUTTON TESTS ====================');
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
