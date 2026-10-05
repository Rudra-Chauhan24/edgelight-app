const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 Starting Landing Page Buttons & Interactivity Test Suite...\n');

let passed = 0;
let failed = 0;

function it(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

const landingDir = path.join(__dirname, '../landing-page');
const html = fs.readFileSync(path.join(landingDir, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(landingDir, 'landing.js'), 'utf8');
const css = fs.readFileSync(path.join(landingDir, 'landing.css'), 'utf8');

// 1. Check all navigation links
it('Navbar has all 4 primary section links: Features, Pricing, Installation, FAQ', () => {
  assert(html.includes('href="#features" class="nav-link"'), 'Missing #features link in nav');
  assert(html.includes('href="#pricing" class="nav-link"'), 'Missing #pricing link in nav');
  assert(html.includes('href="#install" class="nav-link"'), 'Missing #install link in nav');
  assert(html.includes('href="#faq" class="nav-link"'), 'Missing #faq link in nav');
});

// 2. Check footer navigation links
it('Footer contains Pricing link alongside Features, Installation, and FAQ', () => {
  assert(html.includes('<a href="#pricing">Pricing</a>'), 'Missing #pricing in footer links');
});

// 3. Check Announcement Pill Link
it('Announcement pill is a functional anchor pointing to #features', () => {
  assert(html.includes('<a href="#features" class="pill-announcement"'), 'Pill announcement should be a functional anchor link to #features');
});

// 4. Check Hero Action Buttons
it('Hero contains primary installer button and secondary Explore Features link', () => {
  assert(html.includes('id="btnDownloadInstaller"'), 'Missing #btnDownloadInstaller');
  assert(html.includes('href="#features" class="btn btn-lg btn-secondary"'), 'Missing secondary Explore Features button');
});

// 5. Check Pricing Buttons
it('All 3 pricing tiers have functional rzp-pay-btn buttons with data attributes', () => {
  assert(html.includes('data-plan="monthly"'), 'Missing monthly plan button');
  assert(html.includes('data-plan="quarterly"'), 'Missing quarterly plan button');
  assert(html.includes('data-plan="lifetime"'), 'Missing lifetime plan button');
  const count = (html.match(/rzp-pay-btn/g) || []).length;
  assert(count === 3, `Expected 3 rzp-pay-btn buttons, found ${count}`);
});

// 6. Check UPI Instant Copy
it('UPI banner has copyable code with #copyUpiCode and class copy-upi', () => {
  assert(html.includes('id="copyUpiCode"'), 'Missing #copyUpiCode in UPI banner');
  assert(html.includes('class="copy-upi"'), 'Missing class="copy-upi"');
});

// 7. Check landing.js functionality
it('landing.js implements universal smooth scroll with back-to-top handler', () => {
  assert(js.includes('initSmoothScroll'), 'landing.js missing initSmoothScroll');
  assert(js.includes("anchor.getAttribute('href')"), 'landing.js missing anchor href lookup');
  assert(js.includes("window.scrollTo({ top: 0, behavior: 'smooth' })"), 'landing.js missing back-to-top scroll');
});

it('landing.js implements single-open FAQ accordion', () => {
  assert(js.includes('initFAQ'), 'landing.js missing initFAQ');
  assert(js.includes('faq-accordion details'), 'landing.js missing faq-accordion selector');
});

it('landing.js implements download feedback toast', () => {
  assert(js.includes('initDownloadFeedback'), 'landing.js missing initDownloadFeedback');
  assert(js.includes('showToast'), 'landing.js missing showToast');
});

it('landing.js implements copy UPI ID to clipboard', () => {
  assert(js.includes('initCopyUPI'), 'landing.js missing initCopyUPI');
  assert(js.includes('navigator.clipboard.writeText'), 'landing.js missing clipboard writeText');
});

it('landing.js implements fault-tolerant Razorpay checkout with link fallback', () => {
  assert(js.includes('initRazorpayCheckout'), 'landing.js missing initRazorpayCheckout');
  assert(js.includes('new Razorpay(options)'), 'landing.js missing new Razorpay(options)');
  assert(js.includes('window.open(targetUrl, \'_blank\')'), 'landing.js missing window.open fallback');
});

// 8. Check CSS styling for buttons and layout
it('landing.css sets scroll-margin-top for anchor navigation below sticky navbar', () => {
  assert(css.includes('scroll-margin-top: 84px'), 'landing.css missing scroll-margin-top for sticky navbar offset');
});

it('landing.css sets active state on .btn and .pill-announcement for tactile feedback', () => {
  assert(css.includes('.btn:active'), 'landing.css missing .btn:active');
  assert(css.includes('.pill-announcement:active'), 'landing.css missing .pill-announcement:active');
});

it('landing.css styles .copy-upi code with interactive hover', () => {
  assert(css.includes('.upi-banner-left code:hover'), 'landing.css missing .upi-banner-left code:hover');
});

// 9. Check executable availability in both locations
it('Edge.Light.Setup.1.0.15.exe exists in both landing-page and root', () => {
  const rootExe = path.join(__dirname, '../Edge.Light.Setup.1.0.15.exe');
  const landingExe = path.join(landingDir, 'Edge.Light.Setup.1.0.15.exe');
  assert(fs.existsSync(rootExe), 'Missing Edge.Light.Setup.1.0.15.exe in root');
  assert(fs.existsSync(landingExe), 'Missing Edge.Light.Setup.1.0.15.exe in landing-page');
  assert(fs.statSync(rootExe).size > 50 * 1024 * 1024, 'Root exe size is too small');
  assert(fs.statSync(landingExe).size > 50 * 1024 * 1024, 'Landing page exe size is too small');
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
console.log('✅ All landing page button and functionality tests passed successfully!');
