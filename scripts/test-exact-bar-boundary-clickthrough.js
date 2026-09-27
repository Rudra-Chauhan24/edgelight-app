const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let ignoreCalls = [];

ipcMain.handle('get-app-version', () => '1.0.3');
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('is-fullscreen', () => false);
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  ignoreCalls.push({ ignore, options, timestamp: Date.now() });
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
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(800);

  const testResults = await win.webContents.executeJavaScript(`(async () => {
    const report = [];
    const assert = (name, cond, details) => {
      report.push({ name, passed: !!cond, details: details || '' });
    };

    const bar = document.getElementById('bar');
    const hoverZone = document.getElementById('hover-zone');

    // 1. Summon dock
    hoverZone.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 650)); // allow animation to finish
    assert('Top dock is open and visible', bar.classList.contains('visible'));
    assert('Hover zone has pointer-events: none while dock is open', getComputedStyle(hoverZone).pointerEvents === 'none');

    const rect = bar.getBoundingClientRect();
    const centerX = Math.round(rect.left + rect.width / 2);
    const centerY = Math.round(rect.top + rect.height / 2);

    return {
      report,
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
      centerX,
      centerY
    };
  })()`);

  console.log('\\n================ EXACT BAR BOUNDARY CLICK-THROUGH TEST ================');
  console.log('Dock Bounding Box:', JSON.stringify(testResults.rect));

  for (const r of testResults.report) {
    console.log(`[${r.passed ? '✓ PASS' : '✗ FAIL'}] ${r.name} ${r.details ? '(' + r.details + ')' : ''}`);
  }

  let allPassed = testResults.report.every(r => r.passed);
  const rect = testResults.rect;

  // Helper to test a cursor coordinate and see what ignore state is triggered
  async function testPoint(name, x, y, expectedIgnore) {
    const callsBefore = ignoreCalls.length;
    await win.webContents.executeJavaScript(`
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y} }));
    `);
    await wait(60);
    const latest = ignoreCalls[ignoreCalls.length - 1];
    const actualIgnore = latest ? latest.ignore : null;
    const passed = (actualIgnore === expectedIgnore);
    console.log(`[${passed ? '✓ PASS' : '✗ FAIL'}] ${name} at (${x}, ${y}) -> expected ignore: ${expectedIgnore}, actual: ${actualIgnore}`);
    if (!passed) allPassed = false;
    return passed;
  }

  // 1. Inside bar center -> ignore: false (bar captures clicks)
  await testPoint('Inside bar center', testResults.centerX, testResults.centerY, false);

  // 2. 1px to the LEFT of bar edge -> ignore: true (background clickable)
  await testPoint('1px Left of bar edge', Math.floor(rect.left) - 1, testResults.centerY, true);

  // 3. Inside left edge of bar (+5px) -> ignore: false
  await testPoint('Inside bar left (+5px)', Math.floor(rect.left) + 5, testResults.centerY, false);

  // 4. 1px to the RIGHT of bar edge -> ignore: true (background clickable)
  await testPoint('1px Right of bar edge', Math.ceil(rect.right) + 1, testResults.centerY, true);

  // 5. Inside right edge of bar (-5px) -> ignore: false
  await testPoint('Inside bar right (-5px)', Math.ceil(rect.right) - 5, testResults.centerY, false);

  // 6. 1px ABOVE bar edge -> ignore: true (background clickable)
  await testPoint('1px Above bar edge', testResults.centerX, Math.floor(rect.top) - 1, true);

  // 7. Inside top edge of bar (+5px) -> ignore: false
  await testPoint('Inside bar top (+5px)', testResults.centerX, Math.floor(rect.top) + 5, false);

  // 8. 1px BELOW bar edge -> ignore: true (background clickable)
  await testPoint('1px Below bar edge', testResults.centerX, Math.ceil(rect.bottom) + 1, true);

  // 9. Inside bottom edge of bar (-5px) -> ignore: false
  await testPoint('Inside bar bottom (-5px)', testResults.centerX, Math.ceil(rect.bottom) - 5, false);

  // 10. Top margin (y=8, above bar in former hover-zone area) -> ignore: true (background clickable)
  await testPoint('Top screen edge above bar (y=8)', testResults.centerX, 8, true);

  // 11. Center screen / desktop area -> ignore: true (background clickable)
  await testPoint('Center of screen (desktop)', 640, 450, true);

  console.log('========================================================================\\n');

  win.destroy();
  app.quit();
  process.exit(allPassed ? 0 : 1);
});
