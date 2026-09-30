const { app } = require('electron');
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// ── ENVIRONMENT CONFIGURATION LOADER ──────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const config = {
    FIREBASE_PROJECT_ID: 'edge-light-24',
    FIREBASE_API_KEY: 'AIzaSyD3rx21xx-Fz2iWk367chc3HIcfY2Y5bAU',
    FIREBASE_AUTH_DOMAIN: 'edge-light-24.firebaseapp.com',
    FIREBASE_STORAGE_BUCKET: 'edge-light-24.firebasestorage.app',
    FIREBASE_MESSAGING_SENDER_ID: '1048711466271',
    FIREBASE_APP_ID: '1:1048711466271:web:92f149fb95d7f64358f42a',
    FIREBASE_MEASUREMENT_ID: 'G-79ZK0P075W',
    FIRESTORE_COLLECTION: 'licenses',
    TRIAL_DURATION_HOURS: 72,
    ADMIN_SECRET_SALT: 'EdgeLight-Secure-Vault-Core-Salt-2026',
    RAZORPAY_KEY_ID: 'rzp_live_TbF2T3PxIu4EAn',
    RAZORPAY_PAYMENT_LINK_MONTHLY: 'https://rzp.io/rzp/WY3lkA6',
    RAZORPAY_PAYMENT_LINK_QUARTERLY: 'https://rzp.io/rzp/01mOm4K',
    RAZORPAY_PAYMENT_LINK_LIFETIME: 'https://rzp.io/rzp/K30Pa9v',
    RAZORPAY_UPI_ID: 'edgelight@upi'
  };

  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (key && val) {
            config[key] = key === 'TRIAL_DURATION_HOURS' ? parseInt(val, 10) || 72 : val;
          }
        }
      }
    }
  } catch (e) {
    console.warn('[LicenseManager] Could not read .env file:', e.message);
  }
  return config;
}

const envConfig = loadEnv();

// ── HARDWARE ID GENERATOR ──────────────────────────────────────────
// Deep-fingerprints persistent hardware components:
// 1. MachineGuid from Windows Registry
// 2. Motherboard BIOS UUID via CIM/WMI
// 3. CPU Processor ID via CIM/WMI
// Hashes with internal salted HMAC-SHA256 to ensure device-bound tamper resistance.
function generateHardwareId(salt = envConfig.ADMIN_SECRET_SALT) {
  let mGuid = '';
  try {
    const regOutput = execSync('reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', {
      windowsHide: true,
      timeout: 3000
    }).toString();
    const match = regOutput.match(/MachineGuid\s+REG_SZ\s+([a-fA-F0-9\-]+)/i);
    if (match) mGuid = match[1].trim();
  } catch (e) {}

  let biosUuid = '';
  try {
    biosUuid = execSync('powershell -NoProfile -Command "(Get-CimInstance -Class Win32_ComputerSystemProduct).UUID"', {
      windowsHide: true,
      timeout: 4000
    }).toString().trim();
  } catch (e) {}

  let cpuId = '';
  try {
    cpuId = execSync('powershell -NoProfile -Command "(Get-CimInstance -Class Win32_Processor).ProcessorId"', {
      windowsHide: true,
      timeout: 4000
    }).toString().trim();
  } catch (e) {}

  // Robust fallback if powershell is restricted in corporate environments
  if (!mGuid && !biosUuid && !cpuId) {
    mGuid = os.hostname() + '::' + os.userInfo().username;
  }

  const raw = [mGuid, biosUuid, cpuId].filter(Boolean).join('::');
  const fullHash = crypto.createHmac('sha256', salt).update(raw).digest('hex').toUpperCase();
  const shortHwid = fullHash.slice(0, 16).match(/.{1,4}/g).join('-');

  return { fullHash, shortHwid, raw };
}

