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

    // 1. Summon the top dock
    hoverZone.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 400));
    assert('Top dock is open and visible', bar.classList.contains('visible'));

    // 2. Move mouse to screen center / backward app area (e.g., x=640, y=400)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 640, clientY: 400 }));
    await new Promise(r => setTimeout(r, 80));
    assert('Dock remains floating at top while cursor is over backward app', bar.classList.contains('visible'));

    // 3. Move mouse onto dock controls (e.g. x=640, y=35)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 640, clientY: 35 }));
    await new Promise(r => setTimeout(r, 80));

    // 4. Move mouse back to backward app (e.g. x=300, y=500)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 500 }));
    await new Promise(r => setTimeout(r, 80));
    assert('Dock still remains floating', bar.classList.contains('visible'));

    return report;
  })()`);

  console.log('\\n================ FLOATING DOCK CLICK-THROUGH TEST ================');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] ${r.name} ${r.details ? '(' + r.details + ')' : ''}`);
    if (!r.passed) allPassed = false;
  }

  // Inspect the sequence of ignore-mouse-events calls
  console.log('\\nTotal setIgnoreMouseEvents IPC calls:', ignoreCalls.length);
  console.log('Call history:', JSON.stringify(ignoreCalls));

  // The last call (cursor at 300, 500 while dock is visible) MUST be ignore: true
  const lastCall = ignoreCalls[ignoreCalls.length - 1];
  const lastCallIsIgnore = lastCall && lastCall.ignore === true;
  console.log(`[${lastCallIsIgnore ? '✓ PASS' : '✗ FAIL'}] Background app is clickable while top dock is floating: ${JSON.stringify(lastCall)}`);
  if (!lastCallIsIgnore) allPassed = false;

  // There must have been an ignore: false call when cursor was at (640, 35) on the dock
  const hadDockCapture = ignoreCalls.some(c => c.ignore === false);
  console.log(`[${hadDockCapture ? '✓ PASS' : '✗ FAIL'}] Dock controls captured mouse when hovered: ${hadDockCapture}`);
  if (!hadDockCapture) allPassed = false;

  console.log('===================================================================\\n');

  win.destroy();
  app.quit();
  process.exit(allPassed ? 0 : 1);
});
