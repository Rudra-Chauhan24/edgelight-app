const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { LicenseManager } = require('../src/license-manager');

console.log('🧪 Starting Edge Light Real-Time Floating Bar Controls Test Suite...\n');

let lightStateChangedCalls = [];
let lm = new LicenseManager();

ipcMain.handle('get-app-version', () => '1.0.16');
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('is-fullscreen', () => false);
ipcMain.handle('get-license-info', () => lm.getStatus());
ipcMain.handle('refresh-license-info', async () => lm.getStatus());
ipcMain.handle('get-cursor-position', () => ({ x: 640, y: 35 }));
ipcMain.handle('get-webcam-status', () => ({ inUse: false, activeApps: [] }));
ipcMain.handle('get-payment-config', () => lm.getPaymentConfig());
ipcMain.on('set-ignore-mouse-events', () => {});
ipcMain.on('controls-visibility-changed', () => {});
ipcMain.on('light-state-changed', (event, isOn) => {
  lightStateChangedCalls.push(isOn);
});

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
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(600);

  const results = await win.webContents.executeJavaScript(`(async () => {
    const report = [];
    const assert = (name, cond, details) => {
      report.push({ name, passed: !!cond, details: details || '' });
    };

    const power = document.getElementById('power');
    const tempInput = document.getElementById('temp');
    const tempVal = document.getElementById('tempVal');
    const thicknessInput = document.getElementById('thickness');
    const thicknessVal = document.getElementById('thicknessVal');
    const licenseBadge = document.getElementById('license-badge');
    const canvas = document.getElementById('light');
    const ctx = canvas.getContext('2d');

    // ── 1. Initial State Checks ──────────────────────────────────────
    assert('Power button exists and is active initially', power && power.classList.contains('active'));
    assert('Temperature input exists with initial 50%', tempInput && Number(tempInput.value) === 50);
    assert('Temperature label initially displays 5000K', tempVal && tempVal.textContent.trim() === '5000K');
    assert('Thickness input exists', !!thicknessInput);
    assert('Thickness label matches thickness input value', thicknessVal && thicknessVal.textContent.includes(thicknessInput.value));
    assert('License badge exists and displays dynamic license status', licenseBadge && licenseBadge.textContent.length > 0);

    // Wait for bloom-in to settle to 1.0
    await new Promise(r => setTimeout(r, 3200));
    assert('Lighting engine thickScale settled at 1.0 (ON)', window.__renderState.thickScale >= 0.999);

    const dpr = window.devicePixelRatio || 1;
    const sampleX = Math.round(20 * dpr);
    const sampleY = Math.floor(canvas.height / 2);

    // Sample initial 5000K daylight neutral pixel color on left border
    const initialPixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
    assert('Canvas has active illumination initially (alpha > 0)', initialPixel[3] > 0, 'Alpha=' + initialPixel[3]);

    // ── 2. Real-Time Temperature Slider Test ─────────────────────────
    // Move to 0 (3744K Warm White)
    tempInput.value = 0;
    tempInput.dispatchEvent(new Event('input', { bubbles: true }));
    assert('Temp label updates immediately to 3744K', tempVal.textContent.trim() === '3744K');
    assert('State temp immediately updates to 0', window.__state.temp === 0);
    assert('Lighting engine renderState.temp immediately updates to 0', window.__renderState.temp === 0);

    // Verify actual canvas color temperature changed immediately to warm amber
    const warmPixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
    // In warm white (3744K), Blue channel is noticeably lower than Red channel
    assert('Actual overlay color changed to warm white (Red > Blue by at least 30)', warmPixel[0] - warmPixel[2] > 30, 'R=' + warmPixel[0] + ', B=' + warmPixel[2]);

    // Move to 100 (6500K Cool White)
    tempInput.value = 100;
    tempInput.dispatchEvent(new Event('input', { bubbles: true }));
    assert('Temp label updates immediately to 6500K', tempVal.textContent.trim() === '6500K');
    assert('State temp immediately updates to 1.0', window.__state.temp === 1.0);
    assert('Lighting engine renderState.temp immediately updates to 1.0', window.__renderState.temp === 1.0);

    const coolPixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
    // In cool daylight (6500K), Blue channel is high (255) and Red is 220
    assert('Actual overlay color changed to cool white (Blue >= Red)', coolPixel[2] >= coolPixel[0], 'R=' + coolPixel[0] + ', B=' + coolPixel[2]);

    // ── 3. Real-Time Thickness Slider Test ───────────────────────────
    // Set thickness to 140px
    thicknessInput.value = 140;
    thicknessInput.dispatchEvent(new Event('input', { bubbles: true }));
    assert('Thickness label immediately updates to 140px', thicknessVal.textContent.trim() === '140px');
    assert('State thickness immediately updates to 140', window.__state.thickness === 140);
    assert('Lighting engine renderState.thickness immediately updates to 140', window.__renderState.thickness === 140);

    // Verify canvas band width expanded (pixel at x=110 should now have alpha > 0)
    const deepX = Math.round(110 * dpr);
    const deepPixelAt140 = ctx.getImageData(deepX, sampleY, 1, 1).data;
    assert('Actual overlay thickness band expanded into screen (pixel at x=110 is illuminated)', deepPixelAt140[3] > 0, 'Alpha=' + deepPixelAt140[3]);

    // Set thickness to 40px
    thicknessInput.value = 40;
    thicknessInput.dispatchEvent(new Event('input', { bubbles: true }));
    assert('Thickness label immediately updates to 40px', thicknessVal.textContent.trim() === '40px');
    assert('State thickness immediately updates to 40', window.__state.thickness === 40);
    assert('Lighting engine renderState.thickness immediately updates to 40', window.__renderState.thickness === 40);

    // Deep pixel at x=110 should now be cleared / zero alpha
    const deepPixelAt40 = ctx.getImageData(deepX, sampleY, 1, 1).data;
    assert('Actual overlay thickness retracted (pixel at x=110 is now transparent)', deepPixelAt40[3] === 0, 'Alpha=' + deepPixelAt40[3]);

    // ── 4. Real-Time Power Button Toggle ─────────────────────────────
    power.click();
    assert('Power button immediately toggles off (active class removed)', !power.classList.contains('active'));
    assert('Power button aria-pressed set to false', power.getAttribute('aria-pressed') === 'false');
    assert('State on immediately set to false', window.__state.on === false);

    // Wait for smooth retraction
    await new Promise(r => setTimeout(r, 3200));
    assert('Lighting engine thickScale settled at 0.0 (OFF)', window.__renderState.thickScale === 0);

    // Canvas must be 100% transparent when OFF
    const offPixel = ctx.getImageData(Math.floor(canvas.width / 2), 10, 1, 1).data;
    assert('Canvas overlay is completely off and clear (alpha 0)', offPixel[3] === 0, 'Alpha=' + offPixel[3]);

    // Click power ON
    power.click();
    assert('Power button immediately toggles on (active class added)', power.classList.contains('active'));
    assert('Power button aria-pressed set to true', power.getAttribute('aria-pressed') === 'true');
    assert('State on immediately set to true', window.__state.on === true);

    // ── 5. Real-Time License Badge Verification ──────────────────────
    assert('License badge displays dynamic text (not blank)', licenseBadge.textContent.trim().length > 0);
    assert('License badge displays trial countdown or licensed status', 
      licenseBadge.textContent.includes('Trial:') || 
      licenseBadge.textContent.includes('Pro') || 
      licenseBadge.textContent.includes('Expired'),
      'badge text=' + licenseBadge.textContent
    );

    return report;
  })()`);

  console.log('================ REAL-TIME FLOATING BAR VERIFICATION ================');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] ${r.name} ${r.details ? '(' + r.details + ')' : ''}`);
    if (!r.passed) allPassed = false;
  }

  // Check IPC notifications
  const hasOffNotice = lightStateChangedCalls.includes(false);
  const hasOnNotice = lightStateChangedCalls.includes(true);
  console.log(`[${hasOffNotice && hasOnNotice ? '✓ PASS' : '✗ FAIL'}] IPC notifyLightState called on power toggles: ${JSON.stringify(lightStateChangedCalls)}`);
  if (!hasOffNotice || !hasOnNotice) allPassed = false;

  console.log('=====================================================================');
  console.log('Final Result:', allPassed ? 'ALL REAL-TIME CONTROLS PASSED!' : 'SOME TESTS FAILED!');

  win.destroy();
  app.quit();
  process.exit(allPassed ? 0 : 1);
});
