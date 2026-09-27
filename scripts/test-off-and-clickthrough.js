const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let ignoreMouseCalls = [];

ipcMain.handle('get-app-version', () => '1.0.3');
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('is-fullscreen', () => false);
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  ignoreMouseCalls.push({ ignore, options });
});
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
      nodeIntegration: false,
      backgroundThrottling: false
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
    const canvas = document.getElementById('light');
    const ctx = canvas.getContext('2d');

    // 1. Initially ON
    assert('Precondition: Light initially ON', power.classList.contains('active'));

    // 2. Summon dock and move mouse over power button (top edge)
    bar.classList.add('visible');
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 640, clientY: 35 }));
    await new Promise(r => setTimeout(r, 100));

    let errorOccurred = null;
    window.onerror = (msg, url, line) => {
      errorOccurred = msg + ' at line ' + line;
    };

    // 3. User clicks Power button to turn OFF
    power.click();
    assert('Power button toggled off', !power.classList.contains('active'));
    assert('Power button is blurred (no focus trap)', document.activeElement !== power);

    // 4. Move mouse away to center of screen (e.g. user goes back to work)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 400 }));

    // Wait for the retraction animation to settle (~2000ms)
    await new Promise(r => setTimeout(r, 2150));

    assert('No runtime exceptions occurred', errorOccurred === null, errorOccurred || 'None');
    assert('Final state thickScale is 0', window.__renderState.thickScale === 0, 'thickScale=' + window.__renderState.thickScale);
    assert('State on is false', window.__state.on === false);

    // 5. Sample border pixels - all must be alpha 0
    const samplePoints = [
      [canvas.width / 2, 10],
      [canvas.width / 2, 40],
      [10, canvas.height / 2],
      [canvas.width - 10, canvas.height / 2],
      [canvas.width / 2, canvas.height - 10]
    ];
    let maxAlpha = 0;
    for (const [x, y] of samplePoints) {
      const a = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3];
      if (a > maxAlpha) maxAlpha = a;
    }
    assert('Canvas has zero opacity anywhere on borders', maxAlpha === 0, 'maxAlpha=' + maxAlpha);

    // 6. Verify dock auto-hides after idle time
    await new Promise(r => setTimeout(r, 3200));
    assert('Dock auto-hides after idle time', !bar.classList.contains('visible'));

    return report;
  })()`);

  console.log('\n================ TURN OFF & CLICK-THROUGH VERIFICATION ================');
  let allPass = true;
  for (const r of results) {
    const status = r.passed ? '[✓ PASS]' : '[✗ FAIL]';
    console.log(`${status} ${r.name} ${r.details ? '(' + r.details + ')' : ''}`);
    if (!r.passed) allPass = false;
  }

  // Check that setIgnoreMouseEvents(true) was sent when dock hidden
  const lastIgnore = ignoreMouseCalls[ignoreMouseCalls.length - 1];
  const clickThroughActive = lastIgnore && lastIgnore.ignore === true;
  console.log(`[${clickThroughActive ? '✓ PASS' : '✗ FAIL'}] Click-through enabled on dock hide (${JSON.stringify(lastIgnore)})`);
  if (!clickThroughActive) allPass = false;

  console.log('========================================================================\n');

  app.quit();
  process.exit(allPass ? 0 : 1);
});
