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
  await wait(500);

  const results = await win.webContents.executeJavaScript(`(async () => {
    const report = [];
    const assert = (name, cond, details) => {
      report.push({ name, passed: !!cond, details: details || '' });
    };

    const power = document.getElementById('power');
    const canvas = document.getElementById('light');
    const ctx = canvas.getContext('2d');

    // Start with power OFF
    if (power.classList.contains('active')) {
      power.click();
      await new Promise(r => setTimeout(r, 3200));
    }

    assert('Initial state is OFF', window.__renderState.thickScale === 0, 'thickScale=' + window.__renderState.thickScale);

    // 1. Turn ON test — measure 3s ease-in-out transition
    power.click();

    // Check at 750ms (1/4 duration) -> ease-in curve should be gentle
    await new Promise(r => setTimeout(r, 750));
    const scale750ms = window.__renderState.thickScale;
    assert('Turn ON in flight at 750ms', scale750ms > 0 && scale750ms < 0.35, 'scale=' + scale750ms.toFixed(3));

    // Check at 1500ms (midpoint) -> ease-in-out curve should be around ~0.5
    await new Promise(r => setTimeout(r, 750));
    const scale1500ms = window.__renderState.thickScale;
    assert('Turn ON near midpoint at 1500ms', scale1500ms > 0.35 && scale1500ms < 0.65, 'scale=' + scale1500ms.toFixed(3));

    // Check at 2250ms (3/4 duration) -> decelerating towards 1.0
    await new Promise(r => setTimeout(r, 750));
    const scale2250ms = window.__renderState.thickScale;
    assert('Turn ON in late deceleration at 2250ms', scale2250ms > 0.70 && scale2250ms < 0.98, 'scale=' + scale2250ms.toFixed(3));

    // Wait until 3.15s has elapsed total
    await new Promise(r => setTimeout(r, 900));
    const scaleFinalOn = window.__renderState.thickScale;
    assert('Turn ON settled at 1.0 around 3s', scaleFinalOn >= 0.999, 'scale=' + scaleFinalOn);

    // 2. Turn OFF test — measure 3s ease-in-out transition
    power.click();

    // Check at 750ms (1/4 off duration)
    await new Promise(r => setTimeout(r, 750));
    const scaleOff750ms = window.__renderState.thickScale;
    assert('Turn OFF in flight at 750ms', scaleOff750ms < 1.0 && scaleOff750ms > 0.65, 'scale=' + scaleOff750ms.toFixed(3));

    // Check at 1500ms (midpoint)
    await new Promise(r => setTimeout(r, 750));
    const scaleOff1500ms = window.__renderState.thickScale;
    assert('Turn OFF near midpoint at 1500ms', scaleOff1500ms > 0.35 && scaleOff1500ms < 0.65, 'scale=' + scaleOff1500ms.toFixed(3));

    // Check at 2250ms (3/4 off duration)
    await new Promise(r => setTimeout(r, 750));
    const scaleOff2250ms = window.__renderState.thickScale;
    assert('Turn OFF near end at 2250ms', scaleOff2250ms < 0.35 && scaleOff2250ms > 0.02, 'scale=' + scaleOff2250ms.toFixed(3));

    // Wait for full settlement (~3150ms total)
    await new Promise(r => setTimeout(r, 900));
    const scaleFinalOff = window.__renderState.thickScale;
    assert('Turn OFF settled at 0.0 around 3s', scaleFinalOff === 0, 'scale=' + scaleFinalOff);

    // Verify canvas cleared
    const sampleX = Math.floor(canvas.width / 2);
    const pixel = ctx.getImageData(sampleX, 25, 1, 1).data;
    assert('Canvas 100% cleared when off', pixel[3] === 0, 'Alpha=' + pixel[3]);

    return report;
  })()`);

  console.log('\n==================== 3S EASE-IN-OUT TRANSITION VERIFICATION ====================');
  let allPass = true;
  for (const r of results) {
    const status = r.passed ? '[✓ PASS]' : '[✗ FAIL]';
    console.log(`${status} ${r.name} ${r.details ? '(' + r.details + ')' : ''}`);
    if (!r.passed) allPass = false;
  }
  console.log('================================================================================\n');

  app.quit();
  process.exit(allPass ? 0 : 1);
});
