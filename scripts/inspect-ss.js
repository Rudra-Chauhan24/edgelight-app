const { app, nativeImage } = require('electron');

app.whenReady().then(() => {
  const imgPath = 'C:\\Users\\shani\\.gemini\\antigravity-ide\\brain\\19b1cebb-08a1-435b-9e29-379671d60e14\\.user_uploaded\\media_1789791697207.png';
  const img = nativeImage.createFromPath(imgPath);
  const size = img.getSize();
  console.log('Image size:', size);
  const buf = img.toBitmap();
  console.log('Bitmap buffer length:', buf.length);

  function getPixel(x, y) {
    const idx = (y * size.width + x) * 4;
    return { r: buf[idx + 2], g: buf[idx + 1], b: buf[idx], a: buf[idx + 3] };
  }

  for (let y = 0; y < 100; y += 10) {
    console.log('x=10, y=' + y + ':', getPixel(10, y));
  }
  for (let x = 0; x < 100; x += 10) {
    console.log('x=' + x + ', y=10:', getPixel(x, 10));
  }
  for (let x = 400; x < 500; x += 20) {
    console.log('x=' + x + ', y=10 (top border):', getPixel(x, 10));
    console.log('x=' + x + ', y=40 (top band):', getPixel(x, 40));
  }

  app.quit();
});
