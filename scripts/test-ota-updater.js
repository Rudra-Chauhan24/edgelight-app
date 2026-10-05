const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { AppUpdater } = require('../application/src/updater');

console.log('🧪 Testing Edge Light Version Update Notification System...\n');

const tests = [];

function it(desc, fn) {
  tests.push({ desc, fn });
}

const updater = new AppUpdater();

// 1. Semver Parsing
it('parseSemver parses standard and prefixed version strings', () => {
  assert.deepStrictEqual(updater.parseSemver('1.0.12'), [1, 0, 12]);
  assert.deepStrictEqual(updater.parseSemver('v1.0.13'), [1, 0, 13]);
  assert.deepStrictEqual(updater.parseSemver('2.0.0'), [2, 0, 0]);
  assert.deepStrictEqual(updater.parseSemver(''), [0, 0, 0]);
});

// 2. Semver Comparison
it('isNewerVersion compares versions correctly', () => {
  assert.strictEqual(updater.isNewerVersion('1.0.13', '1.0.12'), true);
  assert.strictEqual(updater.isNewerVersion('1.1.0', '1.0.12'), true);
  assert.strictEqual(updater.isNewerVersion('2.0.0', '1.0.12'), true);
  assert.strictEqual(updater.isNewerVersion('1.0.12', '1.0.12'), false);
  assert.strictEqual(updater.isNewerVersion('1.0.11', '1.0.12'), false);
});

// 3. Test Case 1: Installed version = latest version -> no update popup
it('Case 1: When installed version = latest released version, updateAvailable is false', async () => {
  const checkProbe = await new AppUpdater().checkForUpdates();
  const latestVer = checkProbe.latestVersion || '1.0.15';
  const currentUpdater = new AppUpdater({ currentVersion: latestVer });
  const checkResult = await currentUpdater.checkForUpdates();
  
  console.log(`     Installed: ${checkResult.currentVersion}, Latest: ${checkResult.latestVersion}`);
  console.log(`     Update Available: ${checkResult.updateAvailable}`);
  
  assert.strictEqual(checkResult.currentVersion, latestVer);
  assert.strictEqual(checkResult.latestVersion, latestVer);
  assert.strictEqual(checkResult.updateAvailable, false, 'Should NOT flag update when versions are equal');
});

// 4. Test Case 2: Installed version < latest version -> update popup appears with correct new version
it('Case 2: When installed version (1.0.11) < latest released version, updateAvailable is true', async () => {
  const olderUpdater = new AppUpdater({ currentVersion: '1.0.11' });
  const checkResult = await olderUpdater.checkForUpdates();
  
  console.log(`     Installed: ${checkResult.currentVersion}, Latest: ${checkResult.latestVersion}`);
  console.log(`     Update Available: ${checkResult.updateAvailable}`);
  console.log(`     Download URL: ${checkResult.downloadUrl}`);

  assert.strictEqual(checkResult.currentVersion, '1.0.11');
  assert.strictEqual(checkResult.updateAvailable, true, 'Should flag update when installed version is older');
  assert(checkResult.downloadUrl.includes(checkResult.latestVersion), 'Download URL must point to latest release');
  assert(checkResult.downloadUrl.endsWith('.exe'), 'Download URL must be executable installer');
});

// 5. Test Case 2 with future version simulation (e.g. installed 1.0.12 < future release 1.0.13)
it('Future version simulation: When remote release is 1.0.13, detects update dynamically without hardcoding', async () => {
  const simulatedUpdater = new AppUpdater({ currentVersion: '1.0.12' });
  simulatedUpdater.fetchJson = async () => ({
    tag_name: 'v1.0.13',
    published_at: new Date().toISOString(),
    body: 'New optical glow shaders and camera stability improvements',
    assets: [
      {
        name: 'Edge.Light.Setup.1.0.13.exe',
        browser_download_url: 'https://github.com/Rudra-Chauhan24/edgelight-app/releases/download/v1.0.13/Edge.Light.Setup.1.0.13.exe'
      }
    ]
  });

  const res = await simulatedUpdater.checkForUpdates();
  assert.strictEqual(res.updateAvailable, true);
  assert.strictEqual(res.latestVersion, '1.0.13');
  assert.strictEqual(res.downloadUrl, 'https://github.com/Rudra-Chauhan24/edgelight-app/releases/download/v1.0.13/Edge.Light.Setup.1.0.13.exe');
});

