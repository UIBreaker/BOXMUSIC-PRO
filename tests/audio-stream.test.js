const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const { once } = require('node:events');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { AUDIO_PROBE_SIZE, createRangedDownload, createDirectUrlResolver, pipeUpstream } = require('../lib/audio-stream');

test('preview and download share one pending extraction and its cached result', async () => {
  let calls = 0;
  let finish;
  const resolve = createDirectUrlResolver(() => { calls++; return new Promise((r) => { finish = r; }); });
  const requests = [resolve('song'), resolve('song'), resolve('song')];
  await nextTurn();
  assert.equal(calls, 1);
  finish('https://audio.example/song');
  assert.deepEqual(await Promise.all(requests), Array(3).fill('https://audio.example/song'));
  assert.equal(await resolve('song'), 'https://audio.example/song');
  assert.equal(calls, 1);
});
test('failed extractions can be retried', async () => {
  let calls = 0;
  const resolve = createDirectUrlResolver(async () => {
    if (++calls === 1) throw new Error('temporary');
    return 'https://audio.example/retry';
  });
  await assert.rejects(resolve('song'), /temporary/);
  assert.equal(await resolve('song'), 'https://audio.example/retry');
});
test('a second expired-URL response does not evict an already running refresh', async () => {
  let calls = 0;
  const resolve = createDirectUrlResolver(async () => `https://audio.example/${++calls}`);
  const old = await resolve('song');
  resolve.invalidate('song', old);
  const pending = resolve('song');
  resolve.invalidate('song', old);
  assert.equal(await resolve('song'), await pending);
  assert.equal(calls, 2);
});
test('URL cache expires after 30 minutes', async (t) => {
  let now = 1000;
  let calls = 0;
  t.mock.method(Date, 'now', () => now);
  const resolve = createDirectUrlResolver(async () => `https://audio.example/${++calls}`);
  await resolve('song');
  now += 31 * 60 * 1000;
  await resolve('song');
  assert.equal(calls, 2);
});

function sink(write) {
  const res = new Writable({ highWaterMark: 1024, write });
  res.headers = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  return res;
}
test('proxy preserves Range bytes and waits for a slow client instead of buffering the whole song', async () => {
  let pulls = 0;
  let unblock;
  let firstWrite;
  const first = new Promise((r) => { firstWrite = r; });
  const chunks = [];
  const source = new ReadableStream({ pull(controller) {
    if (pulls === 128) { controller.close(); return; }
    controller.enqueue(new Uint8Array(65536).fill(pulls++));
  } });
  const res = sink((chunk, encoding, callback) => {
    chunks.push(Buffer.from(chunk));
    if (chunks.length === 1) { unblock = callback; firstWrite(); }
    else setImmediate(callback);
  });
  const finished = once(res, 'finish');
  pipeUpstream({ method: 'GET' }, res, new Response(source, {
    status: 206, headers: { 'content-type': 'audio/mp4', 'content-length': String(128 * 65536), 'content-range': 'bytes 0-8388607/8388608' }
  }));
  await first;
  await nextTurn();
  assert.ok(pulls < 16, `Read ${pulls} chunks ahead of the blocked client`);
  unblock();
  await finished;
  assert.equal(Buffer.concat(chunks).length, 128 * 65536);
  chunks.forEach((chunk, i) => assert.ok(chunk.equals(Buffer.alloc(65536, i))));
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers['content-range'], 'bytes 0-8388607/8388608');
});
test('disconnecting the client cancels upstream audio', { timeout: 1000 }, async () => {
  let cancelled;
  const stopped = new Promise((r) => { cancelled = r; });
  const res = sink((chunk, encoding, callback) => { res.destroy(); callback(); });
  pipeUpstream({ method: 'GET' }, res, new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(4096)); },
    cancel() { cancelled(); }
  })));
  await stopped;
  assert.equal(res.destroyed, true);
  assert.equal(res.writableFinished, false);
});
test('upstream errors cannot become successful truncated responses', async () => {
  const res = sink((chunk, encoding, callback) => callback());
  const closed = new Promise((resolve) => res.once('close', resolve));
  let reads = 0;
  pipeUpstream({ method: 'GET' }, res, new Response(new ReadableStream({ pull(controller) {
    if (reads++) controller.error(new Error('connection lost'));
    else controller.enqueue(new Uint8Array([1, 2]));
  } })));
  await closed;
  assert.equal(res.destroyed, true);
  assert.equal(res.writableFinished, false);
});

test('parallel audio ranges are reassembled byte-for-byte with at most four requests at once', async () => {
  const audio = Buffer.alloc(1200123);
  audio.forEach((_, i) => { audio[i] = i % 251; });
  function part(start, end) {
    return new Response(audio.subarray(start, end + 1), { status: 206, headers: {
      'content-range': `bytes ${start}-${end}/${audio.length}`, 'content-type': 'audio/mp4'
    } });
  }
  let active = 0;
  let peak = 0;
  const combined = createRangedDownload(part(0, AUDIO_PROBE_SIZE - 1), async (start, end) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, start % 3 + 1));
    active--;
    return part(start, end);
  });
  assert.equal(combined.status, 200);
  assert.equal(Number(combined.headers.get('content-length')), audio.length);
  assert.ok(Buffer.from(await combined.arrayBuffer()).equals(audio));
  assert.ok(peak > 1 && peak <= 4);
});
test('a source that ignores Range keeps its original full response', async () => {
  const full = new Response('complete audio', { headers: { 'content-type': 'audio/mp4' } });
  const combined = createRangedDownload(full, () => { throw new Error('Must not split this source'); });
  assert.equal(combined, full);
  assert.equal(await combined.text(), 'complete audio');
});
test('wrong or truncated subsequent ranges reject the entire download', async () => {
  for (const wrongRange of [false, true]) {
    const first = new Response(new Uint8Array(AUDIO_PROBE_SIZE), { status: 206, headers: {
      'content-range': `bytes 0-${AUDIO_PROBE_SIZE - 1}/${AUDIO_PROBE_SIZE + 20}`
    } });
    const combined = createRangedDownload(first, async (start, end) => new Response(new Uint8Array(end - start), {
      status: wrongRange ? 200 : 206,
      headers: { 'content-range': `bytes ${start}-${end}/${AUDIO_PROBE_SIZE + 20}` }
    }));
    await assert.rejects(combined.arrayBuffer(), /range/i);
  }
});
test('a transient range failure retries that range once without restarting the whole file', async () => {
  const total = AUDIO_PROBE_SIZE + 20;
  let attempts = 0;
  const first = new Response(new Uint8Array(AUDIO_PROBE_SIZE).fill(1), { status: 206, headers: {
    'content-range': `bytes 0-${AUDIO_PROBE_SIZE - 1}/${total}`
  } });
  const combined = createRangedDownload(first, async (start, end) => {
    if (++attempts === 1) throw new Error('temporary network error');
    return new Response(new Uint8Array(end - start + 1).fill(2), { status: 206, headers: {
      'content-range': `bytes ${start}-${end}/${total}`
    } });
  });
  const audio = new Uint8Array(await combined.arrayBuffer());
  assert.equal(audio.byteLength, total);
  assert.equal(audio[0], 1);
  assert.equal(audio.at(-1), 2);
  assert.equal(attempts, 2);
});
