const os = require('node:os');

// Electron's native backdrop is available only from Windows 11 22H2 (22621).
// Older Windows needs a transparent surface for CSS alpha to reveal the desktop.
function windowStyle(platform = process.platform, release = os.release()) {
  if (platform === 'darwin') return {transparent:true,vibrancy:'under-window',visualEffectState:'active',zoomToPageWidth:false};
  if (platform === 'win32') {
    const [major,,build] = release.split('.').map(Number);
    return major >= 10 && build >= 22621
      ? {transparent:false,backgroundMaterial:'acrylic'}
      : {transparent:true};
  }
  return {transparent:true};
}
module.exports = {windowStyle};
