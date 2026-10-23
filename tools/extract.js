// Cuts a character out of a video (one figure on a plain background) into a frames character.
// Usage: node_modules\electron\dist\electron.exe tools\extract.js <video.mp4> [characterDir]
// Output: <characterDir>/frames/f000.webp ... and, if missing, a starter character.json whose
// clips you then set per state (frame index = seconds * 10). characterDir defaults to
// ~/.agent-buddy/characters/<video name>.

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const args = process.argv.slice(1);
const video = args.find((a) => /\.(mp4|mov|webm|mkv)$/i.test(a));
if (!video) { console.error('usage: electron tools/extract.js <video> [characterDir]'); process.exit(1); }
const charDir = args[args.indexOf(video) + 1]
  || path.join(os.homedir(), '.agent-buddy', 'characters', path.basename(video, path.extname(video)));
const outDir = path.join(charDir, 'frames');

app.whenReady().then(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false } });
  ipcMain.on('frame', (_e, i, buf) => fs.writeFileSync(path.join(outDir, `f${String(i).padStart(3, '0')}.webp`), Buffer.from(buf)));
  ipcMain.on('log', (_e, msg) => console.log(msg));
  ipcMain.on('done', (_e, manifest) => {
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
    console.log(`Wrote ${manifest.count} frames (${manifest.width}x${manifest.height}) to ${outDir}`);
    const charFile = path.join(charDir, 'character.json');
    if (!fs.existsSync(charFile)) {
      fs.writeFileSync(charFile, JSON.stringify({
        name: path.basename(charDir), kind: 'frames', height: 220,
        frames: { count: manifest.count, fps: manifest.fps, file: 'frames/f###.webp' },
        clips: { idle: { frames: [0, manifest.count - 1], mode: 'loop' } },
      }, null, 2));
      console.log(`Wrote ${charFile}: add a clip for each state (see README).`);
    }
    app.quit();
  });
  ipcMain.on('fail', (_e, msg) => { console.error(msg); app.exit(1); });
  win.loadFile(path.join(__dirname, 'extract.html'), { query: { src: pathToFileURL(path.resolve(video)).href } });
});
