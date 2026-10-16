const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const precached = vm.runInNewContext(sw + '; STATIC_ASSETS', { self: { addEventListener() {} } });

test('every local script and stylesheet is precached with the same version as the page', () => {
  const assets = [...html.matchAll(/(?:src|href)="((?:css|js)\/[^"?]+\?v=[^"]+)"/g)].map((match) => '/' + match[1]);
  assert.ok(assets.length >= 6);
  for (const asset of assets) {
    assert.ok(precached.includes(asset), `Offline cache is missing ${asset}`);
    assert.ok(fs.existsSync(path.join(root, asset.split('?')[0])), `Missing file ${asset}`);
  }
});
test('page IDs are unique so existing player and collection controls keep their bindings', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['playlist-cards-container', 'mini-player', 'full-player', 'local-file-input', 'playlist-search', 'playlist-sort']) {
    assert.ok(ids.includes(id), `Missing control ${id}`);
  }
});
