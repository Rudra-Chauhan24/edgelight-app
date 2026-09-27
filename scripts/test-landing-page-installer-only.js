const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('🧪 Testing Landing Page: Installer Setup Only & No Portable References...\n');

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

const landingHtmlPath = path.join(__dirname, '../landing-page/index.html');
const landingDir = path.join(__dirname, '../landing-page');
const setupExePath = path.join(landingDir, 'Edge Light Setup 1.0.6.exe');
const portableExePath = path.join(landingDir, 'Edge Light 1.0.6.exe');

// 1. Check executable presence in landing-page directory
it('Edge Light Setup 1.0.6.exe exists and is over 50MB in landing-page', () => {
  assert(fs.existsSync(setupExePath), 'Edge Light Setup 1.0.6.exe does not exist in landing-page');
  const stat = fs.statSync(setupExePath);
  assert(stat.size > 50 * 1024 * 1024, `Size ${stat.size} is less than 50MB`);
});

it('No portable executable exists in landing-page', () => {
  assert(!fs.existsSync(portableExePath), 'Portable executable Edge Light 1.0.6.exe should not exist in landing-page');
});

// 2. Check HTML content
const html = fs.readFileSync(landingHtmlPath, 'utf8');

it('Landing page has ZERO occurrences of "portable" (case-insensitive)', () => {
  const matches = html.match(/portable/gi);
  assert.strictEqual(matches, null, `Found portable occurrences: ${matches}`);
});

it('All download buttons link exclusively to Edge Light Setup 1.0.6.exe', () => {
  // Regex to find all href attributes on <a> tags with download attribute
  const downloadTags = html.match(/<a\s+[^>]*download[^>]*>/gi) || [];
  assert(downloadTags.length >= 3, `Expected at least 3 download buttons, found ${downloadTags.length}`);

  downloadTags.forEach((tag) => {
    assert(
      tag.includes('href="Edge Light Setup 1.0.6.exe"') || tag.includes("href='Edge Light Setup 1.0.6.exe'"),
      `Download button does not point to Edge Light Setup 1.0.6.exe: ${tag}`
    );
    assert(
      tag.includes('download="Edge Light Setup 1.0.6.exe"') || tag.includes("download='Edge Light Setup 1.0.6.exe'") || tag.includes('download'),
      `Download tag missing download attribute: ${tag}`
    );
  });
});

it('Hero section has only one primary installer download button', () => {
  assert(html.includes('id="btnDownloadInstaller"'), 'Missing #btnDownloadInstaller');
  assert(!html.includes('id="btnDownloadPortable"'), 'Old #btnDownloadPortable still present');
});

it('Installation section focuses solely on Windows Setup Installer', () => {
  assert(html.includes('Windows Installer (NSIS Setup)'), 'Missing NSIS Setup title in install guide');
  assert(!html.includes('Standalone Portable'), 'Old Standalone Portable title still present');
});

it('Navbar and footer version badges show v1.0.6', () => {
  assert(html.includes('v1.0.6'), 'Missing v1.0.6');
  assert(!html.includes('v1.0.4'), 'Old v1.0.4 still present');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
