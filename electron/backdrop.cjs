// Is the desktop behind the ChemEZ wordmark light or dark? The window is transparent, so
// the page cannot see it: read the wallpaper (macOS), shrink it with sips, and average the
// luminance of the patch behind the logo. No screen-recording permission is needed.
const { execFile } = require('node:child_process');
const { nativeImage, screen } = require('electron');
const os = require('node:os');
const path = require('node:path');
const run = (file, args) => new Promise(resolve => execFile(file, args, {timeout:5000}, (error, stdout) => resolve(error ? '' : stdout.trim())));
const SIZE = 48;
// The app darkens the wallpaper (40% black ambient layer plus the HUD material), so only
// clearly bright wallpapers make the mark's patch read as light.
const LIGHT = 0.72;
let cached = {path:'', bitmap:null};

async function wallpaper() {
  const file = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', "ObjC.import('AppKit');$.NSWorkspace.sharedWorkspace.desktopImageURLForScreen($.NSScreen.mainScreen).path.js"]);
  if (!file) return null;
  if (file !== cached.path) {
    const out = path.join(os.tmpdir(), 'chemez-wallpaper.png');
    await run('/usr/bin/sips', ['-s', 'format', 'png', '-z', String(SIZE), String(SIZE), file, '--out', out]);
    const image = nativeImage.createFromPath(out);
    cached = {path:file, bitmap:image.isEmpty() ? null : image.toBitmap()};
  }
  return cached.bitmap;
}

async function backdrop(window) {
  if (process.platform !== 'darwin' || !window || window.isDestroyed()) return 'dark';
  const bitmap = await wallpaper();
  if (!bitmap) return 'dark';
  const bounds = window.getBounds(), display = screen.getDisplayMatching(bounds).bounds;
  // The wordmark sits about 20–150 px right and 20–70 px down from the window corner.
  const x0 = (bounds.x + 20 - display.x) / display.width, x1 = (bounds.x + 150 - display.x) / display.width;
  const y0 = (bounds.y + 20 - display.y) / display.height, y1 = (bounds.y + 70 - display.y) / display.height;
  let sum = 0, count = 0;
  for (let y = Math.max(0, Math.floor(y0 * SIZE)); y <= Math.min(SIZE - 1, Math.floor(y1 * SIZE)); y++)
    for (let x = Math.max(0, Math.floor(x0 * SIZE)); x <= Math.min(SIZE - 1, Math.floor(x1 * SIZE)); x++) {
      const i = (y * SIZE + x) * 4; // BGRA
      sum += (0.0722 * bitmap[i] + 0.7152 * bitmap[i + 1] + 0.2126 * bitmap[i + 2]) / 255;
      count++;
    }
  return count && sum / count > LIGHT ? 'light' : 'dark';
}

// Sends 'light' or 'dark' to the page when it changes: on load, move, resize, focus, and
// every 30 s (the wallpaper may rotate).
function watchBackdrop(window, send) {
  let last, timer;
  const check = () => backdrop(window).then(value => {if (value !== last) {last = value; send(value);}}).catch(() => {});
  const soon = () => {clearTimeout(timer); timer = setTimeout(check, 250);};
  window.on('moved', soon); window.on('resize', soon); window.on('focus', soon);
  window.webContents.on('did-finish-load', () => {last = undefined; check();});
  const interval = setInterval(check, 30000);
  window.on('closed', () => {clearInterval(interval); clearTimeout(timer);});
}
module.exports = {watchBackdrop};
