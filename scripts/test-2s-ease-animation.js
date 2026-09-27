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
      await new Promise(r => setTimeout(r, 2200));
    }

    assert('Initial state is OFF', window.__renderState.thickScale === 0, 'thickScale=' + window.__renderState.thickScale);

    // 1. Turn ON test — measure 2s ease-in-out transition
    const turnOnStart = performance.now();
    power.click();

    // Check at 500ms (1/4 duration) -> ease-in curve should be gentle
    await new Promise(r => setTimeout(r, 500));
    const scale500ms = window.__renderState.thickScale;
    assert('Turn ON in flight at 500ms', scale500ms > 0 && scale500ms < 0.6, 'scale=' + scale500ms.toFixed(3));

    // Check at 1000ms (midpoint) -> ease-in-out curve should be around ~0.5
    await new Promise(r => setTimeout(r, 500));
    const scale1000ms = window.__renderState.thickScale;
    assert('Turn ON near midpoint at 1000ms', scale1000ms > 0.35 && scale1000ms < 0.75, 'scale=' + scale1000ms.toFixed(3));

    // Check at 1500ms (3/4 duration) -> decelerating towards 1.0
    await new Promise(r => setTimeout(r, 500));
    const scale1500ms = window.__renderState.thickScale;
    assert('Turn ON in late deceleration at 1500ms', scale1500ms > 0.65 && scale1500ms < 0.99, 'scale=' + scale1500ms.toFixed(3));

    // Wait until 2.1s has elapsed
    await new Promise(r => setTimeout(r, 650));
    const scaleFinalOn = window.__renderState.thickScale;
    assert('Turn ON settled at 1.0 around 2s', scaleFinalOn >= 0.999, 'scale=' + scaleFinalOn);

    // 2. Turn OFF test — measure 2s ease-in-out transition
    power.click();

    // Check at 500ms (1/4 off duration)
    await new Promise(r => setTimeout(r, 500));
    const scaleOff500ms = window.__renderState.thickScale;
    assert('Turn OFF in flight at 500ms', scaleOff500ms < 1.0 && scaleOff500ms > 0.4, 'scale=' + scaleOff500ms.toFixed(3));

    // Check at 1000ms (midpoint)
    await new Promise(r => setTimeout(r, 500));
    const scaleOff1000ms = window.__renderState.thickScale;
    assert('Turn OFF near midpoint at 1000ms', scaleOff1000ms > 0.25 && scaleOff1000ms < 0.7, 'scale=' + scaleOff1000ms.toFixed(3));

    // Check at 1500ms (3/4 off duration)
    await new Promise(r => setTimeout(r, 500));
    const scaleOff1500ms = window.__renderState.thickScale;
    assert('Turn OFF near end at 1500ms', scaleOff1500ms < 0.4 && scaleOff1500ms > 0.01, 'scale=' + scaleOff1500ms.toFixed(3));

    // Wait for full settlement (~2100ms total)
    await new Promise(r => setTimeout(r, 650));
    const scaleFinalOff = window.__renderState.thickScale;
    assert('Turn OFF settled at 0.0 around 2s', scaleFinalOff === 0, 'scale=' + scaleFinalOff);

    // Verify canvas cleared
    const sampleX = Math.floor(canvas.width / 2);
    const pixel = ctx.getImageData(sampleX, 25, 1, 1).data;
    assert('Canvas 100% cleared when off', pixel[3] === 0, 'Alpha=' + pixel[3]);

    return report;
  })()`);

  console.log('\n==================== 2S EASE-IN-OUT TRANSITION VERIFICATION ====================');
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
