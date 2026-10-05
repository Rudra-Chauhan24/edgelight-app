const fs = require('fs');
const path = require('path');
const { LicenseManager } = require('../src/license-manager');

async function runTests() {
  console.log('🧪 Starting Setup Wizard & Razorpay Plans Test Suite...\n');
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

  // 1. Test Payment Config in LicenseManager
  const lm = new LicenseManager();
  const cfg = lm.getPaymentConfig();
  assert(cfg !== null && typeof cfg === 'object', 'getPaymentConfig() returns an object');
  const p = cfg.plansById || cfg.plans;
  assert(p && p.monthly && p.quarterly && p.lifetime, 'All 3 plans (monthly, quarterly, lifetime) are configured');
  assert(p.monthly.price <= 100, `Monthly plan is under ₹100 (₹${p.monthly.price})`);
  assert(p.quarterly.price <= 100, `Quarterly plan is under ₹100 (₹${p.quarterly.price})`);
  assert(p.lifetime.price <= 100, `Lifetime plan is under ₹100 (₹${p.lifetime.price})`);
  assert(typeof p.monthly.link === 'string' && p.monthly.link.includes('http'), 'Monthly payment link configured');
  assert(typeof p.quarterly.link === 'string' && p.quarterly.link.includes('http'), 'Quarterly payment link configured');
  assert(typeof p.lifetime.link === 'string' && p.lifetime.link.includes('http'), 'Lifetime payment link configured');
  assert(Boolean(cfg.upiId), `UPI ID configured (${cfg.upiId})`);

  // 2. Test index.html markup
  const htmlContent = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  assert(htmlContent.includes('id="setup-wizard-modal"'), 'index.html contains #setup-wizard-modal');
  assert(htmlContent.includes('id="wizardStep1"') && htmlContent.includes('id="wizardStep2"') && htmlContent.includes('id="wizardStep3"') && htmlContent.includes('id="wizardStep4"'), 'All 4 wizard step panes exist in index.html');
  assert(htmlContent.includes('id="razorpayDirectBtn"'), 'Razorpay direct buying button exists');
  assert(htmlContent.includes('id="upiQrImg"'), 'UPI QR code image element exists');
  assert(htmlContent.includes('id="licenseQuickPayBtn"'), 'Instant Razorpay pay button exists in license modal');
  assert(htmlContent.includes('data-plan-id="monthly"') && htmlContent.includes('data-plan-id="quarterly"') && htmlContent.includes('data-plan-id="lifetime"'), 'Plan cards for all 3 sub-₹100 tiers exist');

  // 3. Test preload.js bridge
  const preloadContent = fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8');
  assert(preloadContent.includes('getPaymentConfig'), 'preload.js exposes getPaymentConfig');
  assert(preloadContent.includes('openExternal'), 'preload.js exposes openExternal');
  assert(preloadContent.includes('onShowSetupWizard'), 'preload.js exposes onShowSetupWizard');

  // 4. Test main.js IPC and Tray
  const mainContent = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert(mainContent.includes("ipcMain.handle('get-payment-config'"), 'main.js handles get-payment-config');
  assert(mainContent.includes("ipcMain.handle('open-external'"), 'main.js handles open-external');
  assert(mainContent.includes('Setup Wizard & Plans…'), 'main.js includes Setup Wizard & Plans in tray menu');

  // 5. Test renderer.js logic
  const rendererContent = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
  assert(rendererContent.includes('showSetupWizard'), 'renderer.js implements showSetupWizard');
  assert(rendererContent.includes('edgelight_setup_completed_v1'), 'renderer.js checks setup completion key for first run');
  assert(rendererContent.includes('razorpayDirectBtn'), 'renderer.js attaches Razorpay direct link handler');
  assert(rendererContent.includes('upi://pay'), 'renderer.js dynamically constructs UPI payment payload for QR code');

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
