/**
 * Edge Light — Firebase Backend Device Tracking & Unique Count Test Suite
 *
 * Verifies:
 * 1. New Hardware ID → one Firebase user/device record.
 * 2. Same Hardware ID reopened → updates existing record, no duplicate.
 * 3. Same Hardware ID after app update → same record, updated version.
 * 4. Multiple launches (e.g. 100 times) → still ONE unique user/device.
 * 5. Offline app → Edge Light continues working normally without blocking.
 * 6. Firebase unavailable / 403 / error → Edge Light continues working normally.
 * 7. Different Hardware IDs → counted as separate unique users/devices.
 * 8. Existing licenses and payment functionality remain unchanged.
 */

const assert = require('assert');
const { LicenseManager, LicenseVault, generateHardwareId } = require('../src/license-manager');

console.log('🧪 Starting Firebase Backend Device Tracking & Unique Count Test Suite...\n');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.then(() => {
        console.log(`  ✓ ${desc}`);
        passed++;
      }).catch((e) => {
        console.error(`  ✗ FAIL: ${desc}\n   `, e.message);
        failed++;
      });
    }
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ FAIL: ${desc}\n   `, e.message);
    failed++;
  }
}

// In-Memory Simulated Firestore Collection for strict deterministic verification
class MockFirestore {
  constructor() {
    this.documents = new Map();
    this.callCount = 0;
  }

  isConfigured() {
    return true;
  }

  async getDocument(docId) {
    this.callCount++;
    if (this.documents.has(docId)) {
      return { found: true, doc: { ...this.documents.get(docId) } };
    }
    return { found: false, notFound: true };
  }

  async upsertDocument(docId, fieldsObj) {
    this.callCount++;
    const existing = this.documents.get(docId) || {};
    this.documents.set(docId, {
      ...existing,
      ...fieldsObj
    });
    return true;
  }

  getUniqueDeviceCount() {
    return this.documents.size;
  }
}

(async () => {
  // ── TEST 1: New Hardware ID → one Firebase user/device record ─────────────
  await it('Requirement 1: New Hardware ID creates exactly ONE Firebase user/device record', async () => {
    const mockDb = new MockFirestore();
    const lm = new LicenseManager();
    lm.firestore = mockDb;

    // Reset vault for new device simulation
    let vaultData = null;
    lm.vault.read = () => vaultData;
    lm.vault.write = (d) => { vaultData = d; };

    await lm.initialize();

    assert.strictEqual(mockDb.getUniqueDeviceCount(), 1, 'Collection must contain exactly 1 document');
    const doc = mockDb.documents.get(lm.hwidInfo.shortHwid);
    assert(doc, 'Document must be keyed by Hardware ID');
    assert.strictEqual(doc.hwid, lm.hwidInfo.shortHwid);
    assert(doc.firstSeenAt, 'firstSeenAt must be present');
    assert(doc.lastSeenAt, 'lastSeenAt must be present');
    assert.strictEqual(doc.status, 'trial');
    assert.strictEqual(doc.trialStatus, 'active');
    assert.strictEqual(doc.appVersion, '1.0.15');
  });

  // ── TEST 2: Same Hardware ID reopened → updates record, no duplicate ──────
  await it('Requirement 2: Same Hardware ID reopened updates existing record without duplicate', async () => {
    const mockDb = new MockFirestore();
    const lm = new LicenseManager();
    lm.firestore = mockDb;

    let vaultData = null;
    lm.vault.read = () => vaultData;
    lm.vault.write = (d) => { vaultData = d; };

    // Launch 1
    await lm.initialize();
    const firstSeen = mockDb.documents.get(lm.hwidInfo.shortHwid).firstSeenAt;
    const initialLastSeen = mockDb.documents.get(lm.hwidInfo.shortHwid).lastSeenAt;

    // Small delay to ensure timestamp changes
    await new Promise(r => setTimeout(r, 20));

    // Launch 2 (reopened on same device)
    await lm.initialize();

    assert.strictEqual(mockDb.getUniqueDeviceCount(), 1, 'Reopening must NOT create duplicate user/device');
    const updatedDoc = mockDb.documents.get(lm.hwidInfo.shortHwid);
    assert.strictEqual(updatedDoc.firstSeenAt, firstSeen, 'firstSeenAt must be strictly preserved');
    assert(new Date(updatedDoc.lastSeenAt).getTime() >= new Date(initialLastSeen).getTime(), 'lastSeenAt must be updated');
  });

  // ── TEST 3: App update → same record, updated version ────────────────────
  await it('Requirement 3: Same Hardware ID after app update updates version on same record', async () => {
    const mockDb = new MockFirestore();
    const lm = new LicenseManager();
    lm.firestore = mockDb;

    // Simulate pre-existing record created by version 1.0.12
    const hwid = lm.hwidInfo.shortHwid;
    mockDb.documents.set(hwid, {
      hwid: hwid,
      firstSeenAt: '2026-09-15T10:00:00.000Z',
      lastSeenAt: '2026-09-15T10:00:00.000Z',
      appVersion: '1.0.12',
      status: 'approved',
      planId: 'quarterly',
      planName: '3-Month Pass'
    });

    let vaultData = {
      hwid: lm.hwidInfo.fullHash,
      shortHwid: hwid,
      status: 'approved',
      planId: 'quarterly',
      planName: '3-Month Pass',
      firstLaunchTime: Date.now() - 5 * 86400000,
      firstSeenAt: '2026-09-15T10:00:00.000Z'
    };
    lm.vault.read = () => vaultData;
    lm.vault.write = (d) => { vaultData = d; };

    // App updated to 1.0.15
    lm.getTelemetry = () => ({
      hwid: hwid,
      appVersion: '1.0.15',
      lastSeenAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString()
    });

    await lm.initialize();

    assert.strictEqual(mockDb.getUniqueDeviceCount(), 1, 'Total unique devices must remain 1 after update');
    const updatedDoc = mockDb.documents.get(hwid);
    assert.strictEqual(updatedDoc.appVersion, '1.0.15', 'Version must be updated to new version');
    assert.strictEqual(updatedDoc.firstSeenAt, '2026-09-15T10:00:00.000Z', 'Original firstSeenAt must be preserved');
    assert.strictEqual(updatedDoc.status, 'approved', 'License status must be preserved');
    assert.strictEqual(updatedDoc.planId, 'quarterly', 'Plan ID must be preserved');
  });

  // ── TEST 4: Multiple launches (100 times) → still ONE unique user ────────
  await it('Requirement 4: 100 app launches by same device still equals exactly ONE unique user', async () => {
    const mockDb = new MockFirestore();
    const lm = new LicenseManager();
    lm.firestore = mockDb;

    let vaultData = null;
    lm.vault.read = () => vaultData;
    lm.vault.write = (d) => { vaultData = d; };

    for (let i = 0; i < 100; i++) {
      await lm.initialize();
    }

    assert.strictEqual(mockDb.getUniqueDeviceCount(), 1, '100 launches by the same device must equal 1 document');
  });

  // ── TEST 5: Offline app → Edge Light still works normally ────────────────
  await it('Requirement 5: Offline network state does NOT block or crash Edge Light', async () => {
    const lm = new LicenseManager();
    // Simulate completely offline network (ECONNREFUSED / timeout)
    lm.firestore.getDocument = async () => { throw new Error('ENOTFOUND firestore.googleapis.com'); };
    lm.firestore.upsertDocument = async () => { throw new Error('ENOTFOUND firestore.googleapis.com'); };

    const status = await lm.initialize();
    assert(status, 'Status must be evaluated');
    assert.strictEqual(status.isAuthorized, true, 'Device must be authorized normally from local vault');
    assert(status.trialRemainingHours > 0, 'Trial hours must be available');
  });

  // ── TEST 6: Firebase unavailable / HTTP 403 → Edge Light still works ─────
  await it('Requirement 6: Firebase HTTP 403 / API disabled does NOT block Edge Light', async () => {
    const lm = new LicenseManager();
    // Simulate Firestore returning 403 SERVICE_DISABLED
    lm.firestore.getDocument = async () => ({ found: false, error: 'HTTP 403' });
    lm.firestore.upsertDocument = async () => false;

    const status = await lm.initialize();
    assert(status, 'Status must return cleanly');
    assert.strictEqual(status.isAuthorized, true, 'License verification proceeds smoothly');
  });

  // ── TEST 7: Different Hardware IDs → counted as separate users/devices ───
  await it('Requirement 7: Different Hardware IDs count as separate unique users/devices', async () => {
    const mockDb = new MockFirestore();

    const deviceHwids = ['AAAA-1111-BBBB-2222', 'CCCC-3333-DDDD-4444', 'EEEE-5555-FFFF-6666'];

    for (const hwid of deviceHwids) {
      const lm = new LicenseManager();
      lm.firestore = mockDb;
      lm.hwidInfo = { shortHwid: hwid, fullHash: hwid + '_FULL' };
      let v = null;
      lm.vault.read = () => v;
      lm.vault.write = (d) => { v = d; };

      await lm.initialize();
    }

    assert.strictEqual(mockDb.getUniqueDeviceCount(), 3, 'Must contain exactly 3 unique devices');
    deviceHwids.forEach(h => {
      assert(mockDb.documents.has(h), `Must contain document for ${h}`);
    });
  });

  // ── TEST 8: Existing licenses & payment functionality remain unchanged ───
  await it('Requirement 8: Commercial license activation and vault persistence remain unchanged', async () => {
    const mockDb = new MockFirestore();
    const lm = new LicenseManager();
    lm.firestore = mockDb;

    const res = await lm.activateWithPaymentRef('pay_test_lifetime_backend_check', 'lifetime');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'approved');
    assert.strictEqual(res.licenseInfo.planId, 'lifetime');
    assert.strictEqual(res.licenseInfo.planName, 'Lifetime Pro');

    const doc = mockDb.documents.get(lm.hwidInfo.shortHwid);
    assert(doc, 'Device document must be updated in Firestore');
    assert.strictEqual(doc.status, 'approved');
    assert.strictEqual(doc.planId, 'lifetime');
  });

  // ── TEST 9: Privacy: Zero personal information stored ───────────────────
  await it('Privacy Guarantee: Stored telemetry contains NO passwords, usernames, or PC names', () => {
    const lm = new LicenseManager();
    const telemetry = lm.getTelemetry();

    assert.strictEqual(telemetry.username, undefined, 'username must not be present in telemetry');
    assert.strictEqual(telemetry.pcName, undefined, 'pcName must not be present in telemetry');
    assert.strictEqual(telemetry.password, undefined, 'password must not be present in telemetry');
    assert.strictEqual(telemetry.cardNumber, undefined, 'cardNumber must not be present in telemetry');
    assert(telemetry.hwid, 'hwid must be present');
    assert(telemetry.appVersion, 'appVersion must be present');
    assert(telemetry.lastSeenAt, 'lastSeenAt must be present');
  });

  console.log(`\n========================================`);
  console.log(`Firebase Backend Tracking: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
})();
