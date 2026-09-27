const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

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
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await wait(1200);

  const initial = await win.webContents.executeJavaScript(`(() => {
    const power = document.getElementById('power');
    const canvas = document.getElementById('light');
    const ctx = canvas.getContext('2d');
    const pixel = Array.from(ctx.getImageData(50, 50, 1, 1).data);
    return { on: power.classList.contains('active'), pixel };
  })()`);
  console.log('INITIAL (ON):', initial);

  // Turn OFF via power button
  await win.webContents.executeJavaScript(`(() => {
    const power = document.getElementById('power');
    power.click();
  })()`);

  for (let i = 0; i < 12; i++) {
    await wait(100);
    const diag = await win.webContents.executeJavaScript(`(() => {
      const power = document.getElementById('power');
      const canvas = document.getElementById('light');
      const ctx = canvas.getContext('2d');
      // sample corner pixel (50, 50), edge pixel (200, 20), and center (640, 400)
      const pCorner = Array.from(ctx.getImageData(50, 50, 1, 1).data);
      const pEdge = Array.from(ctx.getImageData(200, 20, 1, 1).data);
      return {
        step: ${i},
        on: power.classList.contains('active'),
        pCorner,
        pEdge
      };
    })()`);
    console.log(`Step ${i} (${(i+1)*100}ms):`, diag);
  }

  app.quit();
});
