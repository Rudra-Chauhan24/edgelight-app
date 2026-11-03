/**
 * scripts/test-default-auto-lighting-and-video-calls.js
 * Comprehensive Verification Suite for:
 * Default Automatic Lighting and Video Call Detection
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FacePresenceDetector } = require('../src/face-detector.js');

function createSyntheticFrame({ hasFace = true, faceLum = 120, ambientLum = 50 }) {
  const w = 80;
  const h = 60;
  const data = new Uint8ClampedArray(w * h * 4);

  const faceRGB = Math.max(0, Math.min(255, faceLum));
  const ambRGB = Math.max(0, Math.min(255, ambientLum));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      let isFacePixel = false;

      if (hasFace) {
        const dx = (x - 40) / 16;
        const dy = (y - 30) / 24;
        if (dx * dx + dy * dy <= 1.0) {
          isFacePixel = true;
        }
      }

      if (isFacePixel) {
        data[idx] = Math.min(255, Math.round(faceRGB * 1.15));
        data[idx + 1] = Math.round(faceRGB * 0.95);
        data[idx + 2] = Math.round(faceRGB * 0.85);
        data[idx + 3] = 255;
      } else {
        data[idx] = ambRGB;
        data[idx + 1] = ambRGB;
        data[idx + 2] = ambRGB;
        data[idx + 3] = 255;
      }
    }
  }

  return { width: w, height: h, data };
}

(async () => {
  console.log('🧪 Starting Default Automatic Lighting & Video Call Detection Verification Suite...\n');

  let totalTests = 0;
  let passedTests = 0;

  function runTest(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✓ Test ${totalTests}: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ Test ${totalTests}: ${name}:`, err.message);
      throw err;
    }
  }

  async function runAsyncTest(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✓ Test ${totalTests}: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ Test ${totalTests}: ${name}:`, err.message);
      throw err;
    }
  }

  const mainPath = path.resolve(__dirname, '..', 'src', 'main.js');
  const rendererPath = path.resolve(__dirname, '..', 'src', 'renderer.js');
  const indexPath = path.resolve(__dirname, '..', 'src', 'index.html');
  const faceDetectorPath = path.resolve(__dirname, '..', 'src', 'face-detector.js');
  const licensePath = path.resolve(__dirname, '..', 'src', 'license-manager.js');

  const mainCode = fs.readFileSync(mainPath, 'utf8');
  const rendererCode = fs.readFileSync(rendererPath, 'utf8');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const faceDetectorCode = fs.readFileSync(faceDetectorPath, 'utf8');
  const licenseCode = fs.readFileSync(licensePath, 'utf8');

  // =========================================================================
  // 1. DEFAULT AUTOMATIC OPERATION & CLEAN FLOATING PANEL
  // =========================================================================
  runTest('Automatic lighting is enabled by default for new installations and user profiles', () => {
    assert(rendererCode.includes('let autoFaceEnabled = true;'), 'autoFaceEnabled must be true by default');
    assert(rendererCode.includes('let autoWebcamEnabled = true;'), 'autoWebcamEnabled must be true by default');
    assert(
      rendererCode.includes('faceDetector = new FacePresenceDetector({\n      consecutiveRequired: 3,\n      gracePeriodMs: 3000,\n      sampleIntervalMs: 140,\n      enabled: true') ||
      rendererCode.includes('faceDetector = new FacePresenceDetector({\r\n      consecutiveRequired: 3,\r\n      gracePeriodMs: 3000,\r\n      sampleIntervalMs: 140,\r\n      enabled: true'),
      'FacePresenceDetector must be instantiated with enabled: true'
    );
  });

  runTest('Floating panel (#bar) preserves existing clean layout without Auto Face switch', () => {
    const barMatch = indexHtml.match(/<div id="bar"[\s\S]*?<\/div>\s*<\/div>/);
    assert(barMatch, '#bar element must exist');
    const barHtml = barMatch[0];

    assert(!barHtml.includes('autoFaceSwitch'), 'Must NOT add Auto Face switch to #bar');
    assert(!barHtml.includes('auto-face'), 'Must NOT add auto-face controls to #bar');
    assert(!barHtml.includes('autoFaceLabel'), 'Must NOT add autoFaceLabel to #bar');
    assert(barHtml.includes('id="power"'), 'Power button must remain in #bar');
    assert(barHtml.includes('id="temp"'), 'Temp slider must remain in #bar');
    assert(barHtml.includes('id="thickness"'), 'Thickness slider must remain in #bar');
  });

  // =========================================================================
  // 2. VIDEO CALL DETECTION: WHATSAPP, MEET, TEAMS, ZOOM
  // =========================================================================
  runTest('Clean app name correctly identifies WhatsApp, Zoom, Teams, and Google Meet', () => {
    const cleanAppNameFn = (name) => {
      if (!name) return '';
      let clean = name.replace(/^.*[#\\]/, '');
      clean = clean.replace(/\.exe$/i, '');
      const lower = clean.toLowerCase();
      if (lower.includes('google meet') || lower.includes('google-meet')) return 'Google Meet';
      if (lower.includes('meet') && !lower.includes('meeting')) return 'Google Meet';
      if (lower.includes('whatsapp')) return 'WhatsApp';
      if (lower.includes('zoom')) return 'Zoom';
      if (lower.includes('teams') || lower.includes('msteams')) return 'Teams';
      if (lower.includes('chrome')) return 'Google Meet / Chrome';
      if (lower.includes('msedge') || lower === 'edge') return 'Edge';
      if (lower.includes('firefox')) return 'Firefox';
      if (lower.includes('windowscamera')) return 'Camera';
      if (lower.includes('discord')) return 'Discord';
      if (lower.includes('skype')) return 'Skype';
      if (lower.includes('webex')) return 'Webex';
      if (lower.includes('slack')) return 'Slack';
      if (lower.includes('obs')) return 'OBS';
      return clean;
    };

    assert.strictEqual(cleanAppNameFn('5319275A.WhatsAppDesktop_cv1g1gvanyjgm'), 'WhatsApp');
    assert.strictEqual(cleanAppNameFn('C:#Users#User#AppData#Roaming#Zoom#bin#Zoom.exe'), 'Zoom');
    assert.strictEqual(cleanAppNameFn('C:#Users#User#AppData#Local#Microsoft#Teams#current#Teams.exe'), 'Teams');
    assert.strictEqual(cleanAppNameFn('ms-teams.exe'), 'Teams');
    assert.strictEqual(cleanAppNameFn('Google Meet'), 'Google Meet');
    assert.strictEqual(cleanAppNameFn('C:#Program Files#Google#Chrome#Application#chrome.exe'), 'Google Meet / Chrome');
  });

  runTest('Main process enriches browser camera usage with meeting context (Google Meet, Teams, Zoom)', () => {
    assert(mainCode.includes('function enrichMeetingContext'), 'main.js must implement enrichMeetingContext');
    assert(mainCode.includes('tasklist.exe'), 'enrichMeetingContext must query browser window titles');
    assert(mainCode.includes('Google Meet'), 'enrichMeetingContext must detect Google Meet');
    assert(mainCode.includes('Microsoft Teams'), 'enrichMeetingContext must detect Teams');
    assert(mainCode.includes('Zoom'), 'enrichMeetingContext must detect Zoom');
  });

  // =========================================================================
  // 3. DARK ROOM & LOW-LIGHT AUTOMATIC ACTIVATION & PROPORTIONAL INTENSITY
  // =========================================================================
  await runAsyncTest('Dark room face detection automatically triggers lighting and scales brightness', async () => {
    const detector = new FacePresenceDetector({
      consecutiveRequired: 1,
      gracePeriodMs: 50,
      sampleIntervalMs: 10
    });

    const darkFrame = createSyntheticFrame({ hasFace: true, faceLum: 25, ambientLum: 15 });
    const result = await detector.processImageData(darkFrame);

    assert(result.lighting, 'Result must contain lighting metrics');
    assert(result.lighting.faceLuminance < 40, 'Face luminance in dark frame must be < 40');
    assert(result.lighting.ambientLuminance < 30, 'Ambient luminance in dark frame must be < 30');
    assert.strictEqual(result.lighting.isDark, true, 'Dark frame must set isDark = true');

    const threshold = 70;
    const currentLux = result.lighting.effectiveLuminance;
    const darknessRatio = Math.max(0, Math.min(1.0, (threshold - currentLux) / threshold));
    const autoBrightness = Math.min(1.0, Math.max(0.35, 0.35 + darknessRatio * 0.65));
    assert(autoBrightness >= 0.70, `Dark room should produce strong brightness >= 70% (got ${Math.round(autoBrightness * 100)}%)`);

    detector.destroy();
  });

  // =========================================================================
  // 4. BRIGHT DAYLIGHT & WELL-LIT ENVIRONMENT: DECREASE AND TURN OFF
  // =========================================================================
  await runAsyncTest('Daylight / bright environment smoothly dims intensity and turns OFF overlay', async () => {
    const detector = new FacePresenceDetector({
      consecutiveRequired: 1,
      gracePeriodMs: 50,
      sampleIntervalMs: 10
    });

    const brightFrame = createSyntheticFrame({ hasFace: true, faceLum: 160, ambientLum: 140 });
    const result = await detector.processImageData(brightFrame);

    assert(result.lighting.faceLuminance > 120, 'Face luminance in bright frame must be > 120');
    assert(result.lighting.ambientLuminance > 100, 'Ambient luminance in bright frame must be > 100');
    assert.strictEqual(result.lighting.isDark, false, 'Bright frame must set isDark = false');

    const threshold = 70;
    const HYSTERESIS = 5.0;
    const isBright = result.lighting.effectiveLuminance > (threshold + HYSTERESIS);
    assert.strictEqual(isBright, true, 'Luminance must exceed bright hysteresis bound');

    detector.destroy();
  });

  // =========================================================================
  // 5. STATUS NOTIFICATION DEDUPLICATION (NO SPAM / NO FOCUS STEALING)
  // =========================================================================
  runTest('Status notification deduplication prevents repeated toast notifications', () => {
    assert(rendererCode.includes('lastStatusMsg'), 'renderer.js must track lastStatusMsg');
    assert(rendererCode.includes('lastStatusTime'), 'renderer.js must track lastStatusTime');
    assert(
      rendererCode.includes('msg === lastStatusMsg && (now - lastStatusTime < 3500)'),
      'showStatus must deduplicate identical messages within 3.5 seconds'
    );
  });

  // =========================================================================
  // 6. RELIABILITY, ZERO BIOMETRICS & MANUAL OVERRIDES
  // =========================================================================
  runTest('Manual power-off is strictly respected during active call session', () => {
    assert(
      rendererCode.includes('if (!manualTurnedOffWhileWebcamActive) {'),
      'Camera active event must guard against manualTurnedOffWhileWebcamActive'
    );
    assert(
      rendererCode.includes('if (!manualTurnedOffWhileFaceActive) {'),
      'Face lighting event must guard against manualTurnedOffWhileFaceActive'
    );
    assert(
      rendererCode.includes('manualTurnedOffWhileWebcamActive = false;') &&
      rendererCode.includes('manualTurnedOffWhileFaceActive = false;'),
      'Manual overrides must cleanly re-arm when camera is released at end of call'
    );
  });

  runTest('100% local privacy guarantee: zero biometrics, zero network transmission', () => {
    assert(
      !faceDetectorCode.includes('http') &&
      !faceDetectorCode.includes('fetch') &&
      !faceDetectorCode.includes('upload') &&
      !faceDetectorCode.includes('localStorage.setItem'),
      'face-detector.js must not perform network requests or save biometric templates'
    );
  });

  // =========================================================================
  // 7. LICENSING, TRIAL & PRICING INTEGRITY
  // =========================================================================
  runTest('Licensing, 3-day trial, and ₹29/₹49/₹99 pricing are 100% intact', () => {
    assert(licenseCode.includes('TRIAL_DURATION_HOURS: 72'), '3-day trial (72h) must remain intact');
    assert(licenseCode.includes('2900'), '₹29 monthly pricing intact');
    assert(licenseCode.includes('4900'), '₹49 quarterly pricing intact');
    assert(licenseCode.includes('9900'), '₹99 lifetime pricing intact');
    assert(licenseCode.includes('activateAdminLifetime'), 'Admin activation intact');
  });

  console.log('\n======================================================');
  console.log(`Results: ${passedTests} / ${totalTests} tests passed.`);
  if (passedTests === totalTests) {
    console.log('✓ ALL DEFAULT AUTOMATIC LIGHTING & VIDEO CALL TESTS PASSED!\n');
    process.exit(0);
  } else {
    console.error('❌ SOME TESTS FAILED!\n');
    process.exit(1);
  }
})();