// 6. UI Elements & Layout Verification
it('index.html contains #ota-banner, version text, Update Now button, and Remind Later button', () => {
  const html = fs.readFileSync(path.join(__dirname, '../application/src/index.html'), 'utf8');
  assert(html.includes('id="ota-banner"'), 'Missing #ota-banner element');
  assert(html.includes('id="ota-version"'), 'Missing #ota-version element');
  assert(html.includes('id="ota-action-btn"'), 'Missing #ota-action-btn (Update Now)');
  assert(html.includes('id="ota-remind-btn"'), 'Missing #ota-remind-btn (Remind Later)');
  assert(html.includes('id="ota-close-btn"'), 'Missing #ota-close-btn (Dismiss)');
  assert(html.includes('Update Now'), 'Button text must say "Update Now"');
  assert(html.includes('Remind Later'), 'Button text must say "Remind Later"');
});

// 7. Styling Verification
it('style.css defines styles for .ota-banner, .visible state, .ota-remind-btn, and .ota-btn', () => {
  const css = fs.readFileSync(path.join(__dirname, '../application/src/style.css'), 'utf8');
  assert(css.includes('.ota-banner'), 'Missing .ota-banner in style.css');
  assert(css.includes('.ota-banner.visible'), 'Missing .ota-banner.visible state in style.css');
  assert(css.includes('.ota-remind-btn'), 'Missing .ota-remind-btn in style.css');
  assert(css.includes('.ota-btn'), 'Missing .ota-btn in style.css');
});

// 8. Renderer Logic Verification (Dismissal persistence & Remind Later)
it('renderer.js implements dismissal check and remind later handling', () => {
  const rendererCode = fs.readFileSync(path.join(__dirname, '../application/src/renderer.js'), 'utf8');
  assert(rendererCode.includes('isUpdateDismissed'), 'Missing isUpdateDismissed in renderer.js');
  assert(rendererCode.includes('markUpdateDismissed'), 'Missing markUpdateDismissed in renderer.js');
  assert(rendererCode.includes('otaRemindBtn'), 'Missing otaRemindBtn handler in renderer.js');
  assert(rendererCode.includes('dismissUpdateBanner'), 'Missing dismissUpdateBanner in renderer.js');
  assert(rendererCode.includes('otaCloseBtn?.addEventListener(\'click\', dismissUpdateBanner)'), 'Close button not wired to dismissUpdateBanner');
  assert(rendererCode.includes('otaRemindBtn?.addEventListener(\'click\', dismissUpdateBanner)'), 'Remind Later button not wired to dismissUpdateBanner');
});

// 9. Automatic Install & Direct Reopen Flow Verification
it('renderer.js automatically triggers installUpdate() and transitions to Reopening without requiring second click', () => {
  const rendererCode = fs.readFileSync(path.join(__dirname, '../application/src/renderer.js'), 'utf8');
  assert(rendererCode.includes('otaActionBtn.textContent = \'Reopening...\''), 'Missing Reopening status text');
  assert(rendererCode.includes('window.edgeLightAPI.installUpdate()'), 'Missing automatic installUpdate call');
});

// 10. Updater Helper Reopen Command Verification
it('updater.js installUpdate() launches silent NSIS setup and automatically relaunches Edge Light', () => {
  const updaterCode = fs.readFileSync(path.join(__dirname, '../application/src/updater.js'), 'utf8');
  assert(updaterCode.includes('/S'), 'Must run installer with /S silent flag');
  assert(updaterCode.includes('currentExe'), 'Must track current executable to reopen');
  assert(updaterCode.includes('start ""'), 'Must spawn restart command for Edge Light');
});

// 11. New Update Available Popup Elements Specification Verification
it('Popup clearly shows: New Update Available, Current version, New version, Short message, Update Now, Later', () => {
  const html = fs.readFileSync(path.join(__dirname, '../application/src/index.html'), 'utf8');
  assert(html.includes('New Update Available'), 'Popup missing "New Update Available" header');
  assert(html.includes('id="ota-current-version"'), 'Popup missing #ota-current-version element');
  assert(html.includes('id="ota-version"'), 'Popup missing #ota-version element');
  assert(html.includes('id="ota-message"'), 'Popup missing #ota-message element');
  assert(html.includes('Update Now'), 'Popup missing "Update Now" button');
  assert(html.includes('>Later</button>'), 'Popup missing "Later" button');
});

// 12. Session Duplicate Prevention
it('renderer.js enforces duplicate prevention during same session via sessionStorage', () => {
  const rendererCode = fs.readFileSync(path.join(__dirname, '../application/src/renderer.js'), 'utf8');
  assert(rendererCode.includes('sessionStorage.getItem(\'edgelight_dismissed_\''), 'Missing session dismissal check');
  assert(rendererCode.includes('sessionStorage.setItem(\'edgelight_dismissed_\''), 'Missing session dismissal write');
});

(async () => {
  let passed = 0;
  let failed = 0;

  for (const { desc, fn } of tests) {
    try {
      await fn();
      console.log('  ✓ ' + desc);
      passed++;
    } catch (err) {
      console.error('  ✗ ' + desc);
      console.error('    ' + err.message);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('✅ All OTA update notification tests passed successfully!');
})();
