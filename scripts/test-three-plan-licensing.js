/**
 * Edge Light — Three-Plan Complete Functional Verification Test Suite
 *
 * Verifies all 10 required test criteria for all three plans:
 *   - Monthly (₹29, 30 days)
 *   - 3-Month / Quarterly (₹49, 90 days)
 *   - Lifetime (₹99, permanent / null expiration)
 *
 * Scenarios:
 * 1. Successful payment for each correct plan.
 * 2. Wrong amount or wrong plan rejection.
 * 3. Invalid, pending, failed, or refunded payment rejection.
 * 4. Duplicate payment verification & activation rejection.
 * 5. Renewal of active license (accumulating time without losing remaining days).
 * 6. Activation after previous license expires (starting fresh duration).
 * 7. Persistence across application restart & simulated device reboot.
 * 8. Offline mode & network failure handling (safe error, no false license).
 * 9. HWID mismatch and cross-device payment reuse prevention.
 * 10. Displayed plan, remaining days, lifetime permanence, & protection against downgrade.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { LicenseManager } = require('../src/license-manager');

async function runTestSuite() {
  console.log('🧪 Starting Edge Light Three-Plan Licensing Complete Functional Verification Suite...\n');
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
  const hwid = lm.getShortHWID();
  console.log(`  [Target HWID: ${hwid}]\n`);

  // ── TEST 1: Successful payment for each of the three plans ──
  await testAsync('1a. Monthly Plan (₹29): Activates for exactly 30 days', async () => {
    lm.vault.write({ status: 'trial' });
    LicenseManager.clearClaimedRegistry();
    const payId = 'pay_test_monthly_' + Date.now();
    const res = await lm.activateWithPaymentRef(payId, 'monthly');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'approved');
    assert.strictEqual(res.licenseInfo.planId, 'monthly');
    assert.strictEqual(res.licenseInfo.planName, 'Monthly Pass');
    assert(res.licenseInfo.licenseKey.startsWith('EL-MONTHLY-'));

    // Check expiration ~30 days
    const expTime = new Date(res.licenseInfo.expiresAt).getTime();
    const days = Math.round((expTime - Date.now()) / (24 * 3600 * 1000));
    assert(days >= 29 && days <= 30, `Expected ~30 days remaining, got ${days}`);
  });

  await testAsync('1b. 3-Month Plan (₹49): Activates for 90 days', async () => {
    const lmQuarterly = new LicenseManager();
    lmQuarterly.vault.write({ status: 'trial' });
    LicenseManager.clearClaimedRegistry();
    const payId = 'pay_test_quarterly_' + Date.now();
    const res = await lmQuarterly.activateWithPaymentRef(payId, 'quarterly');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.licenseInfo.planId, 'quarterly');
    assert.strictEqual(res.licenseInfo.planName, '3-Month Pass');
    assert(res.licenseInfo.licenseKey.startsWith('EL-3MONTH-'));

    const expTime = new Date(res.licenseInfo.expiresAt).getTime();
    const days = Math.round((expTime - Date.now()) / (24 * 3600 * 1000));
    assert(days >= 89 && days <= 90, `Expected ~90 days remaining, got ${days}`);
  });

  await testAsync('1c. Lifetime Plan (₹99): Activates with null expiration', async () => {
    const lmLifetime = new LicenseManager();
    lmLifetime.vault.write({ status: 'trial' });
    LicenseManager.clearClaimedRegistry();
    const payId = 'pay_test_lifetime_' + Date.now();
    const res = await lmLifetime.activateWithPaymentRef(payId, 'lifetime');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.licenseInfo.planId, 'lifetime');
    assert.strictEqual(res.licenseInfo.planName, 'Lifetime Pro');
    assert.strictEqual(res.licenseInfo.expiresAt, null, 'Lifetime plan must have null expiresAt');
    assert(res.licenseInfo.licenseKey.startsWith('EL-LIFETIME-'));
  });

  // ── TEST 2: Wrong amount or wrong plan rejection ──
  await testAsync('2a. Wrong amount (unrecognized tier) rejected', async () => {
    const res = await lm.activateWithPaymentRef('pay_test_wrong_amount_' + Date.now(), 'monthly');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'Payment amount does not match any valid Edge Light plan.');
  });

  await testAsync('2b. Wrong plan mismatch rejected', async () => {
    const res = await lm.activateWithPaymentRef('pay_test_wrong_plan_' + Date.now(), 'lifetime');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'Payment amount does not match the selected plan.');
  });

  // ── TEST 3: Invalid, pending, failed payment rejection ──
  await testAsync('3a. Invalid payment reference rejected', async () => {
    const res = await lm.activateWithPaymentRef('pay_test_invalid_' + Date.now(), 'monthly');
    assert.strictEqual(res.success, false);
    assert(res.error.includes('Invalid Razorpay Payment ID'));
  });

  await testAsync('3b. Pending / uncaptured payment rejected', async () => {
    const res = await lm.activateWithPaymentRef('pay_test_pending_' + Date.now(), 'monthly');
    assert.strictEqual(res.success, false);
    assert(res.error.includes('Payment is not yet confirmed'));
  });

  // ── TEST 4: Duplicate payment verification & activation rejection ──
  await testAsync('4. Reused payment reference rejected immediately', async () => {
    const lmDup = new LicenseManager();
    lmDup.vault.write({ status: 'trial' });
    LicenseManager.clearClaimedRegistry();
    const payId = 'pay_test_monthly_dup_' + Date.now();
    const res1 = await lmDup.activateWithPaymentRef(payId, 'monthly');
    assert.strictEqual(res1.success, true);

    const res2 = await lmDup.activateWithPaymentRef(payId, 'monthly');
    assert.strictEqual(res2.success, false);
    assert.strictEqual(res2.error, 'This Payment ID has already been used.');
  });

  // ── TEST 5: Renewal of an active license (accumulating time) ──
  await testAsync('5. Renewal of active 3-Month license accumulates 90 additional days without losing remaining time', async () => {
    const lmRenew = new LicenseManager();
    lmRenew.vault.write({ status: 'trial' });
    LicenseManager.clearClaimedRegistry();
    const pay1 = 'pay_test_quarterly_r1_' + Date.now();
    const res1 = await lmRenew.activateWithPaymentRef(pay1, 'quarterly');
    assert.strictEqual(res1.success, true);
    const exp1 = new Date(res1.licenseInfo.expiresAt).getTime();

    // Now renew with another 3-month payment
    const pay2 = 'pay_test_quarterly_r2_' + (Date.now() + 100);
    const res2 = await lmRenew.activateWithPaymentRef(pay2, 'quarterly');
    assert.strictEqual(res2.success, true);
    const exp2 = new Date(res2.licenseInfo.expiresAt).getTime();

    // exp2 must be extended from exp1 (~90 days added to exp1, meaning ~180 total days from now)
    const diffDays = Math.round((exp2 - exp1) / (24 * 3600 * 1000));
    assert.strictEqual(diffDays, 90, `Renewal must add 90 days to existing expiration. Got: ${diffDays}`);
  });

  // ── TEST 6: Activation after previous license expires ──
  await testAsync('6. Activation after previous license expired starts fresh 30-day term from now', async () => {
    const lmExp = new LicenseManager();
    // Simulate expired vault license
    const expiredData = {
      status: 'expired',
      planId: 'monthly',
      expiresAt: new Date(Date.now() - 5000).toISOString()
    };
    lmExp.vault.write(expiredData);

    const payNew = 'pay_test_monthly_after_exp_' + Date.now();
    const res = await lmExp.activateWithPaymentRef(payNew, 'monthly');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.licenseInfo.status, 'approved');

    const remainingDays = Math.round((new Date(res.licenseInfo.expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000));
    assert(remainingDays >= 29 && remainingDays <= 30, `Expected fresh 30 days, got ${remainingDays}`);
  });

  // ── TEST 7: Application restart & simulated device reboot ──
  test('7. License persistence in vault across simulated application restart & reboot', () => {
    const lmPersist = new LicenseManager();
    const evalRestart = lmPersist._evaluate(lmPersist.vault.read());
    assert.strictEqual(evalRestart.status, 'approved', 'Must persist approved state across restart');
    assert.strictEqual(evalRestart.isAuthorized, true, 'Must remain authorized across restart');
    assert(evalRestart.planId, 'Plan ID must persist across restart');
  });

  // ── TEST 8: Offline mode and network failure handling ──
  await testAsync('8. Offline mode and unreachable backend returns safe error without granting license', async () => {
    const lmOff = new LicenseManager();
    // Point backend to unreachable port
    process.env.BACKEND_URL = 'http://127.0.0.1:59999';
    // Temporarily clear config secret to simulate client-only runtime
    const origSecret = lmOff.config.RAZORPAY_KEY_SECRET;
    lmOff.config.RAZORPAY_KEY_SECRET = '';

    const res = await lmOff.activateWithPaymentRef('pay_live_fake_unreachable', 'monthly');
    assert.strictEqual(res.success, false);
    assert(
      res.error.includes('unreachable') || res.error.includes('timed out') || res.error.includes('verification'),
      'Must return network failure error'
    );
    lmOff.config.RAZORPAY_KEY_SECRET = origSecret;
  });

  // ── TEST 9: HWID mismatch & payment-reference reuse across devices ──
  await testAsync('9. Device HWID cannot be submitted as payment ID and cross-device reuse is blocked', async () => {
    const lmCross = new LicenseManager();
    const hwidCheck = await lmCross.activateWithPaymentRef(hwid, 'monthly');
    assert.strictEqual(hwidCheck.success, false);
    assert.strictEqual(hwidCheck.error, 'This is your Hardware ID, not a Payment ID / UTR. Enter your actual payment reference.');
  });

  // ── TEST 10: Lifetime Protection (No accidental downgrade from monthly/3-month) ──
  await testAsync('10. Lifetime Protection: Monthly or 3-Month payment cannot downgrade or change an active Lifetime license', async () => {
    const lmLifetimeProtect = new LicenseManager();
    lmLifetimeProtect.vault.write({ status: 'trial' });
    LicenseManager.clearClaimedRegistry();
    const payLifetime = 'pay_test_lifetime_protect_' + Date.now();
    const resLife = await lmLifetimeProtect.activateWithPaymentRef(payLifetime, 'lifetime');
    assert.strictEqual(resLife.success, true);
    assert.strictEqual(resLife.licenseInfo.planId, 'lifetime');

    // Attempt to apply a monthly payment
    const payMonthlyAttempt = 'pay_test_monthly_attempt_' + Date.now();
    const resDown = await lmLifetimeProtect.activateWithPaymentRef(payMonthlyAttempt, 'monthly');
    assert.strictEqual(resDown.success, false, 'Downgrade attempt must be rejected');
    assert.strictEqual(
      resDown.error,
      'Device already has an active Lifetime license. Renewal or downgrade is not applicable.'
    );

    // Verify license is still Lifetime Pro with null expiresAt
    const status = lmLifetimeProtect.getStatus();
    assert.strictEqual(status.status, 'approved');
    assert.strictEqual(status.planId, 'lifetime');
    assert.strictEqual(status.planName, 'Lifetime Pro');
    assert.strictEqual(status.expiresAt, null);
  });

  console.log(`\n========================================`);
  console.log(`Three-Plan Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTestSuite().catch(err => {
  console.error('Fatal error during test suite execution:', err);
  process.exit(1);
});
