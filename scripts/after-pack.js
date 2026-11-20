/**
 * electron-builder afterPack hook.
 *
 * macOS on Apple silicon refuses to run code without at least an ad-hoc signature, and
 * packing (Info.plist, icons, asar) invalidates Electron's original one. When no Developer
 * ID certificate is configured (unsigned CI builds) we ad-hoc sign the whole bundle here,
 * before the DMG is created. With a real certificate electron-builder re-signs afterwards.
 */
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return; // real signing will happen
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
