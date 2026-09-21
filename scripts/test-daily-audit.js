const assert = require('assert');
const path = require('path');
const { LicenseManager } = require('../src/license-manager');

console.log('🧪 Testing Daily Randomized Firestore Audit & Auto-Revocation...\n');

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

// 1. Test Audit Schedule Interval Randomization (20h to 28h jitter)
it('Daily audit interval randomizes between 20 and 28 hours', () => {
  const minMs = 20 * 3600 * 1000;
  const maxMs = 28 * 3600 * 1000;

  for (let i = 0; i < 50; i++) {
    const minHours = 20;
    const maxHours = 28;
    const randomHours = minHours + Math.random() * (maxHours - minHours);
    const delayMs = Math.round(randomHours * 3600 * 1000);

    assert(delayMs >= minMs, `delayMs ${delayMs} should be >= ${minMs}`);
    assert(delayMs <= maxMs, `delayMs ${delayMs} should be <= ${maxMs}`);
  }
});

// 2. Test performDailyAudit with Mock Firestore
it('performDailyAudit updates local state when remote document exists', async () => {
  const lm = new LicenseManager();
  
  // Mock vault read/write
  let mockVaultData = {
    hwid: lm.hwidInfo.shortHwid,
    status: 'trial',
    planId: 'trial',
    firstLaunchTime: Date.now() - 3600000
  };
  lm.vault.read = () => mockVaultData;
  lm.vault.write = (d) => { mockVaultData = d; };

  // Mock firestore.getDocument returning approved license
  const expDate = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
  lm.firestore.isConfigured = () => true;
  lm.firestore.getDocument = async () => ({
    found: true,
    doc: {
      status: 'approved',
      planId: 'quarterly',
      planName: '3-Month Pass',
      licenseKey: 'EL-3MONTH-AUDIT-TEST',
      expiresAt: expDate
    }
  });
  lm.firestore.upsertDocument = async () => true;

  const result = await lm.performDailyAudit();
  assert.strictEqual(result.isAuthorized, true);
  assert.strictEqual(result.status, 'approved');
  assert.strictEqual(result.planId, 'quarterly');
  assert.strictEqual(mockVaultData.status, 'approved');
  assert.strictEqual(mockVaultData.licenseKey, 'EL-3MONTH-AUDIT-TEST');
  assert(mockVaultData.lastDailyCheck, 'lastDailyCheck should be recorded');
});

it('performDailyAudit auto-revokes local license when document is not found in Firestore', async () => {
  const lm = new LicenseManager();
  
  let mockVaultData = {
    hwid: lm.hwidInfo.shortHwid,
    status: 'approved',
    planId: 'lifetime',
    licenseKey: 'EL-LIFETIME-DELETE-TEST'
  };
  lm.vault.read = () => mockVaultData;
  lm.vault.write = (d) => { mockVaultData = d; };

  // Mock firestore returning notFound: true (admin deleted the record!)
  lm.firestore.isConfigured = () => true;
  lm.firestore.getDocument = async () => ({
    found: false,
    notFound: true
  });

  const result = await lm.performDailyAudit();
  assert.strictEqual(result.isAuthorized, false);
  assert.strictEqual(result.status, 'revoked');
  assert.strictEqual(mockVaultData.status, 'revoked');
  assert(result.message.includes('revoked or not found'));
});

// Run async tests
(async () => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
