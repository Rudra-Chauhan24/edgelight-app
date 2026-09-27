const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const artifactDir = 'C:\\Users\\shani\\.gemini\\antigravity-ide\\brain\\30e3388e-c77a-4cb2-a488-9153d74fcd51';

ipcMain.handle('get-app-version', () => '1.0.3');
ipcMain.handle('toggle-fullscreen', () => false);
ipcMain.handle('is-fullscreen', () => false);
ipcMain.on('set-ignore-mouse-events', () => {});
ipcMain.on('light-state-changed', () => {});
ipcMain.on('controls-visibility-changed', () => {});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: '#121214',
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(800);

  // Test custom drawing in canvas
  const res = await win.webContents.executeJavaScript(`(() => {
    const canvas = document.getElementById('light');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Helper squircle
    const SQUIRCLE_N = 2.7;
    const SQUIRCLE_INV = 2 / SQUIRCLE_N;
    const SQUIRCLE_STEPS = 48;
    function squircle(path, x, y, w, h, r) {
      r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
      if (r <= 0 || w <= 0 || h <= 0) {
        if (w > 0 && h > 0) path.rect(x, y, w, h);
        return;
      }
      const corners = [
        [x + w - r, y + r,     -Math.PI / 2,  0             ],
        [x + w - r, y + h - r,  0,             Math.PI / 2  ],
        [x + r,     y + h - r,  Math.PI / 2,   Math.PI      ],
        [x + r,     y + r,      Math.PI,       3 * Math.PI / 2],
      ];
      let first = true;
      for (const [cx, cy, t0, t1] of corners) {
        for (let i = 0; i <= SQUIRCLE_STEPS; i++) {
          const t    = t0 + (t1 - t0) * i / SQUIRCLE_STEPS;
          const cosT = Math.cos(t);
          const sinT = Math.sin(t);
          const px = cx + (cosT >= 0 ? 1 : -1) * Math.pow(Math.abs(cosT), SQUIRCLE_INV) * r;
          const py = cy + (sinT >= 0 ? 1 : -1) * Math.pow(Math.abs(sinT), SQUIRCLE_INV) * r;
          if (first) { path.moveTo(px, py); first = false; }
          else        path.lineTo(px, py);
        }
      }
      path.closePath();
    }

    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const margin = 3;
    const outerX = margin;
    const outerY = margin;
    const outerW = sw - margin * 2;
    const outerH = sh - margin * 2;
    const outerR = Math.min(Math.max(Math.round(Math.min(outerW, outerH) * 0.21), 16), Math.min(outerW, outerH) / 2);

    const thick = 96;
    const innerX = outerX + thick;
    const innerY = outerY + thick;
    const innerW = outerW - thick * 2;
    const innerH = outerH - thick * 2;
    const innerR = Math.max(2, outerR - thick);

    // Warm studio color (3744K):
    const r = 255, g = 210, b = 135;
    const masterOpacity = 1.0;

    // Clear canvas
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ── METHOD: Crisp Outer Edge, Soft Diffused Inner Edge, Pure 3744K Single Color
    // 1. Clip strictly to outer squircle so outer boundary is 100% crisp
    ctx.save();
    const clipOuter = new Path2D();
    squircle(clipOuter, outerX, outerY, outerW, outerH, outerR);
    ctx.clip(clipOuter);

    // 2. Solid Core (outer 45% of thickness - near bezel)
    const coreSolidThick = Math.round(thick * 0.45);
    const csInnerX = outerX + coreSolidThick;
    const csInnerY = outerY + coreSolidThick;
    const csInnerW = outerW - coreSolidThick * 2;
    const csInnerH = outerH - coreSolidThick * 2;
    const csInnerR = Math.max(2, outerR - coreSolidThick);

    const solidPath = new Path2D();
    squircle(solidPath, outerX - 10, outerY - 10, outerW + 20, outerH + 20, outerR + 10);
    squircle(solidPath, csInnerX, csInnerY, csInnerW, csInnerH, csInnerR);
    ctx.fillStyle = \`rgba(\${r},\${g},\${b},\${masterOpacity * 0.95})\`;
    ctx.fill(solidPath, 'evenodd');

    // 3. Soft Inner Falloff: blurred band extending from core through inner edge
    // This creates a silky smooth Gaussian dissolution inward with zero hard border line
    const innerFeatherBlur = Math.round(thick * 0.32); // ~30px blur
    const featherPath = new Path2D();
    squircle(featherPath, outerX - 10, outerY - 10, outerW + 20, outerH + 20, outerR + 10);
    squircle(featherPath, innerX, innerY, innerW, innerH, innerR);

    ctx.filter = \`blur(\${innerFeatherBlur}px)\`;
    ctx.fillStyle = \`rgba(\${r},\${g},\${b},\${masterOpacity * 0.92})\`;
    ctx.fill(featherPath, 'evenodd');
    ctx.filter = 'none';

    // 4. Secondary soft ambient wash inward
    const washBlur = Math.round(thick * 0.50); // ~48px deep soft blur
    const washInnerX = innerX + Math.round(thick * 0.15);
    const washInnerY = innerY + Math.round(thick * 0.15);
    const washInnerW = outerW - (washInnerX - outerX) * 2;
    const washInnerH = outerH - (washInnerY - outerY) * 2;
    const washInnerR = Math.max(2, outerR - (washInnerX - outerX));

    const washPath = new Path2D();
    squircle(washPath, outerX - 10, outerY - 10, outerW + 20, outerH + 20, outerR + 10);
    squircle(washPath, washInnerX, washInnerY, washInnerW, washInnerH, washInnerR);
    ctx.filter = \`blur(\${washBlur}px)\`;
    ctx.fillStyle = \`rgba(\${r},\${g},\${b},\${masterOpacity * 0.40})\`;
    ctx.fill(washPath, 'evenodd');
    ctx.filter = 'none';

    ctx.restore(); // restores clip
    return true;
  })()`);

  await wait(300);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactDir, 'render_soft_inner_test.png'), img.toPNG());
  console.log('Saved render_soft_inner_test.png');
  app.quit();
});
