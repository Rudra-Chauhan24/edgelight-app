#!/usr/bin/env node
/**
 * publish-ota.js
 * ────────────────────────────────────────────────────────────────────
 * Publishes a new Edge Light OTA update manifest to:
 *   1. The backend REST API  → POST /api/updates/publish
 *   2. Firestore directly    → system/latest_release document
 *
 * Usage:
 *   node scripts/publish-ota.js [version] [downloadUrl]
 *
 * Examples:
 *   node scripts/publish-ota.js 1.0.5
 *   node scripts/publish-ota.js 1.0.5 https://github.com/.../Edge.Light.Setup.1.0.5.exe
 */

const https = require('https');
const http  = require('http');
const path  = require('path');
const fs    = require('fs');

// ── Load .env config ─────────────────────────────────────────────────
const envPath = path.join(__dirname, '..', '.env');
const config  = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && k.trim() && !k.trim().startsWith('#')) {
      config[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  });
}

// ── Config ────────────────────────────────────────────────────────────
const BACKEND_URL   = config.BACKEND_URL || 'https://edgelight-backend.vercel.app';
const ADMIN_SECRET  = config.ADMIN_SECRET || '';

// Read version from package.json if not supplied as arg
const pkgVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
const VERSION    = (process.argv[2] || pkgVersion).replace(/^v/i, '').trim();
const DL_URL     = process.argv[3] ||
  `https://github.com/CHAUHANRUDRA24/edgelight-app/releases/download/v${VERSION}/Edge.Light.Setup.${VERSION}.exe`;

const RELEASE_NOTES = `💳 Payment Window Layering Fix: Payment window now has topmost priority and is never covered by the buying options.\n` +
  `🌐 Open in Browser Tab: Added direct option to complete checkout in your default web browser (Chrome/Edge).\n` +
  `⚡ Active Checkout Banner: Controls to bring window to front or switch to browser tab.\n` +
  `🔐 Auto License Activation: Automatically provisions and unlocks pro license whether paying in-app or browser.`;

const MANIFEST = {
  version:     VERSION,
  notes:       RELEASE_NOTES,
  downloadUrl: DL_URL,
  setupUrl:    DL_URL,
  releaseDate: new Date().toISOString()
};

console.log('\n🚀 Edge Light OTA Publisher');
console.log('===================================================');
console.log(`  Version    : v${VERSION}`);
console.log(`  Download   : ${DL_URL}`);
console.log(`  Backend    : ${BACKEND_URL}`);
console.log('===================================================\n');

// ── POST to backend /api/updates/publish ─────────────────────────────
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = JSON.stringify(body);
    const client  = parsed.protocol === 'https:' ? https : http;

    const req = client.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(ADMIN_SECRET ? { 'x-admin-secret': ADMIN_SECRET } : {})
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(payload);
    req.end();
  });
}

// ── Firestore direct publish (via Firebase Admin) ─────────────────────
async function publishToFirestore() {
  try {
    const admin = require('firebase-admin');

    // Initialize only if not already done
    if (!admin.apps.length) {
      const svcKey = config.FIREBASE_SERVICE_ACCOUNT_KEY
        ? JSON.parse(config.FIREBASE_SERVICE_ACCOUNT_KEY) : null;
      if (svcKey) {
        admin.initializeApp({ credential: admin.credential.cert(svcKey), projectId: config.FIREBASE_PROJECT_ID });
      } else {
        admin.initializeApp({ projectId: config.FIREBASE_PROJECT_ID || 'edge-light-24' });
      }
    }

    const db = admin.firestore();
    await db.collection('system').doc('latest_release').set({
      ...MANIFEST,
      publishedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: false });

    console.log('  OK  Firestore system/latest_release updated');
    return true;
  } catch (e) {
    console.warn('  WARN  Firestore direct write skipped:', e.message);
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────
(async () => {
  let step = 1;

  // Step 1 — Call backend REST endpoint
  console.log(`[${step++}] Posting to backend: ${BACKEND_URL}/api/updates/publish`);
  try {
    const result = await postJson(`${BACKEND_URL}/api/updates/publish`, MANIFEST);
    if (result.status >= 200 && result.status < 300) {
      console.log(`  OK  Backend accepted v${VERSION} (HTTP ${result.status})`);
    } else {
      console.warn(`  WARN  Backend responded HTTP ${result.status}:`, result.body);
    }
  } catch (err) {
    console.warn('  WARN  Backend call failed:', err.message);
    console.log('      (Proceeding to Firestore direct write)\n');
  }

  // Step 2 — Write directly to Firestore
  console.log(`[${step++}] Writing to Firestore system/latest_release...`);
  await publishToFirestore();

  console.log(`\nDONE  OTA update v${VERSION} published!`);
  console.log(`   Users on v1.0.4 and below will see the update notification on next launch.\n`);
  process.exit(0);
})();
