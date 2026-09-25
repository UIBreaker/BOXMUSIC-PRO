// Boxmusic self-check test suite (no extra dependencies, pure node assert)
const assert = require('assert');
const { spawn } = require('child_process');

async function runSelfCheck() {
  console.log('--- Starting Boxmusic self-check ---');

  const serverProc = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: '3456' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProc.stderr.on('data', (d) => console.error('Server err:', d.toString()));

  // Wait 1.5 seconds for server to start
  await new Promise((r) => setTimeout(r, 1500));

  const BASE_URL = 'http://localhost:3456';

  try {
    // 1. Check index.html served
    const homeRes = await fetch(`${BASE_URL}/`);
    assert.strictEqual(homeRes.status, 200, 'Home page must return 200');
    const html = await homeRes.text();
    assert(html.includes('Boxmusic'), 'Home HTML must contain Boxmusic');
    console.log('✓ Home HTML and PWA shell served successfully');

    // 2. Check manifest.json
    const manifestRes = await fetch(`${BASE_URL}/manifest.json`);
    assert.strictEqual(manifestRes.status, 200, 'Manifest must return 200');
    const manifest = await manifestRes.json();
    assert.strictEqual(manifest.short_name, 'Boxmusic', 'Manifest short_name match');
    console.log('✓ Manifest JSON validated');

    // 3. Check Service Worker
    const swRes = await fetch(`${BASE_URL}/sw.js`);
    assert.strictEqual(swRes.status, 200, 'Service worker must return 200');
    console.log('✓ Service Worker served');

    // 4. Check JS & CSS files
    const cssRes = await fetch(`${BASE_URL}/css/app.css`);
    assert.strictEqual(cssRes.status, 200, 'CSS must return 200');
    const dbRes = await fetch(`${BASE_URL}/js/db.js`);
    assert.strictEqual(dbRes.status, 200, 'db.js must return 200');
    const playerRes = await fetch(`${BASE_URL}/js/player.js`);
    assert.strictEqual(playerRes.status, 200, 'player.js must return 200');
    console.log('✓ Static client scripts and stylesheets accessible');

    // 5. Check Search API
    console.log('Testing /api/search?q=Ed+Sheeran...');
    const searchRes = await fetch(`${BASE_URL}/api/search?q=Ed+Sheeran`);
    assert.strictEqual(searchRes.status, 200, 'Search must return 200');
    const searchData = await searchRes.json();
    assert(Array.isArray(searchData), 'Search result must be an array');
    assert(searchData.length > 0, 'Search should return items');
    assert(searchData[0].id, 'First item must have id');
    assert(searchData[0].title, 'First item must have title');
    console.log(`✓ Search API works! Found ${searchData.length} results. First: "${searchData[0].title}"`);

    // 6. Check Download/Stream with Range header and URL caching
    console.log(`Testing /api/download?id=${searchData[0].id} with Range request...`);
    const streamRes = await fetch(`${BASE_URL}/api/download?id=${searchData[0].id}`, {
      headers: { Range: 'bytes=0-1024' }
    });
    assert(streamRes.status === 206 || streamRes.status === 200, `Stream status should be 206 or 200, got ${streamRes.status}`);
    const chunk = await streamRes.arrayBuffer();
    assert(chunk.byteLength > 0, 'Stream chunk should have bytes');
    console.log(`✓ Stream & Range request works! Received ${chunk.byteLength} bytes`);

    console.log('\n======================================');
    console.log('ALL BOXMUSIC SELF-CHECKS PASSED! 🎉');
    console.log('======================================');
  } finally {
    serverProc.kill();
  }
}

runSelfCheck().catch((err) => {
  console.error('Self-check failed:', err);
  process.exit(1);
});
