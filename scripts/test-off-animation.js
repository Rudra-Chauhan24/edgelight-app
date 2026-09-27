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
  await wait(800);

  const results = await win.webContents.executeJavaScript(`(async () => {
    const report = [];
    const assert = (name, cond, details) => {
      report.push({ name, passed: !!cond, details: details || '' });
    };

    const power = document.getElementById('power');
    const canvas = document.getElementById('light');
    const ctx = canvas.getContext('2d');

    // Make sure power is ON initially and wait for it to fully bloom
    if (!power.classList.contains('active')) {
      power.click();
    }
    await new Promise(r => setTimeout(r, 1200));

    // Sample pixel while ON: center-top edge (x=center, y=25) is inside the 96px band
    const sampleX = Math.floor(canvas.width / 2);
    const sampleY = 25;
    const onEdgePixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
    assert('Light ON: Edge pixel has opacity', onEdgePixel[3] > 0, 'Alpha=' + onEdgePixel[3]);

    report.push({ name: 'State before click', passed: true, details: 'thickScale=' + window.__renderState.thickScale });

    // Now turn OFF
    power.click();
    assert('Power button toggled to inactive', !power.classList.contains('active'));

    // Sample during mid-animation (~300ms)
    await new Promise(r => setTimeout(r, 300));
    const midPixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
    assert('Animation in flight at ~300ms', midPixel[3] > 0, 'Mid alpha=' + midPixel[3]);

    // Wait until animation settles (~3000ms off animation duration + buffer)
    await new Promise(r => setTimeout(r, 3150));

    const finalState = {
      thickScale: window.__renderState.thickScale,
      on: window.__state.on
    };
    report.push({ name: 'Final state', passed: true, details: JSON.stringify(finalState) });

    // Sample edge pixels, borders, and center-top
    const samplePoints = [
      [sampleX, 4], [sampleX, 25], [sampleX, 60],
      [4, Math.floor(canvas.height / 2)], [canvas.width - 5, Math.floor(canvas.height / 2)],
      [sampleX, canvas.height - 10]
    ];

    let maxAlpha = 0;
    const alphas = [];
    for (const [x, y] of samplePoints) {
      const p = ctx.getImageData(x, y, 1, 1).data;
      alphas.push('(' + x + ',' + y + ')=' + p[3]);
      if (p[3] > maxAlpha) maxAlpha = p[3];
    }

    assert('Animation finished: Canvas 100% transparent at all borders', maxAlpha === 0, 'Max Alpha=' + maxAlpha + ' Points: ' + alphas.join(', '));

    return report;
  })()`);

  console.log('\n==================== OFF ANIMATION VERIFICATION ====================');
  let allPass = true;
  for (const r of results) {
    const status = r.passed ? '[✓ PASS]' : '[✗ FAIL]';
    console.log(`${status} ${r.name} ${r.details ? '(' + r.details + ')' : ''}`);
    if (!r.passed) allPass = false;
  }
  console.log('====================================================================\n');

  app.quit();
  process.exit(allPass ? 0 : 1);
});
