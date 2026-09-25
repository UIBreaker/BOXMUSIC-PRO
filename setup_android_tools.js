const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TOOLCHAIN_DIR = path.join(__dirname, 'android-toolchain');
if (!fs.existsSync(TOOLCHAIN_DIR)) {
  fs.mkdirSync(TOOLCHAIN_DIR, { recursive: true });
}

async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) {
    console.log(`Already downloaded: ${path.basename(destPath)}`);
    return;
  }
  console.log(`Downloading ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  console.log(`Saved ${destPath} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function run() {
  const buildToolsZip = path.join(TOOLCHAIN_DIR, 'build-tools.zip');
  const platformZip = path.join(TOOLCHAIN_DIR, 'platform.zip');

  await downloadFile('https://dl.google.com/android/repository/build-tools_r33.0.2-windows.zip', buildToolsZip);
  await downloadFile('https://dl.google.com/android/repository/platform-33_r02.zip', platformZip);

  console.log('Extracting build-tools...');
  execSync(`tar -xf "${buildToolsZip}" -C "${TOOLCHAIN_DIR}"`, { stdio: 'inherit' });

  console.log('Extracting platform...');
  execSync(`tar -xf "${platformZip}" -C "${TOOLCHAIN_DIR}"`, { stdio: 'inherit' });

  console.log('Done! Toolchain is ready in', TOOLCHAIN_DIR);
}

run().catch(console.error);
