// Renders the placeholder robot's head (assets/placeholder/buddy.svg) into build/icon.png,
// the 512px app icon electron-builder turns into the Windows .ico.
// Usage: node_modules\electron\dist\electron.exe tools\make-icon.js

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZE = 512;
const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'placeholder', 'buddy.svg'), 'utf8');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<canvas id=c></canvas>');
  const png = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.getElementById('c'); c.width = c.height = ${SIZE};
      const g = c.getContext('2d');
      // the head and antenna fill x 22-118, y 3-106 of the 140x240 viewBox (drawn at 2x)
      g.drawImage(img, 32, 2, 216, 216, ${SIZE * 0.03}, ${SIZE * 0.03}, ${SIZE * 0.94}, ${SIZE * 0.94});
      resolve(c.toDataURL('image/png'));
    };
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
  })`);
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log('Wrote', out);
  app.quit();
});
