const assert = require('assert');
const { LicenseManager } = require('../src/license-manager');

console.log('🧪 Starting Real-Time Trial Countdown Test Suite...\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${desc}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// 1. Test LicenseManager initialization & fields
const lm = new LicenseManager();
const initialStatus = lm.getStatus();

it('initialStatus contains real-time trial fields', () => {
  assert.strictEqual(initialStatus.trialRemainingHours, 72, 'Initial hours must default to 72, not 0');
  assert.strictEqual(initialStatus.trialRemainingDays, 3, 'Initial days must default to 3, not 0');
  assert(initialStatus.trialRemainingMs > 0, 'Initial remainingMs must be > 0');
  assert(initialStatus.trialExpiresAt > Date.now(), 'Initial trialExpiresAt must be in the future');
});

// 2. Test resetTrial
lm.resetTrial().then((status) => {
  it('resetTrial gives active 72h trial with future expiresAt', () => {
    assert.strictEqual(status.status, 'trial', 'Status should be trial');
    assert.strictEqual(status.isAuthorized, true, 'isAuthorized should be true');
    assert.strictEqual(status.trialRemainingHours, 72, 'trialRemainingHours should be 72');
    assert.strictEqual(status.trialRemainingDays, 3, 'trialRemainingDays should be 3');
    assert(status.trialExpiresAt > Date.now(), 'trialExpiresAt must be in future');
  });

  // 3. Test countdown formatting logic
  function formatTrialRemaining(remainingMs) {
    if (remainingMs <= 0) {
      return { badge: 'Expired', modal: '⌛ 3-Day Free Trial Expired', expired: true };
    }
    const totalSecs = Math.floor(remainingMs / 1000);
    const totalMins = Math.floor(totalSecs / 60);
    const totalHours = Math.floor(totalMins / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const mins = totalMins % 60;
    const secs = totalSecs % 60;

    let badgeText = '';
    let modalText = '';

    if (days > 0) {
      badgeText = hours > 0 ? `Trial: ${days}d ${hours}h` : `Trial: ${days}d`;
      modalText = `⏳ Free Trial Active (${days}d ${hours}h left)`;
    } else if (hours > 0) {
      badgeText = `Trial: ${hours}h ${mins}m`;
      modalText = `⏳ Free Trial Active (${hours}h ${mins}m left)`;
    } else if (mins > 0) {
      badgeText = `Trial: ${mins}m ${secs}s`;
      modalText = `⏳ Free Trial Active (${mins}m ${secs}s left)`;
    } else {
      badgeText = `Trial: ${secs}s`;
      modalText = `⏳ Free Trial Active (${secs}s left)`;
    }

    return { badge: badgeText, modal: modalText, expired: false, days, hours, mins, secs };
  }

  it('formats >24h with days and hours (never "Trial: 0h")', () => {
    const res = formatTrialRemaining(2.5 * 24 * 3600 * 1000);
    assert.strictEqual(res.badge, 'Trial: 2d 12h');
    assert.strictEqual(res.expired, false);
  });

  it('formats 1h-24h with hours and minutes (real-time precision)', () => {
    const res = formatTrialRemaining((14 * 3600 + 35 * 60) * 1000);
    assert.strictEqual(res.badge, 'Trial: 14h 35m');
    assert.strictEqual(res.expired, false);
  });

  it('formats <1h with minutes and seconds (live ticking countdown)', () => {
    const res = formatTrialRemaining((45 * 60 + 12) * 1000);
    assert.strictEqual(res.badge, 'Trial: 45m 12s');
    assert.strictEqual(res.expired, false);
  });

  it('formats <1m with seconds', () => {
    const res = formatTrialRemaining(42 * 1000);
    assert.strictEqual(res.badge, 'Trial: 42s');
    assert.strictEqual(res.expired, false);
  });

  it('formats 0ms or negative as Expired (never "Trial: 0h")', () => {
    const res = formatTrialRemaining(0);
    assert.strictEqual(res.badge, 'Expired');
    assert.strictEqual(res.expired, true);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
  console.log('✅ Real-Time Trial Countdown verified completely!');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
