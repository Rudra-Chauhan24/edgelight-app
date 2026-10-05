/**
 * Edge Light Single-Use Payment Claim Validation Suite
 * Specifically tests Cases A through G as defined in requirements:
 *
 * A. New valid Payment ID → claim succeeds.
 * B. Same Payment ID again → claim rejected ("This Payment ID has already been used.").
 * C. Same Payment ID from another device → claim rejected.
 * D. Invalid Payment ID → rejected.
 * E. Failed/unverified payment → no license activation.
 * F. Two simultaneous claims using the same Payment ID → only one succeeds.
 * G. Existing successfully claimed license → remains active normally.
 */

const assert = require('assert');
const { LicenseManager } = require('../src/license-manager');

async function runTests() {
  console.log('🧪 Starting Single-Use Payment Claim Validation Suite...\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
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

  // Clear in-memory / persistent registry before running test suite
  LicenseManager.clearClaimedRegistry();

  const lm1 = new LicenseManager();
  const hwid1 = lm1.getShortHWID();
  console.log(`  [Device 1 HWID: ${hwid1}]`);

  // ─────────────────────────────────────────────────────────────────
  // TEST A: New valid Payment ID → claim succeeds.
  // ─────────────────────────────────────────────────────────────────
  const validPaymentIdA = 'pay_test_valid_a_' + Date.now();
  await test('Case A: New valid Payment ID → claim succeeds', async () => {
    const res = await lm1.activateWithPaymentRef(validPaymentIdA, 'monthly');
    assert.strictEqual(res.success, true, 'Claim must succeed for new valid payment ID');
    assert.strictEqual(res.status, 'approved', 'Status must be approved');
    assert.strictEqual(res.licenseInfo.isAuthorized, true, 'License must be authorized');
    assert.strictEqual(res.licenseInfo.planId, 'monthly', 'Plan ID must match');
    assert.strictEqual(res.licenseInfo.paymentId, validPaymentIdA, 'Payment ID must be stored');
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST B: Same Payment ID again → claim rejected.
  // Message: "This Payment ID has already been used."
  // ─────────────────────────────────────────────────────────────────
  await test('Case B: Same Payment ID again on same device → claim rejected', async () => {
    const res = await lm1.activateWithPaymentRef(validPaymentIdA, 'monthly');
    assert.strictEqual(res.success, false, 'Must reject reused Payment ID');
    assert.strictEqual(
      res.error,
      'This Payment ID has already been used.',
      `Error must be exact "This Payment ID has already been used.", got: "${res.error}"`
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST C: Same Payment ID from another device → claim rejected.
  // ─────────────────────────────────────────────────────────────────
  await test('Case C: Same Payment ID from another device → claim rejected', async () => {
    // Simulate Device 2 with different HWID
    const lm2 = new LicenseManager();
    lm2.hwidInfo = {
      fullHash: 'DEVICE2_MOCK_HASH_' + Date.now(),
      shortHwid: 'DEV2-HWID',
      raw: 'device2'
    };

    const res = await lm2.activateWithPaymentRef(validPaymentIdA, 'quarterly');
    assert.strictEqual(res.success, false, 'Must reject Payment ID claimed on another device');
    assert.strictEqual(
      res.error,
      'This Payment ID has already been used.',
      `Error must be "This Payment ID has already been used.", got: "${res.error}"`
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST D: Invalid Payment ID → rejected.
  // ─────────────────────────────────────────────────────────────────
  await test('Case D: Invalid Payment ID (< 4 chars or empty) → rejected', async () => {
    const resEmpty = await lm1.activateWithPaymentRef('', 'monthly');
    assert.strictEqual(resEmpty.success, false, 'Empty Payment ID must be rejected');
    assert(resEmpty.error, 'Must provide an error message');

    const resShort = await lm1.activateWithPaymentRef('pay', 'monthly');
    assert.strictEqual(resShort.success, false, 'Short Payment ID (< 4 chars) must be rejected');
    assert(resShort.error, 'Must provide an error message');

    const resSpaces = await lm1.activateWithPaymentRef('    ', 'monthly');
    assert.strictEqual(resSpaces.success, false, 'Whitespace Payment ID must be rejected');
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST E: Failed/unverified payment → no license activation.
  // ─────────────────────────────────────────────────────────────────
  await test('Case E: Failed/unverified payment → no license activation & not marked as used', async () => {
    const failedPaymentId = 'pay_test_fail_' + Date.now();
    const res = await lm1.activateWithPaymentRef(failedPaymentId, 'monthly');
    assert.strictEqual(res.success, false, 'Failed payment must not activate license');
    assert(res.error.includes('failed') || res.error.includes('status'), 'Error must explain failure');

    // Requirement 5: Do NOT mark an ID as used when verification failed!
    assert.strictEqual(
      LicenseManager._claimedRegistry.has(failedPaymentId.toLowerCase()),
      false,
      'Failed payment must NOT be marked as claimed in registry'
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST F: Two simultaneous claims using the same Payment ID → only one succeeds.
  // ─────────────────────────────────────────────────────────────────
  await test('Case F: Two simultaneous claims using the same Payment ID → only one succeeds', async () => {
    const concurrentPaymentId = 'pay_test_concurrent_' + Date.now();

    const lmA = new LicenseManager();
    const lmB = new LicenseManager();
    lmB.hwidInfo = {
      fullHash: 'DEVICE_B_HASH_' + Date.now(),
      shortHwid: 'DEVB-HWID',
      raw: 'deviceB'
    };

    // Trigger both claims simultaneously
    const [resultA, resultB] = await Promise.all([
      lmA.activateWithPaymentRef(concurrentPaymentId, 'quarterly'),
      lmB.activateWithPaymentRef(concurrentPaymentId, 'quarterly')
    ]);

    const successes = [resultA, resultB].filter(r => r.success === true);
    const failures = [resultA, resultB].filter(r => r.success === false);

    assert.strictEqual(successes.length, 1, 'Exactly one claim must succeed');
    assert.strictEqual(failures.length, 1, 'Exactly one claim must fail');
    assert.strictEqual(
      failures[0].error,
      'This Payment ID has already been used.',
      `The rejected claim must have error "This Payment ID has already been used.", got: "${failures[0].error}"`
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST G: Existing successfully claimed license → remains active normally.
  // ─────────────────────────────────────────────────────────────────
  await test('Case G: Existing successfully claimed license → remains active normally', async () => {
    // lm1 successfully claimed validPaymentIdA earlier in Test A
    const statusBefore = lm1.getStatus();
    assert.strictEqual(statusBefore.isAuthorized, true, 'License must be active before attempt');
    assert.strictEqual(statusBefore.status, 'approved', 'Status must be approved');

    // Attempting to re-claim with the same payment ID or an invalid ID must NOT revoke or destroy existing license
    const reClaimRes = await lm1.activateWithPaymentRef(validPaymentIdA, 'monthly');
    assert.strictEqual(reClaimRes.success, false, 'Re-claim must fail');

    // Verify existing license is still active and unchanged
    const statusAfter = lm1.getStatus();
    assert.strictEqual(statusAfter.isAuthorized, true, 'License must remain authorized');
    assert.strictEqual(statusAfter.status, 'approved', 'Status must remain approved');
    assert.strictEqual(statusAfter.planId, 'monthly', 'Plan must remain monthly');
    assert.strictEqual(statusAfter.paymentId, validPaymentIdA, 'Payment ID must remain preserved');
  });

  // ─────────────────────────────────────────────────────────────────
  // TEST H: Plan Matching Enforcement
  // ─────────────────────────────────────────────────────────────────
  await test('Requirement 6: Plan matching enforcement', async () => {
    // Monthly test payment should activate monthly even if requested quarterly
    const monthlyPaymentId = 'pay_test_monthly_' + Date.now();
    const res = await lm1.activateWithPaymentRef(monthlyPaymentId, 'lifetime');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.licenseInfo.planId, 'monthly', 'Plan must be enforced as monthly based on payment');
    assert.strictEqual(res.licenseInfo.planName, 'Monthly Pass');
  });

  console.log(`\n========================================`);
  console.log(`Single-Use Claim Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error in single-use claim suite:', err);
  process.exit(1);
});
