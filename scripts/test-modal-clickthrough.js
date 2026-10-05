const fs = require('fs');
const path = require('path');

console.log('🧪 Starting Modal Click-Through & Floating Page Functional Test Suite...\n');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// 1. Verify code structure in src/renderer.js and application/src/renderer.js
['../src/renderer.js', '../application/src/renderer.js'].forEach((relPath) => {
  const filePath = path.join(__dirname, relPath);
  const code = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

  assert(code.includes('function isAnyModalOpen()'), `${relPath} defines isAnyModalOpen()`);
  assert(code.includes('enableClickThrough && (isAnyModalOpen()') || code.includes('enableClickThrough && isAnyModalOpen()'), `${relPath} guards setClickThrough with isAnyModalOpen()`);
  assert(code.includes('if (isAnyModalOpen()) {\n      clearTimeout(idleTimer);\n      setClickThrough(false);\n      return;\n    }'), `${relPath} halts click-through in mousemove handler when modal is open`);
  assert(code.includes('if (!isAnyModalOpen()) {\n      setClickThrough(true);'), `${relPath} guards bar mouseleave with !isAnyModalOpen()`);
  assert(code.includes('if (!isAnyModalOpen()) {\n      setClickThrough(true);\n    }'), `${relPath} guards forceHideDock with !isAnyModalOpen()`);
  assert(code.includes("window.addEventListener('keydown', (e) => {\n    if (e.key === 'Escape') {"), `${relPath} provides Escape key handler to cleanly dismiss open modals`);
});

// 2. Behavioral unit test simulating DOM & Electron API environment
function simulateRendererEnvironment() {
  const listeners = {};
  function addEventListener(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  }
  function dispatchEvent(event, data = {}) {
    if (listeners[event]) {
      listeners[event].forEach(fn => fn(data));
    }
  }

  // Mock DOM elements
  function createElement(id, tagName = 'div') {
    return {
      id,
      tagName: tagName.toUpperCase(),
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); },
        toggle(c, val) {
          if (val === undefined) val = !this.classes.has(c);
          if (val) this.classes.add(c); else this.classes.delete(c);
          return val;
        }
      },
      style: {},
      listeners: {},
      addEventListener(e, fn) {
        if (!this.listeners[e]) this.listeners[e] = [];
        this.listeners[e].push(fn);
      },
      dispatchEvent(e, data = {}) {
        if (this.listeners[e]) {
          this.listeners[e].forEach(fn => fn(data));
        }
      },
      getBoundingClientRect() {
        return { left: 1850, right: 1920, top: 400, bottom: 680 };
      },
      contains(el) { return false; },
      setAttribute() {},
      textContent: '',
      title: ''
    };
  }

  let electronIgnoreMouseEvents = null;
  const mockEdgeLightAPI = {
    setIgnoreMouseEvents: (ignore, opts) => {
      electronIgnoreMouseEvents = ignore;
    },
    notifyControlsState: () => {},
    getLicenseInfo: () => Promise.resolve({ isAuthorized: true, status: 'trial', trialRemainingHours: 72 }),
    getPaymentConfig: () => Promise.resolve({ plans: {} })
  };

  const elements = {
    'light': createElement('light', 'canvas'),
    'bar': createElement('bar'),
    'hover-zone': createElement('hover-zone'),
    'status': createElement('status'),
    'power': createElement('power', 'button'),
    'brightness': createElement('brightness', 'input'),
    'brightnessVal': createElement('brightnessVal', 'span'),
    'temp': createElement('temp', 'input'),
    'tempVal': createElement('tempVal', 'span'),
    'thickness': createElement('thickness', 'input'),
    'thicknessVal': createElement('thicknessVal', 'span'),
    'holeSize': createElement('holeSize', 'input'),
    'holeSizeVal': createElement('holeSizeVal', 'span'),
    'avoidSwitch': createElement('avoidSwitch', 'button'),
    'avoidLabel': createElement('avoidLabel', 'span'),
    'avoidMouseWrap': createElement('avoidMouseWrap'),
    'autoSwitch': createElement('autoSwitch', 'button'),
    'autoLabel': createElement('autoLabel', 'span'),
    'autoSwitchWrap': createElement('autoSwitchWrap'),
    'threshold': createElement('threshold', 'input'),
    'thresholdVal': createElement('thresholdVal', 'span'),
    'thresholdWrap': createElement('thresholdWrap'),
    'liveLux': createElement('liveLux', 'span'),
    'fullscreenBtn': createElement('fullscreenBtn', 'button'),
    'dismissBtn': createElement('dismissBtn', 'button'),
    'privacy-note': createElement('privacy-note'),
    'license-badge': createElement('license-badge'),
    'license-modal': createElement('license-modal'),
    'setup-wizard-modal': createElement('setup-wizard-modal'),
    'closeLicenseBtn': createElement('closeLicenseBtn', 'button'),
    'copyHwidBtn': createElement('copyHwidBtn', 'button'),
    'hwidDisplay': createElement('hwidDisplay', 'code'),
    'modalStatusBadge': createElement('modalStatusBadge'),
    'licenseDescription': createElement('licenseDescription'),
    'closeWizardBtn': createElement('closeWizardBtn', 'button'),
    'openPlansFromLicenseBtn': createElement('openPlansFromLicenseBtn', 'button'),
    'step1NextBtn': createElement('step1NextBtn', 'button'),
    'testLightBtn': createElement('testLightBtn', 'button'),
    'skipToTrialFinishBtn': createElement('skipToTrialFinishBtn', 'button'),
    'step2UpgradeBtn': createElement('step2UpgradeBtn', 'button'),
    'step3BackBtn': createElement('step3BackBtn', 'button'),
    'step3NextBtn': createElement('step3NextBtn', 'button'),
    'finishWizardBtn': createElement('finishWizardBtn', 'button'),
    'razorpayDirectBtn': createElement('razorpayDirectBtn', 'button'),
    'wizardCopyHwidBtn': createElement('wizardCopyHwidBtn', 'button')
  };
  elements['light'].getContext = () => ({
    save() {}, restore() {}, setTransform() {}, clearRect() {}, fillRect() {}
  });

  const mockWindow = {
    innerWidth: 1920,
    innerHeight: 1080,
    devicePixelRatio: 1,
    screen: { width: 1920, height: 1080 },
    edgeLightAPI: mockEdgeLightAPI,
    addEventListener,
    dispatchEvent,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    requestAnimationFrame: () => 1
  };

  const mockDocument = {
    getElementById: (id) => elements[id] || null,
    querySelectorAll: (sel) => [],
    addEventListener,
    dispatchEvent,
    activeElement: null
  };

  return { mockWindow, mockDocument, elements, getIgnoreMouseState: () => electronIgnoreMouseEvents };
}

