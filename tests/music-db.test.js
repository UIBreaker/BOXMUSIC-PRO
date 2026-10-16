const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { setImmediate: nextTurn } = require('node:timers/promises');
const MusicDB = vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/db'), 'utf8') + '; MusicDB;', { window: {} });

function database(result) {
  const request = { result };
  const writes = [];
  const store = { put(song) { writes.push(song); return request; }, get() { return request; } };
  const tx = { objectStore() { return store; } };
  const db = new MusicDB();
  db.open = async () => ({ transaction() { return tx; } });
  return { db, tx, request, writes };
}
test('saveSong only reports success after the IndexedDB transaction commits', async () => {
  const { db, tx, request } = database();
  let finished = false;
  const pending = db.saveSong({ id: 'song', audioBlob: new Blob(['audio']) }).then(() => { finished = true; });
  await nextTurn();
  request.onsuccess?.();
  await nextTurn();
  assert.equal(finished, false);
  tx.oncomplete();
  await pending;
  assert.equal(finished, true);
});
test('transaction abort is reported even when the individual write succeeded', async () => {
  const { db, tx, request } = database();
  const pending = db.saveSong({ id: 'song', audioBlob: new Blob(['audio']) });
  const rejected = assert.rejects(pending, /quota exhausted/);
  await nextTurn();
  request.onsuccess?.();
  tx.error = new Error('quota exhausted');
  tx.onabort();
  await rejected;
});
test('a late cover preserves audio and favorites, and does not recreate deleted songs', async () => {
  const audioBlob = new Blob(['audio']);
  for (const existing of [{ id: 'song', audioBlob, favorite: true }, undefined]) {
    const { db, tx, request, writes } = database(existing);
    const cover = new Blob(['image']);
    const pending = db.updateSongThumbnail('song', cover);
    await nextTurn();
    request.onsuccess();
    tx.oncomplete();
    const updated = await pending;
    if (existing) {
      assert.equal(updated.audioBlob, audioBlob);
      assert.equal(updated.favorite, true);
      assert.equal(updated.thumbnailBlob, cover);
      assert.equal(writes.length, 1);
    } else {
      assert.equal(updated, null);
      assert.equal(writes.length, 0);
    }
  }
});
test('statistics reuse loaded songs instead of reading every audio blob again', async () => {
  const db = new MusicDB();
  db.getAllSongs = () => { throw new Error('Unnecessary library scan'); };
  const stats = await db.getStats([{ sizeBytes: 1048576, favorite: true }, { sizeBytes: 2097152 }]);
  assert.equal(stats.count, 2);
  assert.equal(stats.totalMB, '3.0');
  assert.equal(stats.favoritesCount, 1);
});
