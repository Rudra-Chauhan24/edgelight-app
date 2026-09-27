const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const artifactsDir = 'C:\\Users\\shani\\.gemini\\antigravity-ide\\brain\\19b1cebb-08a1-435b-9e29-379671d60e14';

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
    backgroundColor: '#0c0c0e', // subtle dark backdrop to make the edge illumination crisp and clear
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(1200);

  // 1. Capture dock with cute animations, micro-icons, candy sliders, and breathing power button
  await win.webContents.executeJavaScript(`(() => {
    const bar = document.getElementById('bar');
    bar.classList.add('visible');
  })()`);
  await wait(500);
  const imgDock = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, 'screenshot_dock_cute.png'), imgDock.toPNG());
  console.log('Saved screenshot_dock_cute.png');

  // 2. Toggle Auto (camera) ON to verify the poppily animated threshold bar
  await win.webContents.executeJavaScript(`(() => {
    const autoSwitch = document.getElementById('autoSwitch');
    autoSwitch.setAttribute('aria-checked', 'true');
    const thresholdWrap = document.getElementById('thresholdWrap');
    thresholdWrap.classList.add('active');
  })()`);
  await wait(600);
  const imgThreshold = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, 'screenshot_threshold_popped.png'), imgThreshold.toPNG());
  console.log('Saved screenshot_threshold_popped.png');

  // 3. Warm temperature (amber/yellow): verify golden border with luminous white center core
  await win.webContents.executeJavaScript(`(() => {
    const tempInput = document.getElementById('temp');
    tempInput.value = 0; // warmest golden yellow
    tempInput.dispatchEvent(new Event('input', { bubbles: true }));
    const thickness = document.getElementById('thickness');
    thickness.value = 100;
    thickness.dispatchEvent(new Event('input', { bubbles: true }));
    const brightness = document.getElementById('brightness');
    brightness.value = 100;
    brightness.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(700);
  const imgWarmBiColor = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, 'screenshot_warm_bicolor.png'), imgWarmBiColor.toPNG());
  console.log('Saved screenshot_warm_bicolor.png');

  // 4. Low brightness (25%): verify that brightness changes opacity while thickness remains 100px
  await win.webContents.executeJavaScript(`(() => {
    const brightness = document.getElementById('brightness');
    brightness.value = 25; // low brightness / opacity
    brightness.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(700);
  const imgLowBrightness = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, 'screenshot_low_brightness_opacity.png'), imgLowBrightness.toPNG());
  console.log('Saved screenshot_low_brightness_opacity.png');

  // 5. Cursor Hole: simulate cursor near the top border to demonstrate 0% hardness feathered dissipation
  await win.webContents.executeJavaScript(`(() => {
    const brightness = document.getElementById('brightness');
    brightness.value = 100;
    brightness.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 20 }));
  })()`);
  await wait(600);
  const imgCursorHole = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, 'screenshot_cursor_hole_0hardness.png'), imgCursorHole.toPNG());
  console.log('Saved screenshot_cursor_hole_0hardness.png');

  console.log('All verification captures completed successfully!');
  app.quit();
});
