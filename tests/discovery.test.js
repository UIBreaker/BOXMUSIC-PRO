const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSameTrack, preview } = require('../public/js/discovery');

const item = { id: 'abcdefghijk', title: 'Test track', artist: 'Test artist', duration: '3:00', thumbnail: 'cover.jpg' };
function player(current = null) {
  return {
    current, queue: null, toggles: 0,
    getCurrentSong() { return this.current; },
    togglePlay() { this.toggles++; },
    setQueue(songs, index, autoPlay) { this.queue = songs; this.index = index; this.autoPlay = autoPlay; }
  };
}
test('online preview queues a stream without saving or changing the search item/library', () => {
  const playback = player();
  const library = [];
  preview(item, library, playback, 'http://localhost:3000');
  assert.equal(playback.queue[0].streamUrl, 'http://localhost:3000/api/download?id=abcdefghijk');
  assert.equal(playback.queue[0].id, 'yt_abcdefghijk');
  assert.equal(playback.queue[0].isPreview, true);
  assert.equal(playback.queue[0].audioBlob, undefined);
  assert.equal(playback.autoPlay, true);
  assert.deepEqual(library, []);
  assert.equal(item.streamUrl, undefined);
});
test('preview of an already downloaded song uses its offline blob', () => {
  const saved = { ...item, id: 'yt_abcdefghijk', audioBlob: new Blob(['audio']) };
  const playback = player();
  preview(item, [saved], playback, '');
  assert.equal(playback.queue[0], saved);
  assert.equal(playback.queue[0].streamUrl, undefined);
});
test('clicking the current result toggles pause/resume without resetting the queue or position', () => {
  const playback = player({ ...item, id: 'yt_abcdefghijk' });
  preview(item, [], playback, '');
  assert.equal(playback.toggles, 1);
  assert.equal(playback.queue, null);
});
test('playing a different result replaces the current stream and keeps a canonical ID', () => {
  const playback = player({ id: 'another-song' });
  preview({ ...item, id: 'yt_abcdefghijk' }, [], playback, '');
  assert.equal(playback.queue[0].id, 'yt_abcdefghijk');
  assert.equal(playback.queue[0].streamUrl, '/api/download?id=abcdefghijk');
  assert.equal(playback.toggles, 0);
});
test('track matching handles saved IDs and missing tracks', () => {
  assert.ok(isSameTrack(item, { id: 'yt_abcdefghijk' }));
  assert.equal(isSameTrack(item, null), false);
  assert.equal(isSameTrack({}, {}), false);
  assert.equal(isSameTrack(item, { id: 'different' }), false);
});
