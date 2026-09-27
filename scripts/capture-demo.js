const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const artifactsDir = 'C:\\Users\\shani\\.gemini\\antigravity-ide\\brain\\5f06de1e-594c-485d-ad9e-91df4d875c1e';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(1200);

  // Set warm amber and hide dock for pure full-screen light demo
  await win.webContents.executeJavaScript(`(() => {
    const tempInput = document.getElementById('temp');
    tempInput.value = 0; // Warm amber matching user photo
    tempInput.dispatchEvent(new Event('input'));
    const bar = document.getElementById('bar');
    bar.classList.remove('visible');

    // Create a mock video call window in center to match the user's exact photo
    const mockCall = document.createElement('div');
    mockCall.id = 'mockCall';
    mockCall.style.position = 'absolute';
    mockCall.style.left = '160px';
    mockCall.style.top = '110px';
    mockCall.style.right = '160px';
    mockCall.style.bottom = '140px';
    mockCall.style.borderRadius = '16px';
    mockCall.style.background = 'linear-gradient(145deg, #1e2026, #14161a)';
    mockCall.style.border = '1px solid rgba(255,255,255,0.08)';
    mockCall.style.boxShadow = '0 20px 50px rgba(0,0,0,0.6)';
    mockCall.style.display = 'flex';
    mockCall.style.flexDirection = 'column';
    mockCall.style.alignItems = 'center';
    mockCall.style.justifyContent = 'center';
    mockCall.style.zIndex = '0';
    mockCall.innerHTML = \`
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: rgba(255,255,255,0.7); font-size: 16px; margin-bottom: 12px; font-weight: 500;">
        Video Call &bull; Edge Light Active
      </div>
      <div style="width: 120px; height: 120px; border-radius: 60px; background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.1);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </div>
    \`;
    document.body.insertBefore(mockCall, document.getElementById('light'));
  })()`);

  await wait(700);

  const imgMatch = await win.webContents.capturePage();
  fs.writeFileSync(path.join(artifactsDir, 'screenshot_macbook_edge_light_match.png'), imgMatch.toPNG());
  console.log('Saved screenshot_macbook_edge_light_match.png');

  app.quit();
});
