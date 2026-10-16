const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { readAudio, save } = require('../public/js/download');
const item = { id: 'yt_song', title: 'Sample', artist: 'Studio', thumbnail: 'https://image.example/cover' };
const audio = () => new Response('complete audio', { headers: { 'content-type': 'audio/ogg', 'content-length': '14' } });

test('fast chunk streams update progress at most ten times per second without losing bytes', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ pull(controller) {
    if (count++ === 1000) controller.close();
    else controller.enqueue(new Uint8Array(1024).fill(7));
  } }), { headers: { 'content-type': 'audio/mp4', 'content-length': String(1000 * 1024) } }));
  const updates = [];
  const blob = await readAudio('/audio', (progress) => updates.push(progress));
  assert.equal(blob.size, 1000 * 1024);
  assert.ok(updates.length < 20, `Rendered ${updates.length} updates for 1000 chunks`);
  assert.equal(updates.at(-1).done, true);
  assert.equal(updates.at(-1).receivedBytes, blob.size);
});
test('HTML error pages, empty files, and truncated audio are rejected', async (t) => {
  for (const response of [new Response('html', { headers: { 'content-type': 'text/html' } }),
    new Response('', { headers: { 'content-type': 'audio/mp4' } }),
    new Response('partial', { headers: { 'content-type': 'audio/mp4', 'content-length': '100' } })]) {
    t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(readAudio('/audio'));
  }
});
test('audio saves before a slow cover, then the cover is added in the background', { timeout: 1500 }, async (t) => {
  let finishCover;
  let patched;
  const coverReady = new Promise((r) => { patched = r; });
  const pendingCover = new Promise((r) => { finishCover = r; });
  t.after(() => finishCover(new Response('', { status: 404 })));
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested.push(url);
    return url.includes('proxy-image') ? pendingCover : audio();
  });
  let writes = 0;
  const song = await save({ item, apiBase: '', db: {
    async saveSong(record) { writes++; assert.equal(record.thumbnailBlob, null); },
    async updateSongThumbnail(id, blob) { return { id, thumbnailBlob: blob }; }
  }, onThumbnail: patched });
  assert.equal(writes, 1);
  assert.equal(song.audioMime, 'audio/ogg');
  assert.equal(song.audioBlob.size, 14);
  assert.equal(song.thumbnailBlob, null);
  assert.ok(requested[0].includes('proxy-image'));
  assert.ok(requested[1].includes('id=song'));
  finishCover(new Response('cover', { headers: { 'content-type': 'image/jpeg' } }));
  const updated = await coverReady;
  assert.equal(updated.thumbnailBlob.size, 5);
});
test('a failed database commit fails the download even after all audio bytes arrive', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => audio());
  await assert.rejects(save({ item: { ...item, thumbnail: null }, apiBase: '', db: {
    async saveSong() { throw new Error('storage full'); }
  } }), /storage full/);
});
test('cover enrichment does not restore a song deleted while its image was loading', async (t) => {
  let finishCover;
  t.mock.method(globalThis, 'fetch', async (url) => url.includes('proxy-image')
    ? new Promise((r) => { finishCover = r; }) : audio());
  let notified = false;
  await save({ item, apiBase: '', db: {
    async saveSong() {}, async updateSongThumbnail() { return null; }
  }, onThumbnail() { notified = true; } });
  finishCover(new Response('cover', { headers: { 'content-type': 'image/jpeg' } }));
  await nextTurn();
  assert.equal(notified, false);
});