// ── ENCRYPTED LOCAL VAULT (AES-256-GCM) ────────────────────────────
// The local license vault is encrypted with a key derived from the PC's HWID.
// If this file is copied to another PC, decryption will fail completely.
class LicenseVault {
  constructor(hwid, salt) {
    this.hwid = hwid;
    this.salt = salt;
    const appData = app?.getPath ? app.getPath('userData') : path.join(os.homedir(), '.edgelight');
    if (!fs.existsSync(appData)) {
      try { fs.mkdirSync(appData, { recursive: true }); } catch (e) {}
    }
    this.vaultPath = path.join(appData, 'license.dat');
    this.key = crypto.scryptSync(hwid + salt, salt, 32);
  }

  encrypt(dataObj) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const jsonStr = JSON.stringify(dataObj);
    let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      iv: iv.toString('hex'),
      tag: authTag.toString('hex'),
      data: encrypted
    });
  }

  decrypt(payloadStr) {
    try {
      const payload = JSON.parse(payloadStr);
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(payload.iv, 'hex')
      );
      decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
      let decrypted = decipher.update(payload.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    } catch (e) {
      return null;
    }
  }

  read() {
    try {
      if (!fs.existsSync(this.vaultPath)) return null;
      const raw = fs.readFileSync(this.vaultPath, 'utf8');
      return this.decrypt(raw);
    } catch (e) {
      return null;
    }
  }

  write(dataObj) {
    try {
      const encrypted = this.encrypt(dataObj);
      fs.writeFileSync(this.vaultPath, encrypted, 'utf8');
      return true;
    } catch (e) {
      console.error('[LicenseVault] Write error:', e);
      return false;
    }
  }
}

// ── FIRESTORE REST API CLIENT ─────────────────────────────────────
// Uses zero external npm dependencies via Node's native HTTPS module.
class FirestoreClient {
  constructor(projectId, apiKey, collection) {
    this.projectId = projectId;
    this.apiKey = apiKey;
    this.collection = collection || 'licenses';
  }

  isConfigured() {
    return !!this.projectId && this.projectId.trim().length > 0;
  }

  async getDocument(docId) {
    if (!this.isConfigured()) return null;
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${this.collection}/${encodeURIComponent(docId)}${this.apiKey ? '?key=' + this.apiKey : ''}`;

    return new Promise((resolve) => {
      let settled = false;
      const safeResolve = (val) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      const req = https.get(url, { timeout: 5000 }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(body);
              safeResolve({ found: true, doc: this._parseFields(parsed?.fields) });
            } catch (e) {
              safeResolve({ found: false, error: e.message });
            }
          } else if (res.statusCode === 404) {
            safeResolve({ found: false, notFound: true });
          } else {
            safeResolve({ found: false, error: `HTTP ${res.statusCode}` });
          }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        safeResolve({ found: false, error: 'Request timeout' });
      });
      req.on('error', (err) => {
        safeResolve({ found: false, error: err.message });
      });
    });
  }

  async upsertDocument(docId, fieldsObj) {
    if (!this.isConfigured()) return null;
    const queryParams = [];
    if (this.apiKey) queryParams.push('key=' + encodeURIComponent(this.apiKey));
    for (const key of Object.keys(fieldsObj)) {
      queryParams.push(`updateMask.fieldPaths=${encodeURIComponent(key)}`);
    }
    const qs = queryParams.length > 0 ? '?' + queryParams.join('&') : '';
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${this.collection}/${encodeURIComponent(docId)}${qs}`;
    const payload = JSON.stringify({ fields: this._formatFields(fieldsObj) });

    return new Promise((resolve) => {
      let settled = false;
      const safeResolve = (val) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      const req = https.request(url, {
        method: 'PATCH',
        timeout: 6000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          safeResolve(res.statusCode >= 200 && res.statusCode < 300);
        });
      });

      req.on('timeout', () => {
        req.destroy();
        safeResolve(false);
      });
      req.on('error', () => safeResolve(false));
      req.write(payload);
      req.end();
    });
  }

  _parseFields(fields) {
    if (!fields) return {};
    const result = {};
    for (const [key, val] of Object.entries(fields)) {
      if (val.stringValue !== undefined) result[key] = val.stringValue;
      else if (val.integerValue !== undefined) result[key] = parseInt(val.integerValue, 10);
      else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
      else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
    }
    return result;
  }

  _formatFields(obj) {
    const fields = {};
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'string') fields[key] = { stringValue: val };
      else if (typeof val === 'number') fields[key] = { integerValue: val.toString() };
      else if (typeof val === 'boolean') fields[key] = { booleanValue: val };
      else if (val instanceof Date) fields[key] = { timestampValue: val.toISOString() };
    }
    return fields;
  }
}

