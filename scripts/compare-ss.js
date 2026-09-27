const { app, nativeImage } = require('electron');

app.whenReady().then(() => {
  const p1 = 'C:\\Users\\shani\\.gemini\\antigravity-ide\\brain\\19b1cebb-08a1-435b-9e29-379671d60e14\\.user_uploaded\\media_1789707465312.png';
  const p2 = 'C:\\Users\\shani\\.gemini\\antigravity-ide\\brain\\19b1cebb-08a1-435b-9e29-379671d60e14\\.user_uploaded\\media_1789791697207.png';

  const img1 = nativeImage.createFromPath(p1);
  const img2 = nativeImage.createFromPath(p2);

  console.log('Img1 size:', img1.getSize());
  console.log('Img2 size:', img2.getSize());

  const b1 = img1.toBitmap();
  const b2 = img2.toBitmap();

  function p(buf, size, x, y) {
    const idx = (y * size.width + x) * 4;
    return [buf[idx + 2], buf[idx + 1], buf[idx]];
  }

  const s1 = img1.getSize();
  const s2 = img2.getSize();

  console.log('IMG1 (when light was ON):');
  console.log('  Top border (500, 15):', p(b1, s1, 500, 15));
  console.log('  Top band center (500, 45):', p(b1, s1, 500, 45));
  console.log('  Left border (15, 300):', p(b1, s1, 15, 300));
  console.log('  Power button (273, 580):', p(b1, s1, 273, 580));

  console.log('IMG2 (when user turned OFF):');
  console.log('  Top border (500, 15):', p(b2, s2, 500, 15));
  console.log('  Top band center (500, 45):', p(b2, s2, 500, 45));
  console.log('  Left border (15, 300):', p(b2, s2, 15, 300));
  console.log('  Power button (273, 580):', p(b2, s2, 273, 580));

  app.quit();
});
