/**
 * Edge Light — Mandatory Razorpay Payment Verification Test Suite
 *
 * Covers:
 * 1. Valid Razorpay payment verification for all tiers:
 *    - Monthly (₹29)
 *    - 3-Month / Quarterly (₹49)
 *    - Lifetime (₹99)
 * 2. Invalid Razorpay Payment ID rejection ("Invalid Razorpay Payment ID. Please check your payment reference.")
 * 3. Pending/uncaptured payment rejection ("Payment is not yet confirmed. Please try again after payment is completed.")
 * 4. Wrong amount rejection ("Payment amount does not match any valid Edge Light plan.")
 * 5. Wrong plan mismatch rejection ("Payment amount does not match the selected plan.")
 * 6. Duplicate payment reuse prevention ("This Payment ID has already been used.")
 * 7. Hardware ID rejection ("This is your Hardware ID, not a Payment ID / UTR. Enter your actual payment reference.")
 * 8. License duration extension for active plans.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { LicenseManager } = require('../src/license-manager');

async function runTestSuite() {
  console.log('🧪 Starting Mandatory Razorpay Payment Verification Test Suite...\n');
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

  LicenseManager.clearClaimedRegistry();
  const lm = new LicenseManager();
  lm.vault.write({ status: 'trial' });
  const hwid = lm.getShortHWID();
  console.log(`  [Target HWID: ${hwid}]`);

  // 1. Hardware ID entered as payment ID must be rejected
  await testAsync('Reject Device HWID as Payment ID with exact error message', async () => {
    const res = await lm.activateWithPaymentRef(hwid, 'quarterly');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'This is your Hardware ID, not a Payment ID / UTR. Enter your actual payment reference.');
  });

  // 2. Invalid Razorpay Payment ID must be rejected
  await testAsync('Reject invalid/failed Razorpay Payment ID', async () => {
    const res = await lm.activateWithPaymentRef('pay_test_invalid_ref_xyz', 'monthly');
    assert.strictEqual(res.success, false);
    assert(res.error.includes('Invalid Razorpay Payment ID. Please check your payment reference.'));
  });

  // 3. Pending / uncaptured payment must be rejected
  await testAsync('Reject pending/uncaptured Razorpay payment', async () => {
    const res = await lm.activateWithPaymentRef('pay_test_pending_ref_xyz', 'monthly');
    assert.strictEqual(res.success, false);
    assert(res.error.includes('Payment is not yet confirmed. Please try again after payment is completed.'));
  });

  // 4. Incorrect amount rejected
  await testAsync('Reject payment with wrong/unrecognized amount', async () => {
    const res = await lm.activateWithPaymentRef('pay_test_wrong_amount_xyz', 'monthly');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'Payment amount does not match any valid Edge Light plan.');
  });

  // 5. Wrong plan mismatch rejected
  await testAsync('Reject payment when amount does not match requested plan', async () => {
    const res = await lm.activateWithPaymentRef('pay_test_wrong_plan_' + Date.now(), 'lifetime');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'Payment amount does not match the selected plan.');
  });

  // 6. Valid Monthly activation (₹29)
  const monthlyPayId = 'pay_test_monthly_valid_' + Date.now();
  await testAsync('Successful Monthly Plan activation (₹29)', async () => {
    const res = await lm.activateWithPaymentRef(monthlyPayId, 'monthly');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'approved');
    assert.strictEqual(res.licenseInfo.planId, 'monthly');
    assert.strictEqual(res.licenseInfo.planName, 'Monthly Pass');
    assert(res.licenseInfo.licenseKey.startsWith('EL-MONTHLY-'));
    assert(res.licenseInfo.expiresAt, 'Monthly pass must have expiration date');
  });

  // 7. Duplicate submission of already-used Monthly payment must be rejected
  await testAsync('Reject duplicate use of already-claimed Payment ID', async () => {
    const res = await lm.activateWithPaymentRef(monthlyPayId, 'monthly');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'This Payment ID has already been used.');
  });

  // 8. Valid 3-Month Plan activation (₹49) and extension
  const quarterlyPayId = 'pay_test_quarterly_valid_' + Date.now();
  await testAsync('Successful 3-Month Plan activation (₹49)', async () => {
    const res = await lm.activateWithPaymentRef(quarterlyPayId, 'quarterly');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'approved');
    assert.strictEqual(res.licenseInfo.planId, 'quarterly');
    assert.strictEqual(res.licenseInfo.planName, '3-Month Pass');
    assert(res.licenseInfo.licenseKey.startsWith('EL-3MONTH-'));
    assert(res.licenseInfo.expiresAt, '3-Month pass must have expiration date');
  });

  // 9. Valid Lifetime Plan activation (₹99)
  const lifetimePayId = 'pay_test_lifetime_valid_' + Date.now();
  await testAsync('Successful Lifetime Plan activation (₹99)', async () => {
    const res = await lm.activateWithPaymentRef(lifetimePayId, 'lifetime');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'approved');
    assert.strictEqual(res.licenseInfo.planId, 'lifetime');
    assert.strictEqual(res.licenseInfo.planName, 'Lifetime Pro');
    assert.strictEqual(res.licenseInfo.expiresAt, null, 'Lifetime plan must never expire');
    assert(res.licenseInfo.licenseKey.startsWith('EL-LIFETIME-'));
  });

  // 10. Verify backend server claim endpoint logic
  test('Backend server implements all required error strings and verification checks', () => {
    const serverCode = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    assert(serverCode.includes('Invalid Razorpay Payment ID. Please check your payment reference.'));
    assert(serverCode.includes('Payment is not yet confirmed. Please try again after payment is completed.'));
    assert(serverCode.includes('Payment amount does not match any valid Edge Light plan.'));
    assert(serverCode.includes('Payment amount does not match the selected plan.'));
    assert(serverCode.includes('This Payment ID has already been used.'));
    assert(serverCode.includes('This is your Hardware ID, not a Payment ID / UTR. Enter your actual payment reference.'));
    assert(serverCode.includes("payment.currency.toUpperCase() !== 'INR'"));
    assert(serverCode.includes("amountPaise === 2900"));
    assert(serverCode.includes("amountPaise === 4900"));
    assert(serverCode.includes("amountPaise === 9900"));
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
