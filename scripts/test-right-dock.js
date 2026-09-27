const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let ignoreCalls = [];

ipcMain.handle('get-app-version', () => '1.0.3');
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('is-fullscreen', () => false);
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  ignoreCalls.push({ ignore, options });
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

  const results = await win.webContents.executeJavaScript(`(async () => {
    const report = [];
    const assert = (name, cond, details) => {
      report.push({ name, passed: !!cond, details: details || '' });
    };

    const bar = document.getElementById('bar');
    const hoverZone = document.getElementById('hover-zone');
    const power = document.getElementById('power');
    const temp = document.getElementById('temp');
    const thickness = document.getElementById('thickness');
    const autoSwitch = document.getElementById('autoSwitch');
    const dismissBtn = document.getElementById('dismissBtn');
    const privacyNote = document.getElementById('privacy-note');
    const status = document.getElementById('status');

    // 1. Check hover zone positioning on right edge
    const hzRect = hoverZone.getBoundingClientRect();
    assert('Hover zone is at right edge of screen', hzRect.right >= window.innerWidth - 5, 'hz right: ' + hzRect.right + ', winWidth: ' + window.innerWidth);
    assert('Hover zone is centered vertically', Math.abs((hzRect.top + hzRect.height / 2) - window.innerHeight / 2) < 20);

    // 2. Summon dock via hover-zone
    hoverZone.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 650)); // wait for open animation
    assert('Dock is visible after right edge hover', bar.classList.contains('visible'));
    assert('Hover zone has pointer-events: none while dock is open', getComputedStyle(hoverZone).pointerEvents === 'none');

    // 3. Inspect bar positioning on right edge
    const barRect = bar.getBoundingClientRect();
    assert('Dock right edge is near right edge of screen (right >= window.innerWidth - 30)', barRect.right >= window.innerWidth - 30, 'bar right: ' + barRect.right);
    assert('Dock is vertically centered', Math.abs((barRect.top + barRect.height / 2) - window.innerHeight / 2) < 30, 'bar center Y: ' + (barRect.top + barRect.height / 2));
    assert('Dock is vertical column layout (height > width)', barRect.height > barRect.width, 'height: ' + barRect.height + ', width: ' + barRect.width);

    // 4. Verify all dock controls are present and interactive
    assert('Power button is visible and present', !!power && power.offsetWidth > 0);
    assert('Temperature slider is visible', !!temp && temp.offsetWidth > 0);
    assert('Thickness slider is visible', !!thickness && thickness.offsetWidth > 0);
    assert('Auto switch is visible', !!autoSwitch && autoSwitch.offsetWidth > 0);
    assert('Dismiss button is visible', !!dismissBtn && dismissBtn.offsetWidth > 0);

    // 5. Test Dismiss button
    dismissBtn.click();
    await new Promise(r => setTimeout(r, 550));
    assert('Dock dismissed via dismiss button', !bar.classList.contains('visible'));

    // 6. Test Right edge mousemove summon
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: window.innerWidth - 5, clientY: window.innerHeight / 2 }));
    await new Promise(r => setTimeout(r, 650));
    assert('Right edge mousemove summons dock', bar.classList.contains('visible'));

    const finalBarRect = bar.getBoundingClientRect();
    return {
      report,
      barRect: {
        left: finalBarRect.left,
        right: finalBarRect.right,
        top: finalBarRect.top,
        bottom: finalBarRect.bottom,
        width: finalBarRect.width,
        height: finalBarRect.height
      }
    };
  })()`);

  console.log('\\n==================== RIGHT EDGE DOCK TESTS ====================');
  console.log('Dock Bounding Box:', JSON.stringify(results.barRect));
  let allPassed = true;
  for (const r of results.report) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] ${r.name} ${r.details ? '(' + r.details + ')' : ''}`);
    if (!r.passed) allPassed = false;
  }

  // Click-through tests around the vertical right dock
  const b = results.barRect;
  const centerX = Math.round(b.left + b.width / 2);
  const centerY = Math.round(b.top + b.height / 2);

  async function testPoint(name, x, y, expectedIgnore) {
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

  console.log('\\n--- Click-through Boundary Tests (Right Dock) ---');
  // 1. Inside dock center -> ignore: false (bar captures clicks)
  await testPoint('Inside dock center', centerX, centerY, false);

  // 2. 1px to the LEFT of dock edge -> ignore: true (background clickable)
  await testPoint('1px Left of dock edge', Math.floor(b.left) - 1, centerY, true);

  // 3. 1px ABOVE dock edge -> ignore: true (background clickable)
  await testPoint('1px Above dock edge', centerX, Math.floor(b.top) - 1, true);

  // 4. 1px BELOW dock edge -> ignore: true (background clickable)
  await testPoint('1px Below dock edge', centerX, Math.ceil(b.bottom) + 1, true);

  // 5. Desktop / center screen -> ignore: true (background clickable)
  await testPoint('Desktop center (500, 400)', 500, 400, true);

  console.log('=================================================================\\n');

  win.destroy();
  app.quit();
  process.exit(allPassed ? 0 : 1);
});
