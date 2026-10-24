/**
 * Edge Light — Test Suite for Hardware ID Copy/Paste Bug & Payment Validation
 *
 * Verifies:
 * 1. Submitting device HWID as Payment ID / UTR is strictly rejected with the expected message.
 * 2. Random invalid transaction reference does not activate the license.
 * 3. Valid payment reference for completed transaction activates only after trusted verification.
 * 4. Pending, failed, or unverified transaction reference does not activate the license.
 * 5. Copy button logic correctly extracts and copies the HWID without populating the payment input.
 * 6. Existing plans and active license display logic still work properly.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { LicenseManager } = require('../src/license-manager');

async function runTestSuite() {
  console.log('🧪 Starting Edge Light HWID Copy/Paste Bug & Payment Validation Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✕ ${name}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✕ ${name}`);
      console.error(`    Error: ${err.message}`);
      failed++;
    }
  }

  const lm = new LicenseManager();
  lm.vault.write({ status: 'trial' });
  LicenseManager.clearClaimedRegistry();
  const hwid = lm.getShortHWID();
  assert(hwid && hwid.length >= 8, 'HWID must exist');
  console.log(`  [Device HWID: ${hwid}]`);

  // ── Test 1: Copy HWID and submit as Payment ID / UTR must be rejected ──
  await testAsync('Case 1a: Submitting exact short HWID as Payment ID is rejected', async () => {
    const res = await lm.activateWithPaymentRef(hwid, 'quarterly');
    assert.strictEqual(res.success, false, 'Must not activate for device HWID');
    assert.strictEqual(
      res.error,
      'This is your Hardware ID, not a Payment ID / UTR. Enter your actual payment reference.'
    );
  });

  await testAsync('Case 1b: Submitting HWID with whitespace/lowercase is rejected', async () => {
    const padded = `   ${hwid.toLowerCase()}   `;
    const res = await lm.activateWithPaymentRef(padded, 'monthly');
    assert.strictEqual(res.success, false, 'Must reject padded/lowercase HWID');
    assert.strictEqual(
      res.error,
      'This is your Hardware ID, not a Payment ID / UTR. Enter your actual payment reference.'
    );
  });

  await testAsync('Case 1c: Submitting another device format HWID (XXXX-XXXX-XXXX-XXXX) is rejected', async () => {
    const fakeHwid = '1234-ABCD-5678-EF90';
    const res = await lm.activateWithPaymentRef(fakeHwid, 'quarterly');
    assert.strictEqual(res.success, false, 'Must reject HWID formatted reference');
    assert.strictEqual(
      res.error,
      'This is your Hardware ID, not a Payment ID / UTR. Enter your actual payment reference.'
    );
  });

  // ── Test 2: Enter a random invalid transaction reference ──
  await testAsync('Case 2: Random invalid transaction reference does not activate license', async () => {
    const randomRef = 'random_gibberish_ref_' + Date.now();
    const res = await lm.activateWithPaymentRef(randomRef, 'quarterly');
    assert.strictEqual(res.success, false, 'Random reference must not activate license');
    assert(res.error, 'Must provide an error message');
  });

  // ── Test 3: Valid payment reference for completed transaction activates ──
  await testAsync('Case 3: Valid payment reference for completed transaction activates correctly', async () => {
    const validRef = 'pay_test_valid_hwid_suite_' + Date.now();
    const res = await lm.activateWithPaymentRef(validRef, 'quarterly');
    assert.strictEqual(res.success, true, 'Valid payment ref should succeed');
    assert.strictEqual(res.status, 'approved', 'Status should be approved');
    assert(res.licenseInfo, 'License info must be returned');
    assert.strictEqual(res.licenseInfo.planId, 'quarterly', 'Plan must be quarterly');
    assert.strictEqual(res.licenseInfo.hwid, hwid, 'HWID must match machine HWID');
  });

  // ── Test 4: Pending, failed, or unverified transaction reference ──
  await testAsync('Case 4a: Failed payment reference is rejected and does not activate', async () => {
    const failedRef = 'pay_test_fail_' + Date.now();
    const res = await lm.activateWithPaymentRef(failedRef, 'monthly');
    assert.strictEqual(res.success, false, 'Failed payment must be rejected');
    assert(
      res.error.includes('Invalid Razorpay Payment ID') ||
      res.error.includes('failed') ||
      res.error.includes('gateway'),
      'Must indicate payment failure'
    );
  });

  await testAsync('Case 4b: Pending/unverified payment reference is rejected and does not activate', async () => {
    const pendingRef = 'pay_test_pending_' + Date.now();
    const res = await lm.activateWithPaymentRef(pendingRef, 'monthly');
    assert.strictEqual(res.success, false, 'Pending payment must be rejected');
  });

  // ── Test 5: Verify Copy button logic ──
  test('Case 5: Copy button logic copies HWID and does not auto-populate payment input', () => {
    const rendererCode = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
    // Ensure copyHwidBtn listener does not write to licenseManualInput
    const copyBlock = rendererCode.slice(
      rendererCode.indexOf("copyHwidBtn?.addEventListener('click'"),
      rendererCode.indexOf("copyHwidBtn?.addEventListener('click'") + 400
    );
    assert(!copyBlock.includes('licenseManualInput'), 'Copy HWID button must not populate licenseManualInput');
    assert(copyBlock.includes('copyHWID') || copyBlock.includes('clipboard'), 'Copy HWID button must use clipboard API');
  });

  // ── Test 6: Verify plans & active license display ──
  test('Case 6: Plans configuration and active license display retain all tiers', () => {
    const htmlCode = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
    assert(htmlCode.includes('data-plan="monthly"'), 'Monthly plan button must exist');
    assert(htmlCode.includes('data-plan="quarterly"'), 'Quarterly plan button must exist');
    assert(htmlCode.includes('data-plan="lifetime"'), 'Lifetime plan button must exist');
    assert(htmlCode.includes('licenseManualInput'), 'licenseManualInput must exist');
    assert(htmlCode.includes('licenseManualBtn'), 'licenseManualBtn must exist');
    assert(htmlCode.includes('licenseManualFeedback'), 'licenseManualFeedback must exist');
  });

  // ── Test 7: Frontend validation logic rejection verification ──
  test('Case 7: Frontend handleManualActivation rejects HWID before making API call', () => {
    const rendererCode = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
    assert(rendererCode.includes('isHwidMatch'), 'Renderer must include isHwidMatch check');
    assert(rendererCode.includes('This is your Hardware ID, not a Payment ID / UTR.'), 'Renderer must display HWID guidance message');
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal error during test suite execution:', err);
  process.exit(1);
});
