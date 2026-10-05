/**
 * Edge Light — Live Firebase Device & Unique User Analytics CLI
 * Reads directly from Firebase Firestore using configured credentials in .env
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const config = {
    FIREBASE_PROJECT_ID: 'edge-light-24',
    FIREBASE_API_KEY: '',
    FIRESTORE_COLLECTION: 'licenses'
  };

  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        config[k] = v;
      }
    }
  }
  return config;
}

function parseFields(fields) {
  if (!fields) return {};
  const res = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue !== undefined) res[k] = v.stringValue;
    else if (v.integerValue !== undefined) res[k] = parseInt(v.integerValue, 10);
    else if (v.booleanValue !== undefined) res[k] = v.booleanValue;
    else if (v.timestampValue !== undefined) res[k] = v.timestampValue;
  }
  return res;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          reject(e);
        }
      });
    }).on('timeout', function() {
      this.destroy();
      reject(new Error('Request timeout'));
    }).on('error', reject);
  });
}

async function getDeviceStats() {
  const config = loadEnv();
  const projectId = config.FIREBASE_PROJECT_ID || 'edge-light-24';
  const apiKey = config.FIREBASE_API_KEY;
  const col = config.FIRESTORE_COLLECTION || 'licenses';

  console.log('===============================================================');
  console.log('   Edge Light — Firebase Device & Unique User Analytics');
  console.log('===============================================================');
  console.log(`Firebase Project : ${projectId}`);
  console.log(`Collection       : ${col}`);
  console.log(`Timestamp        : ${new Date().toISOString()}`);
  console.log('---------------------------------------------------------------');

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col}?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetchJson(url);

    if (res.status === 403) {
      console.log('⚠️  Notice from Google Cloud:');
      console.log('   The Cloud Firestore API is currently disabled or needs activation in project ' + projectId + '.');
      console.log('   To activate Firestore, visit:');
      console.log(`   https://console.firebase.google.com/project/${projectId}/firestore`);
      console.log('\n   Once activated in the Firebase Console, this command will display live telemetry.');
      return;
    }

    if (res.status !== 200) {
      console.error(`Error querying Firestore (HTTP ${res.status}):`, res.body?.error?.message || res.body);
      return;
    }

    const docs = res.body?.documents || [];
    const devices = [];
    const now = Date.now();
    const oneDayMs = 24 * 3600 * 1000;
    const fifteenMinMs = 15 * 60 * 1000;

    let onlineNow = 0;
    let activeToday = 0;
    const breakdown = {};
    const versions = {};
    const plans = {};

    for (const doc of docs) {
      const docHwid = doc.name.split('/').pop();
      const parsed = parseFields(doc.fields);
      const hwid = parsed.hwid || docHwid;
      const appVersion = parsed.appVersion || 'Unknown';
      const status = parsed.status || 'trial';
      const planId = parsed.planId || 'trial';
      const firstSeen = parsed.firstSeenAt || parsed.registeredAt || doc.createTime;
      const lastSeen = parsed.lastSeenAt || parsed.lastActiveAt || doc.updateTime;

      const lastSeenMs = lastSeen ? new Date(lastSeen).getTime() : 0;
      if (lastSeenMs > 0 && (now - lastSeenMs < fifteenMinMs)) onlineNow++;
      if (lastSeenMs > 0 && (now - lastSeenMs < oneDayMs)) activeToday++;

      breakdown[status] = (breakdown[status] || 0) + 1;
      versions[appVersion] = (versions[appVersion] || 0) + 1;
      plans[planId] = (plans[planId] || 0) + 1;

      devices.push({
        hwid,
        appVersion,
        status,
        planId,
        firstSeen,
        lastSeen,
        expiresAt: parsed.expiresAt || null
      });
    }

    console.log(`\n👥 Total Unique Hardware IDs (Devices): ${devices.length}`);
    console.log(`🟢 Active Devices (Past 24 Hours)    : ${activeToday}`);
    console.log(`⚡ Online Right Now (Last 15 Min)    : ${onlineNow}`);
    console.log('\n📊 Status Breakdown:');
    for (const [st, cnt] of Object.entries(breakdown)) {
      console.log(`   - ${st.padEnd(12)}: ${cnt}`);
    }

    console.log('\n📦 App Versions:');
    for (const [ver, cnt] of Object.entries(versions)) {
      console.log(`   - v${ver.padEnd(11)}: ${cnt} device(s)`);
    }

    console.log('\n💳 Plan Breakdown:');
    for (const [pl, cnt] of Object.entries(plans)) {
      console.log(`   - ${pl.padEnd(12)}: ${cnt}`);
    }

    console.log('\n📱 Connected Devices:');
    devices.forEach((d, idx) => {
      console.log(`   [${idx + 1}] HWID: ${d.hwid} | v${d.appVersion} | Status: ${d.status} (${d.planId}) | Last Seen: ${d.lastSeen}`);
    });

    console.log('===============================================================\n');

  } catch (err) {
    console.error('Failed to query device statistics:', err.message);
  }
}

if (require.main === module) {
  getDeviceStats();
}

module.exports = { getDeviceStats };
