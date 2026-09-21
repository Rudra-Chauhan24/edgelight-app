const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { LicenseManager } = require('../src/license-manager');

console.log('🧪 Testing Full Flow of Purchase License & Plan Assignment...\n');

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

// 1. Test Plan Calculation Logic matching backend/server.js
function calculatePlanDetails(planId) {
  const normalized = (planId || 'quarterly').toLowerCase();
  const now = Date.now();
  if (normalized === 'monthly') {
    return {
      planId: 'monthly',
      planName: 'Monthly Pass',
      expiresAt: new Date(now + 30 * 24 * 3600 * 1000).toISOString(),
      licenseKey: 'EL-MONTHLY-' + crypto.randomBytes(3).toString('hex').toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase()
    };
  } else if (normalized === 'lifetime') {
    return {
      planId: 'lifetime',
      planName: 'Lifetime Pro',
      expiresAt: null, // Permanent
      licenseKey: 'EL-LIFETIME-' + crypto.randomBytes(3).toString('hex').toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase()
    };
  } else {
    return {
      planId: 'quarterly',
      planName: '3-Month Pass',
      expiresAt: new Date(now + 90 * 24 * 3600 * 1000).toISOString(),
      licenseKey: 'EL-3MONTH-' + crypto.randomBytes(3).toString('hex').toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase()
    };
  }
}

// Tests
it('Monthly pass calculates 30-day expiration date', () => {
  const plan = calculatePlanDetails('monthly');
  assert.strictEqual(plan.planId, 'monthly');
  assert.strictEqual(plan.planName, 'Monthly Pass');
  assert(plan.expiresAt, 'expiresAt should be set');
  const exp = new Date(plan.expiresAt).getTime();
  const diffDays = Math.round((exp - Date.now()) / (24 * 3600 * 1000));
  assert.strictEqual(diffDays, 30);
  assert(plan.licenseKey.startsWith('EL-MONTHLY-'));
});

it('Quarterly pass calculates 90-day expiration date', () => {
  const plan = calculatePlanDetails('quarterly');
  assert.strictEqual(plan.planId, 'quarterly');
  assert.strictEqual(plan.planName, '3-Month Pass');
  const exp = new Date(plan.expiresAt).getTime();
  const diffDays = Math.round((exp - Date.now()) / (24 * 3600 * 1000));
  assert.strictEqual(diffDays, 90);
  assert(plan.licenseKey.startsWith('EL-3MONTH-'));
});

it('Lifetime Pro plan has permanent authorization (null expiresAt)', () => {
  const plan = calculatePlanDetails('lifetime');
  assert.strictEqual(plan.planId, 'lifetime');
  assert.strictEqual(plan.planName, 'Lifetime Pro');
  assert.strictEqual(plan.expiresAt, null);
  assert(plan.licenseKey.startsWith('EL-LIFETIME-'));
});

// 2. Test LicenseManager._evaluate with various plan states
const lm = new LicenseManager();

it('LicenseManager evaluates active Monthly Pass correctly', () => {
  const activeExp = new Date(Date.now() + 25 * 24 * 3600 * 1000).toISOString();
  const evalResult = lm._evaluate({
    status: 'approved',
    planId: 'monthly',
    planName: 'Monthly Pass',
    licenseKey: 'EL-MONTHLY-TEST-1234',
    expiresAt: activeExp
  });

  assert.strictEqual(evalResult.isAuthorized, true);
  assert.strictEqual(evalResult.status, 'approved');
  assert.strictEqual(evalResult.planId, 'monthly');
  assert.strictEqual(evalResult.planName, 'Monthly Pass');
  assert.strictEqual(evalResult.trialRemainingDays, 25);
  assert(evalResult.message.includes('Commercial License Active (Monthly Pass'));
});

it('LicenseManager evaluates expired Monthly Pass as unauthorized', () => {
  const pastExp = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const evalResult = lm._evaluate({
    status: 'approved',
    planId: 'monthly',
    planName: 'Monthly Pass',
    licenseKey: 'EL-MONTHLY-TEST-1234',
    expiresAt: pastExp
  });

  assert.strictEqual(evalResult.isAuthorized, false);
  assert.strictEqual(evalResult.status, 'expired');
  assert(evalResult.message.includes('Pass Expired'));
});

it('LicenseManager evaluates Lifetime Pro as permanent authorization', () => {
  const evalResult = lm._evaluate({
    status: 'approved',
    planId: 'lifetime',
    planName: 'Lifetime Pro',
    licenseKey: 'EL-LIFETIME-TEST-9999',
    expiresAt: null
  });

  assert.strictEqual(evalResult.isAuthorized, true);
  assert.strictEqual(evalResult.status, 'approved');
  assert.strictEqual(evalResult.trialRemainingDays, 9999);
  assert(evalResult.message.includes('Lifetime Pro'));
});

it('LicenseManager evaluates revoked license as unauthorized', () => {
  const evalResult = lm._evaluate({
    status: 'revoked',
    planId: 'lifetime'
  });

  assert.strictEqual(evalResult.isAuthorized, false);
  assert.strictEqual(evalResult.status, 'revoked');
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
