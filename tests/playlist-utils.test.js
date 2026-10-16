const { test } = require('node:test');
const assert = require('node:assert/strict');
const { songsFor, durationLabel, select, palette } = require('../public/js/playlist-utils');

const songMap = new Map([
  ['a', { id: 'a', seconds: 180 }],
  ['b', { id: 'b', duration: '4:30' }]
]);
const playlists = [
  { id: 'old', name: 'Đêm dịu dàng', songIds: ['b', 'missing', 'a'], createdAt: 1 },
  { id: 'new', name: 'Buổi sáng', songIds: ['a'], createdAt: 2 },
  { id: 'empty', name: 'Chưa có nhạc', createdAt: 3 }
];

test('resolves songs in playlist order and excludes deleted songs', () => {
  assert.deepEqual(songsFor(playlists[0], songMap).map((song) => song.id), ['b', 'a']);
  assert.deepEqual(songsFor(playlists[2], songMap), []);
});
test('formats seconds, legacy timestamps, hours, and incomplete durations honestly', () => {
  assert.equal(durationLabel([...songMap.values()]), '8 phút');
  assert.equal(durationLabel([{ duration: '1:02:00' }]), '1 giờ 2 phút');
  assert.equal(durationLabel([{ seconds: 30 }]), '1 phút');
  assert.equal(durationLabel([{ seconds: Infinity, duration: '--:--' }]), '');
  assert.equal(durationLabel([]), '');
  assert.equal(durationLabel([{ seconds: 120 }, {}]), 'ít nhất 2 phút');
});
test('searches Vietnamese names with or without diacritics and surrounding whitespace', () => {
  assert.deepEqual(select(playlists, ' DEM diu ', 'newest', songMap).map((pl) => pl.id), ['old']);
  assert.deepEqual(select(playlists, 'không có', 'name', songMap), []);
});
test('sorts by newest, Vietnamese name, and available songs without mutating records', () => {
  assert.deepEqual(select(playlists, '', 'newest', songMap).map((pl) => pl.id), ['empty', 'new', 'old']);
  assert.deepEqual(select(playlists, '', 'songs', songMap).map((pl) => pl.id), ['old', 'new', 'empty']);
  assert.deepEqual(select(playlists, '', 'name', songMap).map((pl) => pl.id), ['new', 'empty', 'old']);
  assert.equal(playlists[0].id, 'old');
  assert.deepEqual(playlists[0].songIds, ['b', 'missing', 'a']);
});
test('cover palette is stable and stays in the supported range', () => {
  for (const id of ['old', 'pl_123', 'Buổi sáng', '']) {
    assert.equal(palette(id), palette(id));
    assert.ok(palette(id) >= 0 && palette(id) < 5);
  }
});
