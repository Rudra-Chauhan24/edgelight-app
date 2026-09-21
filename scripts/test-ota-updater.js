const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { AppUpdater } = require('../src/updater');

console.log('🧪 Testing Over-The-Air (OTA) Updater System...\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log('  ✓ ' + desc);
    passed++;
  } catch (err) {
    console.error('  ✗ ' + desc);
    console.error('    ' + err.message);
    failed++;
  }
}

const updater = new AppUpdater();

// 1. Semver Parsing
it('parseSemver parses standard and prefixed version strings', () => {
  assert.deepStrictEqual(updater.parseSemver('1.0.4'), [1, 0, 4]);
  assert.deepStrictEqual(updater.parseSemver('v1.0.5'), [1, 0, 5]);
  assert.deepStrictEqual(updater.parseSemver('2.1'), [2, 1, 0]);
  assert.deepStrictEqual(updater.parseSemver(''), [0, 0, 0]);
});

// 2. Semver Comparison
it('isNewerVersion detects newer versions correctly', () => {
  assert.strictEqual(updater.isNewerVersion('1.0.5', '1.0.4'), true);
  assert.strictEqual(updater.isNewerVersion('1.1.0', '1.0.9'), true);
  assert.strictEqual(updater.isNewerVersion('2.0.0', '1.9.9'), true);
  assert.strictEqual(updater.isNewerVersion('1.0.4', '1.0.4'), false);
  assert.strictEqual(updater.isNewerVersion('1.0.3', '1.0.4'), false);
  assert.strictEqual(updater.isNewerVersion('0.9.9', '1.0.0'), false);
});

// 3. Mock Check for Updates
it('checkForUpdates flags available update when remote version is newer', async () => {
  const mockUpdater = new AppUpdater();
  mockUpdater.fetchJson = async () => ({
    version: '1.0.5',
    releaseDate: new Date().toISOString(),
    notes: '✨ Optical squircle continuous curvature and OTA updates',
    downloadUrl: 'https://example.com/EdgeLight-Setup-1.0.5.exe'
  });

  const res = await mockUpdater.checkForUpdates();
  assert.strictEqual(res.updateAvailable, true);
  assert.strictEqual(res.latestVersion, '1.0.5');
  assert.strictEqual(res.downloadUrl, 'https://example.com/EdgeLight-Setup-1.0.5.exe');
});

// 4. HTML Elements Verification
it('index.html contains #ota-banner and required child elements', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  assert(html.includes('id="ota-banner"'), 'Missing #ota-banner');
  assert(html.includes('id="ota-version"'), 'Missing #ota-version');
  assert(html.includes('id="ota-progress-box"'), 'Missing #ota-progress-box');
  assert(html.includes('id="ota-progress-fill"'), 'Missing #ota-progress-fill');
  assert(html.includes('id="ota-action-btn"'), 'Missing #ota-action-btn');
  assert(html.includes('id="ota-close-btn"'), 'Missing #ota-close-btn');
});

// 5. CSS Styles Verification
it('style.css contains styles for .ota-banner and progress elements', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');
  assert(css.includes('.ota-banner'), 'Missing .ota-banner');
  assert(css.includes('.ota-banner.visible'), 'Missing .ota-banner.visible');
  assert(css.includes('.ota-progress-box'), 'Missing .ota-progress-box');
  assert(css.includes('.ota-progress-fill'), 'Missing .ota-progress-fill');
  assert(css.includes('.ota-btn'), 'Missing .ota-btn');
});

// 6. Preload and Main IPC Handlers Verification
it('preload.js and main.js wire OTA updater methods', () => {
  const mainCode = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  const preloadCode = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');

  assert(mainCode.includes('ipcMain.handle(\'check-for-updates\''), 'Missing check-for-updates in main.js');
  assert(mainCode.includes('ipcMain.handle(\'download-update\''), 'Missing download-update in main.js');
  assert(mainCode.includes('ipcMain.handle(\'install-update\''), 'Missing install-update in main.js');

  assert(preloadCode.includes('checkForUpdates:'), 'Missing checkForUpdates in preload.js');
  assert(preloadCode.includes('downloadUpdate:'), 'Missing downloadUpdate in preload.js');
  assert(preloadCode.includes('installUpdate:'), 'Missing installUpdate in preload.js');
  assert(preloadCode.includes('onUpdateAvailable:'), 'Missing onUpdateAvailable in preload.js');
  assert(preloadCode.includes('onUpdateProgress:'), 'Missing onUpdateProgress in preload.js');
});

// 7. Backend OTA Manifest Endpoints Verification
it('backend/server.js contains /api/updates/latest and /api/updates/publish', () => {
  const serverCode = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
  assert(serverCode.includes('/api/updates/latest'), 'Missing /api/updates/latest');
  assert(serverCode.includes('/api/updates/publish'), 'Missing /api/updates/publish');
  assert(serverCode.includes('/api/admin/stats'), 'Missing /api/admin/stats');
  assert(serverCode.includes('/api/devices'), 'Missing /api/devices');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