// ── LICENSE MANAGER CONTROLLER ────────────────────────────────────
class LicenseManager {
  constructor() {
    this.config = loadEnv();
    this.hwidInfo = generateHardwareId(this.config.ADMIN_SECRET_SALT);
    this.vault = new LicenseVault(this.hwidInfo.fullHash, this.config.ADMIN_SECRET_SALT);
    this.firestore = new FirestoreClient(
      this.config.FIREBASE_PROJECT_ID,
      this.config.FIREBASE_API_KEY,
      this.config.FIRESTORE_COLLECTION
    );
    this.currentStatus = {
      isAuthorized: false,
      status: 'evaluating',
      hwid: this.hwidInfo.shortHwid,
      fullHwid: this.hwidInfo.fullHash,
      trialRemainingHours: 0,
      trialRemainingDays: 0,
      message: 'Verifying license...'
    };
    this.heartbeatInterval = null;
    this.dailyAuditTimer = null;
    this._hasInitialized = false;
    this._dailyAuditCallback = null;
    // Offline enforcement: max hours offline before locking
    this.OFFLINE_LOCK_HOURS = 72; // 3 days
    this.OFFLINE_WARN_HOURS = 48; // 2 days - warn user
  }

  getShortHWID() {
    return this.hwidInfo.shortHwid;
  }

  // Record that the user is currently online — update vault timestamp
  recordOnline() {
    let data = this.vault.read() || {};
    data.lastOnlineTime = Date.now();
    data.isCurrentlyOffline = false;
    this.vault.write(data);
  }

  // Get offline enforcement status
  getOfflineStatus() {
    const data = this.vault.read() || {};
    const lastOnline = data.lastOnlineTime || Date.now();
    const offlineMs = Date.now() - lastOnline;
    const offlineHours = offlineMs / 3600000;
    return {
      lastOnlineTime: lastOnline,
      offlineHours,
      isWarning: offlineHours >= this.OFFLINE_WARN_HOURS,
      isLocked: offlineHours >= this.OFFLINE_LOCK_HOURS
    };
  }

  getTelemetry() {
    let username = '';
    try { username = os.userInfo().username; } catch (e) {}
    return {
      hwid: this.hwidInfo.shortHwid,
      fullHwid: this.hwidInfo.fullHash,
      pcName: os.hostname(),
      username: username,
      osVersion: `${os.type()} ${os.release()} (${os.arch()})`,
      arch: process.arch,
      appVersion: app?.getVersion ? app.getVersion() : '1.0.5',
      lastActiveAt: new Date().toISOString()
    };
  }

