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

    // 1. Power Button
    const power = document.getElementById('power');
    const p1 = power.classList.contains('active');
    power.click();
    const p2 = power.classList.contains('active');
    power.click();
    const p3 = power.classList.contains('active');
    assert('Power button toggle OFF', p1 === true && p2 === false);
    assert('Power button toggle ON', p3 === true);

    // 2. Thickness Slider (Stepper buttons cleanly removed per user request)
    const thickness = document.getElementById('thickness');
    const thicknessVal = document.getElementById('thicknessVal');
    const thicknessDec = document.getElementById('thicknessDec');
    const thicknessInc = document.getElementById('thicknessInc');

    assert('Thickness stepper (+/-) buttons cleanly removed', !thicknessDec && !thicknessInc);

    thickness.value = 140;
    thickness.dispatchEvent(new Event('input'));
    assert('Thickness Slider Input', Number(thickness.value) === 140 && thicknessVal.textContent === '140px', 'value: ' + thickness.value + ', text: ' + thicknessVal.textContent);

    // 3. Auto Switch & Threshold Bar Pop-in Animation
    const mockCanvas = document.createElement('canvas');
    mockCanvas.width = 10;
    mockCanvas.height = 10;
    const mockStream = mockCanvas.captureStream(10);
    navigator.mediaDevices.getUserMedia = async () => mockStream;
    HTMLMediaElement.prototype.play = async function() {};

    const autoSwitch = document.getElementById('autoSwitch');
    const autoLabel = document.getElementById('autoLabel');
    const autoSwitchWrap = document.getElementById('autoSwitchWrap');
    const thresholdWrap = document.getElementById('thresholdWrap');

    assert('Auto switch initial active by default', autoSwitch.getAttribute('aria-checked') === 'true');

    autoSwitch.click();
    await new Promise(r => setTimeout(r, 100));
    const auto1 = autoSwitch.getAttribute('aria-checked');
    assert('Auto switch click OFF', auto1 === 'false', 'aria-checked: ' + auto1);
    assert('Threshold bar hidden when auto OFF', !thresholdWrap.classList.contains('active'));

    autoLabel.click();
    await new Promise(r => setTimeout(r, 50));
    const auto2 = autoSwitch.getAttribute('aria-checked');
    assert('Auto label click ON', auto2 === 'true');
    assert('Threshold bar popped active when auto ON', thresholdWrap.classList.contains('active'));

    autoSwitchWrap.click();
    await new Promise(r => setTimeout(r, 50));
    const auto3 = autoSwitch.getAttribute('aria-checked');
    assert('Auto wrap click OFF', auto3 === 'false');
    assert('Threshold bar hidden on wrap click', !thresholdWrap.classList.contains('active'));

    // Turn it back on
    autoSwitch.click();
    await new Promise(r => setTimeout(r, 50));

    // 4. Dismiss Button
    const bar = document.getElementById('bar');
    const dismissBtn = document.getElementById('dismissBtn');
    bar.classList.add('visible');
    dismissBtn.click();
    assert('Dismiss button hides dock', !bar.classList.contains('visible'));

    // 6. Temp and Threshold Sliders (Brightness cleanly removed from dock)
    const brightness = document.getElementById('brightness');
    assert('Brightness control cleanly removed from dock', brightness === null);

    const temp = document.getElementById('temp');
    const tempVal = document.getElementById('tempVal');
    temp.value = 0;
    temp.dispatchEvent(new Event('input', { bubbles: true }));
    assert('Temperature Slider (Min 3744K)', tempVal.textContent === '3744K');

    temp.value = 100;
    temp.dispatchEvent(new Event('input', { bubbles: true }));
    assert('Temperature Slider (Max 6500K)', tempVal.textContent === '6500K');

    const threshold = document.getElementById('threshold');
    const thresholdVal = document.getElementById('thresholdVal');
    threshold.value = 75;
    threshold.dispatchEvent(new Event('input', { bubbles: true }));
    assert('Threshold Slider', thresholdVal.textContent === '75');

    return report;
  })()`);

  console.log('\n================ ALL BUTTONS & CONTROLS VERIFICATION ================');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${mark}: [${r.name}] ${r.details}`);
    if (!r.passed) allPassed = false;
  }
  console.log('=====================================================================');
  console.log('Final Result:', allPassed ? 'ALL TESTS PASSED PERFECTLY!' : 'SOME TESTS FAILED!');

  app.quit();
});
