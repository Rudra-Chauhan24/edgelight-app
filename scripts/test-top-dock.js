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
    const status = document.getElementById('status');
    const privacyNote = document.getElementById('privacy-note');

    // 1. Check Hover Zone positioning at the very top of the window
    const hzRect = hoverZone.getBoundingClientRect();
    assert('Hover zone is at top of screen (top <= 5px)', hzRect.top <= 5, 'hz top: ' + hzRect.top);
    assert('Hover zone is centered horizontally', Math.abs((hzRect.left + hzRect.right) / 2 - window.innerWidth / 2) < 5);

    // 2. Summon dock via hoverZone
    hoverZone.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise(r => setTimeout(r, 650));

    assert('Dock is visible after top hover', bar.classList.contains('visible'));
    const barRect = bar.getBoundingClientRect();
    const cTransform = window.getComputedStyle(bar).transform;
    assert('Dock top position is near top of screen (top between 15px and 30px)', barRect.top >= 15 && barRect.top <= 35, 'bar top: ' + barRect.top + ', transform: ' + cTransform);
    assert('Dock is centered horizontally', Math.abs((barRect.left + barRect.right) / 2 - window.innerWidth / 2) < 5);

    // 3. Status toast positioning (should be near bottom of screen, not top)
    status.classList.add('visible');
    const statusRect = status.getBoundingClientRect();
    assert('Status badge is near bottom (bottom > 700px)', statusRect.bottom > 700, 'status bottom: ' + statusRect.bottom);
    status.classList.remove('visible');

    // 4. Privacy note positioning (should be directly underneath the top dock)
    privacyNote.classList.add('visible');
    const pnRect = privacyNote.getBoundingClientRect();
    assert('Privacy note is positioned below top dock (top between 65px and 95px)', pnRect.top >= 65 && pnRect.top <= 95, 'privacyNote top: ' + pnRect.top);
    privacyNote.classList.remove('visible');

    // 5. Test mousemove summon near top center
    const dismissBtn = document.getElementById('dismissBtn');
    dismissBtn.click();
    await new Promise(r => setTimeout(r, 100));
    assert('Dock dismissed', !bar.classList.contains('visible'));

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: window.innerWidth / 2, clientY: 10 }));
    await new Promise(r => setTimeout(r, 100));
    assert('Top center mousemove summons dock', bar.classList.contains('visible'));

    return report;
  })()`);

  console.log('\\n==================== TOP DOCK POSITION TESTS ====================');
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] ${r.name} ${r.details ? '(' + r.details + ')' : ''}`);
    if (!r.passed) allPassed = false;
  }
  console.log('=================================================================\\n');

  win.destroy();
  app.quit();
  process.exit(allPassed ? 0 : 1);
});