  // Evaluate authorization status on startup
  async initialize() {
    const now = Date.now();
    const trialDurationMs = (this.config.TRIAL_DURATION_HOURS || 72) * 60 * 60 * 1000;

    let data = this.vault.read();

    // First time running on this device: initialize 3-day free trial
    if (!data) {
      data = {
        hwid: this.hwidInfo.fullHash,
        shortHwid: this.hwidInfo.shortHwid,
        pcName: os.hostname(),
        status: 'trial',
        planId: 'trial',
        planName: '3-Day Free Trial',
        firstLaunchTime: now,
        lastSeenTime: now,
        lastOnlineTime: now,
        clockTampered: false,
        registeredAt: new Date().toISOString(),
        totalLaunches: 1,
        lastDailyCheck: now
      };
      this.vault.write(data);
    } else if (!this._hasInitialized) {
      // Only increment total launches once on real app startup, not on every 30s background sync!
      data.totalLaunches = (data.totalLaunches || 1) + 1;
      // Initialize lastOnlineTime if missing (migration)
      if (!data.lastOnlineTime) data.lastOnlineTime = now;
    }

    // Anti-Clock Tampering Check:
    // If system clock was dialed backwards by more than 1 hour to cheat the trial
    if (data.lastSeenTime && now < data.lastSeenTime - 3600000) {
      data.clockTampered = true;
      data.status = 'clock_tampered';
      this.vault.write(data);
    } else {
      // Update monotonic high-water mark timestamp
      data.lastSeenTime = now;
      this.vault.write(data);
    }

    // Try synchronizing with Firestore backend (if configured)
    if (this.firestore.isConfigured()) {
      try {
        const telemetry = this.getTelemetry();
        const remote = await this.firestore.getDocument(this.hwidInfo.shortHwid);
        if (remote && remote.found && remote.doc) {
          // If admin approved, updated plan, or rejected in Firestore, remote state takes precedence!
          if (remote.doc.status) {
            data.status = remote.doc.status;
            if (remote.doc.status === 'approved' || remote.doc.status === 'trial') {
              data.clockTampered = false;
            }
            if (remote.doc.status === 'trial' && remote.doc.resetTrial) {
              data.firstLaunchTime = now;
            }
          }
          if (remote.doc.planId) data.planId = remote.doc.planId;
          if (remote.doc.planName) data.planName = remote.doc.planName;
          if (remote.doc.licenseKey) data.licenseKey = remote.doc.licenseKey;
          if (remote.doc.expiresAt !== undefined) data.expiresAt = remote.doc.expiresAt;
          if (remote.doc.paymentId) data.paymentId = remote.doc.paymentId;
          if (remote.doc.paidAt) data.paidAt = remote.doc.paidAt;
          if (remote.doc.approvedAt) data.approvedAt = remote.doc.approvedAt;

          data.lastDailyCheck = now;
          this.vault.write(data);

          // Update live heartbeat & rich telemetry in Firestore
          this.firestore.upsertDocument(this.hwidInfo.shortHwid, {
            ...telemetry,
            totalLaunches: data.totalLaunches || 1
          }).catch(() => {});
        } else if (remote && remote.notFound) {
          // If local says approved but cloud record was deleted by admin -> revoke!
          if (data.status === 'approved') {
            data.status = 'revoked';
            this.vault.write(data);
          } else {
            // Auto-register new device in Firestore as 'trial' with rich telemetry
            this.firestore.upsertDocument(this.hwidInfo.shortHwid, {
              ...telemetry,
              status: data.status || 'trial',
              planId: 'trial',
              planName: '3-Day Free Trial',
              registeredAt: new Date().toISOString(),
              totalLaunches: 1
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.log('[LicenseManager] Firestore sync skipped:', e.message);
      }
    }

    // Start daily randomized check once on initial startup if not already scheduled
    if (!this.dailyAuditTimer) {
      this.scheduleDailyAudit();
    }
    this._hasInitialized = true;

    // Determine current license state
    return this._evaluate(data);
  }

  // Daily randomized verification check with Firestore
  // Runs approximately once every 24 hours (with randomized ±4 hour jitter)
  scheduleDailyAudit(callback) {
    if (typeof callback === 'function') {
      this._dailyAuditCallback = callback;
    }
    if (this.dailyAuditTimer) clearTimeout(this.dailyAuditTimer);

    // Randomize interval between 20 and 28 hours (in milliseconds)
    const minHours = 20;
    const maxHours = 28;
    const randomHours = minHours + Math.random() * (maxHours - minHours);
    const delayMs = Math.round(randomHours * 3600 * 1000);

    this.dailyAuditTimer = setTimeout(async () => {
      try {
        console.log('[LicenseManager] Executing scheduled daily randomized Firestore check...');
        const updated = await this.performDailyAudit();
        const cb = typeof callback === 'function' ? callback : this._dailyAuditCallback;
        if (typeof cb === 'function') cb(updated);
      } catch (err) {
        console.warn('[LicenseManager] Daily audit error:', err.message);
      }
      // Reschedule for next day
      this.scheduleDailyAudit();
    }, delayMs);
    if (this.dailyAuditTimer && typeof this.dailyAuditTimer.unref === 'function') {
      this.dailyAuditTimer.unref();
    }
  }

  async performDailyAudit() {
    if (!this.firestore.isConfigured()) return this.currentStatus;

    let data = this.vault.read() || {};
    const now = Date.now();

    try {
      const remote = await this.firestore.getDocument(this.hwidInfo.shortHwid);
      if (remote && remote.found && remote.doc) {
        // Update local license state from Firestore
        data.status = remote.doc.status || data.status;
        data.planId = remote.doc.planId || data.planId;
        data.planName = remote.doc.planName || data.planName;
        data.licenseKey = remote.doc.licenseKey || data.licenseKey;
        data.expiresAt = remote.doc.expiresAt !== undefined ? remote.doc.expiresAt : data.expiresAt;
        data.lastDailyCheck = now;
        this.vault.write(data);

        // Ping telemetry heartbeat
        const telemetry = this.getTelemetry();
        this.firestore.upsertDocument(this.hwidInfo.shortHwid, {
          ...telemetry,
          lastAuditAt: new Date().toISOString()
        }).catch(() => {});
      } else if (remote && remote.notFound) {
        // Document was deleted in Firestore!
        console.warn(`[LicenseManager] HWID ${this.hwidInfo.shortHwid} not found in Firestore during daily audit. Revoking license.`);
        data.status = 'revoked';
        data.lastDailyCheck = now;
        this.vault.write(data);
      }
    } catch (e) {
      console.warn('[LicenseManager] Daily audit network failure:', e.message);
    }

    return this._evaluate(data);
  }

  _evaluate(data) {
    const now = Date.now();
    const trialDurationMs = (this.config.TRIAL_DURATION_HOURS || 72) * 60 * 60 * 1000;
    const elapsedMs = Math.max(0, now - (data.firstLaunchTime || now));
    const remainingMs = Math.max(0, trialDurationMs - elapsedMs);
    const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
    const remainingDays = Math.floor(remainingHours / 24);

    const baseInfo = {
      hwid: this.hwidInfo.shortHwid,
      fullHwid: this.hwidInfo.fullHash,
      planId: data.planId || 'trial',
      planName: data.planName || '3-Day Free Trial',
      licenseKey: data.licenseKey || null,
      paymentId: data.paymentId || null,
      paidAt: data.paidAt || data.approvedAt || null,
      approvedAt: data.approvedAt || data.paidAt || null,
      expiresAt: data.expiresAt || null,
      lastDailyCheck: data.lastDailyCheck || null
    };

    if (data.clockTampered) {
      this.currentStatus = {
        ...baseInfo,
        isAuthorized: false,
        status: 'clock_tampered',
        trialRemainingHours: 0,
        trialRemainingDays: 0,
        message: 'System clock tampering detected. License locked.'
      };
      return this.currentStatus;
    }

    if (data.status === 'revoked' || data.status === 'deleted') {
      this.currentStatus = {
        ...baseInfo,
        isAuthorized: false,
        status: 'revoked',
        trialRemainingHours: 0,
        trialRemainingDays: 0,
        message: 'License document revoked or not found in cloud directory.'
      };
      return this.currentStatus;
    }

    if (data.status === 'rejected' || data.status === 'banned') {
      this.currentStatus = {
        ...baseInfo,
        isAuthorized: false,
        status: 'rejected',
        trialRemainingHours: 0,
        trialRemainingDays: 0,
        message: 'Device access revoked by administrator.'
      };
      return this.currentStatus;
    }

    // Check offline enforcement for approved (paid) licenses only
    // Trial users are allowed offline (they expire by time, not connectivity)
    if (data.status === 'approved') {
      const lastOnline = data.lastOnlineTime || now;
      const offlineMs = Math.max(0, now - lastOnline);
      const offlineHours = offlineMs / 3600000;

      if (offlineHours >= this.OFFLINE_LOCK_HOURS) {
        this.currentStatus = {
          ...baseInfo,
          isAuthorized: false,
          status: 'offline_locked',
          trialRemainingHours: 0,
          trialRemainingDays: 0,
          offlineHours: Math.floor(offlineHours),
          message: `Offline for ${Math.floor(offlineHours)}h — Connect to internet to verify license`
        };
        return this.currentStatus;
      }
    }

    if (data.status === 'approved') {
      // Check subscription expiration if expiresAt is set
      if (data.expiresAt) {
        const expTime = new Date(data.expiresAt).getTime();
        if (now > expTime) {
          this.currentStatus = {
            ...baseInfo,
            isAuthorized: false,
            status: 'expired',
            trialRemainingHours: 0,
            trialRemainingDays: 0,
            message: `${data.planName || 'Subscription'} Pass Expired — Please Renew`
          };
          return this.currentStatus;
        }

        const daysRemaining = Math.max(1, Math.ceil((expTime - now) / (86400000)));
        this.currentStatus = {
          ...baseInfo,
          isAuthorized: true,
          status: 'approved',
          trialRemainingHours: daysRemaining * 24,
          trialRemainingDays: daysRemaining,
          message: `Commercial License Active (${data.planName || 'Pass'} — ${daysRemaining}d remaining)`
        };
        return this.currentStatus;
      }

      // Permanent Lifetime Pro
      this.currentStatus = {
        ...baseInfo,
        isAuthorized: true,
        status: 'approved',
        trialRemainingHours: 9999,
        trialRemainingDays: 9999,
        message: 'Commercial License Active — Lifetime Pro'
      };
      return this.currentStatus;
    }

    // Active 3-day free trial check
    if (remainingMs > 0) {
      const daysStr = remainingDays > 0 ? `${remainingDays}d ` : '';
      const hoursStr = `${remainingHours % 24}h`;
      this.currentStatus = {
        ...baseInfo,
        isAuthorized: true,
        status: 'trial',
        trialRemainingHours: remainingHours,
        trialRemainingDays: remainingDays,
        message: `Free Trial Active (${daysStr}${hoursStr} remaining)`
      };
      return this.currentStatus;
    }

    // Trial has expired
    this.currentStatus = {
      ...baseInfo,
      isAuthorized: false,
      status: 'expired',
      trialRemainingHours: 0,
      trialRemainingDays: 0,
      message: '3-Day Free Trial Expired — License Activation Required'
    };
    return this.currentStatus;
  }

  getStatus() {
    return this.currentStatus;
  }

  isAuthorized() {
    return this.currentStatus.isAuthorized;
  }

  async refresh() {
    return await this.initialize();
  }

  startPeriodicSync(callback, intervalMs = 30000) {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    // Refresh status & send heartbeat every 30 seconds (real-time responsiveness)
    this.heartbeatInterval = setInterval(async () => {
      try {
        const updated = await this.initialize();
        if (typeof callback === 'function') callback(updated);
      } catch (e) {}
    }, intervalMs);
    if (this.heartbeatInterval && typeof this.heartbeatInterval.unref === 'function') {
      this.heartbeatInterval.unref();
    }
  }

  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.dailyAuditTimer) {
      clearTimeout(this.dailyAuditTimer);
      this.dailyAuditTimer = null;
    }
  }

  getPaymentConfig() {
    const defaultHwid = this.hwidInfo.shortHwid;
    const planList = [
      {
        id: 'monthly',
        name: 'Monthly Pass',
        price: 29,
        period: '/ month',
        popular: false,
        link: this.config.RAZORPAY_PAYMENT_LINK_MONTHLY || 'https://rzp.io/rzp/WY3lkA6',
        features: [
          '30 Days Unlimited Illumination',
          'Webcam Auto-Metering & Low-Light Detect',
          'Full Screen Video Call Overlays',
          'Smooth Color Temperature Control'
        ]
      },
      {
        id: 'quarterly',
        name: '3-Month Quarter Pass',
        price: 49,
        period: '/ 3 months (~₹16/mo)',
        popular: true,
        badge: 'Most Popular',
        link: this.config.RAZORPAY_PAYMENT_LINK_QUARTERLY || 'https://rzp.io/rzp/01mOm4K',
        features: [
          '90 Days Continuous Studio Ring',
          'Includes All Monthly Pass Features',
          'Multi-Monitor & Resolution Scaling',
          'Priority Updates & Hardware Calibration'
        ]
      },
      {
        id: 'lifetime',
        name: 'Lifetime Pro',
        price: 99,
        period: 'one-time forever',
        popular: false,
        badge: 'Best Value',
        link: this.config.RAZORPAY_PAYMENT_LINK_LIFETIME || 'https://rzp.io/rzp/K30Pa9v',
        features: [
          'Permanent Lifetime Commercial License',
          'Zero Monthly or Yearly Renewals Ever',
          'Hardware ID Tied to this Computer',
          'All Future Pro Updates Included'
        ]
      }
    ];

    const plansById = {};
    planList.forEach(p => { plansById[p.id] = p; });

    return {
      razorpayKeyId: this.config.RAZORPAY_KEY_ID || '',
      keyId: this.config.RAZORPAY_KEY_ID || '',
      upiId: this.config.RAZORPAY_UPI_ID || 'edgelight@upi',
      hwid: defaultHwid,
      plans: planList,
      plansById: plansById,
      monthly: plansById.monthly,
      quarterly: plansById.quarterly,
      lifetime: plansById.lifetime
    };
  }

  getFirebaseConfig() {
    return {
      apiKey: this.config.FIREBASE_API_KEY,
      authDomain: this.config.FIREBASE_AUTH_DOMAIN,
      projectId: this.config.FIREBASE_PROJECT_ID,
      storageBucket: this.config.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: this.config.FIREBASE_MESSAGING_SENDER_ID,
      appId: this.config.FIREBASE_APP_ID,
      measurementId: this.config.FIREBASE_MEASUREMENT_ID,
      collection: this.config.FIRESTORE_COLLECTION
    };
  }

  async activateWithPaymentRef(paymentRef, planId = 'quarterly') {
    const cleanRef = String(paymentRef || '').trim();
    if (!cleanRef || cleanRef.length < 4) {
      return { success: false, error: 'Please enter a valid Payment ID or UPI Ref (UTR).' };
    }

    const plans = {
      monthly: { planId: 'monthly', planName: 'Monthly Pass', durationDays: 30 },
      quarterly: { planId: 'quarterly', planName: '3-Month Pass', durationDays: 90 },
      lifetime: { planId: 'lifetime', planName: 'Lifetime Pro', durationDays: null }
    };
    const selected = plans[planId] || plans.quarterly;
    const now = Date.now();
    const expiresAt = selected.durationDays ? new Date(now + selected.durationDays * 86400000).toISOString() : null;
    const key = `EL-${selected.planId.toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const updateFields = {
      status: 'approved',
      planId: selected.planId,
      planName: selected.planName,
      licenseKey: key,
      expiresAt: expiresAt,
      paymentId: cleanRef,
      paidAt: new Date(now).toISOString(),
      approvedAt: new Date(now).toISOString(),
      lastUpdated: new Date(now).toISOString()
    };

    // Update local vault immediately
    const data = this.vault.read() || {};
    data.status = 'approved';
    data.planId = selected.planId;
    data.planName = selected.planName;
    data.licenseKey = key;
    data.expiresAt = expiresAt;
    data.paymentId = cleanRef;
    data.paidAt = updateFields.paidAt;
    data.approvedAt = updateFields.approvedAt;
    data.clockTampered = false;
    this.vault.write(data);

    // Sync to Firestore cloud
    if (this.firestore.isConfigured()) {
      try {
        await this.firestore.upsertDocument(this.hwidInfo.shortHwid, updateFields);
      } catch (err) {
        console.warn('[LicenseManager] Cloud sync for manual payment activation:', err.message);
      }
    }

    const evaluated = this._evaluate(data);
    return { success: true, status: 'approved', licenseInfo: evaluated };
  }
}

module.exports = {
  LicenseManager,
  generateHardwareId,
  LicenseVault,
  loadEnv
};