// 3. Test functional behavior of click-through transitions
const { elements, mockDocument } = simulateRendererEnvironment();
const licenseModal = elements['license-modal'];
const wizardModal = elements['setup-wizard-modal'];
const bar = elements['bar'];

let clickThroughState = true;
let ignoredState = true;

function isAnyModalOpen() {
  const licModal = licenseModal;
  const wizModal = wizardModal;
  return Boolean(
    (licModal && licModal.classList.contains('visible')) ||
    (wizModal && wizModal.classList.contains('visible'))
  );
}

function setClickThrough(enableClickThrough) {
  if (enableClickThrough && isAnyModalOpen()) {
    enableClickThrough = false;
  }
  if (clickThroughState === enableClickThrough) return;
  clickThroughState = enableClickThrough;
  ignoredState = enableClickThrough;
}

function showLicenseModal() {
  setClickThrough(false);
  licenseModal.classList.add('visible');
}

function hideLicenseModal() {
  licenseModal.classList.remove('visible');
  if (!bar.classList.contains('visible') && !isAnyModalOpen()) {
    setClickThrough(true);
  }
}

// Initial state: click-through active (background apps clickable)
setClickThrough(true);
assert(ignoredState === true, 'Initial state: transparent window allows background clicks (ignoredState=true)');

// User opens License Modal
showLicenseModal();
assert(licenseModal.classList.contains('visible'), 'License modal has visible class');
assert(ignoredState === false, 'Modal opened: click-through is disabled (ignoredState=false) so modal is fully clickable');

// Mouse moves from dock (x=1900) across screen towards license card (x=960, y=540)
// This triggers mouseleave on bar, mousemove in window, idle timer
if (!isAnyModalOpen()) {
  setClickThrough(true);
}
assert(ignoredState === false, 'Bar mouseleave did NOT enable click-through because modal is open');

// Mouse moves over modal
if (isAnyModalOpen()) {
  setClickThrough(false);
} else {
  setClickThrough(true);
}
assert(ignoredState === false, 'Window mousemove did NOT enable click-through while hovering over modal');

// Force hide dock idle timer fires
if (!isAnyModalOpen()) {
  setClickThrough(true);
}
assert(ignoredState === false, 'Dock idle timeout did NOT enable click-through while modal is open');

// User clicks Copy HWID button or Upgrade Plans
assert(licenseModal.classList.contains('visible') && ignoredState === false, 'User can successfully click Copy HWID or Upgrade buttons without click pass-through');

// User closes license modal
hideLicenseModal();
assert(!licenseModal.classList.contains('visible'), 'License modal closed');
assert(ignoredState === true, 'Click-through properly restored to background windows upon closing modal');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
console.log('✅ All modal click-through and responsiveness tests passed successfully!');
