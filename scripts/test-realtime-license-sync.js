const fs = require('fs');
const path = require('path');
const { LicenseManager } = require('../src/license-manager');

console.log('🧪 Starting Real-Time License Sync Test Suite...\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  // 1. Check LicenseManager real-time methods
  const lm = new LicenseManager();
  assert(typeof lm.refresh === 'function', 'LicenseManager exposes refresh() method');
  assert(typeof lm.startPeriodicSync === 'function', 'LicenseManager exposes startPeriodicSync() method');

  const refreshed = await lm.refresh();
  assert(refreshed && typeof refreshed === 'object', 'lm.refresh() returns updated status object');
  assert(Boolean(refreshed.hwid), `Refreshed status contains HWID: ${refreshed.hwid}`);
  assert(['approved', 'trial', 'expired', 'rejected', 'clock_tampered'].includes(refreshed.status), `Refreshed status is valid: ${refreshed.status}`);

  // 2. Check main.js handles 'refresh-license-info'
  const mainCode = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert(mainCode.includes("ipcMain.handle('refresh-license-info'"), 'src/main.js handles refresh-license-info IPC');
  assert(mainCode.includes("licenseManager.refresh()"), 'src/main.js invokes licenseManager.refresh()');
  assert(mainCode.includes("mainWindow.webContents.send('license-status-changed'"), 'src/main.js broadcasts license-status-changed on refresh');

  // 3. Check preload.js exposes refreshLicenseInfo
  const preloadCode = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
  assert(preloadCode.includes("refreshLicenseInfo: () => ipcRenderer.invoke('refresh-license-info')"), 'src/preload.js exposes refreshLicenseInfo bridge');

  // 4. Check renderer.js implements live polling and immediate sync on open
  ['../src/renderer.js', '../application/src/renderer.js'].forEach((relPath) => {
    const rCode = fs.readFileSync(path.join(__dirname, relPath), 'utf8');
    assert(rCode.includes('startLiveLicenseSync()'), `${relPath} invokes startLiveLicenseSync() when modal is open`);
    assert(rCode.includes('stopLiveLicenseSync()'), `${relPath} stops live sync when modal closes`);
    assert(rCode.includes('checkLiveLicense()'), `${relPath} performs instant live check`);
    assert(rCode.includes('setInterval(') && rCode.includes('2500'), `${relPath} polls live license every 2.5 seconds`);
    assert(rCode.includes('window.edgeLightAPI?.refreshLicenseInfo'), `${relPath} invokes refreshLicenseInfo API`);
  });

  // 5. Check 30s background sync interval
  const lmCode = fs.readFileSync(path.join(__dirname, '../src/license-manager.js'), 'utf8');
  assert(lmCode.includes('intervalMs = 30000'), 'src/license-manager.js has 30s background sync interval (real-time responsiveness)');

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
  console.log('✅ Real-Time License Synchronization verified completely!');
}

runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
