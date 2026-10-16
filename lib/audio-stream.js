const { Readable, pipeline } = require('node:stream');
const AUDIO_PROBE_SIZE = 64 * 1024;

function contentRange(response) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
  if (!match) return null;
  const values = match.slice(1).map(Number);
  return values.every(Number.isSafeInteger) && values[0] <= values[1] && values[1] < values[2] ? values : null;
}

function createRangedDownload(first, fetchRange) {
  if (first.status === 200) return first; // Source ignores Range; keep the normal full response.
  const range = contentRange(first);
  if (first.status !== 206 || !range || range[0] !== 0) {
    first.body?.cancel().catch(() => {});
    throw new Error('Invalid initial audio range');
  }
  const [, firstEnd, total] = range;
  const chunkSize = Math.min(256 * 1024, Math.max(AUDIO_PROBE_SIZE, Math.ceil((total - firstEnd - 1) / 4)));
  async function readChunk(response, start, end) {
    const actual = contentRange(response);
    if (response.status !== 206 || !actual || actual[0] !== start || actual[1] !== end || actual[2] !== total) {
      await response.body?.cancel();
      throw new Error('Audio source returned an unexpected range');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== end - start + 1) throw new Error('Audio range was truncated');
    return bytes;
  }
  async function loadRange(start, end, initial = null) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = attempt === 0 && initial ? initial : await fetchRange(start, end);
        return await readChunk(response, start, end);
      } catch (error) {
        if (attempt === 1 || error.name === 'AbortError') throw error;
      }
    }
  }
  async function* chunks() {
    yield await loadRange(0, firstEnd, first);
    for (let offset = firstEnd + 1; offset < total; offset += chunkSize * 4) {
      const requests = [];
      for (let start = offset; start < Math.min(total, offset + chunkSize * 4); start += chunkSize) {
        const end = Math.min(total - 1, start + chunkSize - 1);
        requests.push(loadRange(start, end));
      }
      // Keep byte order even when later ranges arrive first; buffer at most four chunks.
      for (const bytes of await Promise.all(requests)) yield bytes;
    }
  }
  const iterator = chunks();
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) { controller.error(error); }
    },
    async cancel() { await iterator.return(); }
  }), { status: 200, headers: {
    'Content-Type': first.headers.get('content-type') || 'audio/mp4',
    'Content-Length': String(total)
  } });
}

// Preview and download requests for one song share the same extraction job.
function createDirectUrlResolver(extract) {
  const cache = new Map();
  function resolve(id) {
    const cached = cache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const entry = { expiresAt: Date.now() + 30 * 60 * 1000 };
    entry.promise = Promise.resolve().then(() => extract(id)).then((url) => {
      entry.url = url;
      return url;
    }).catch((error) => {
      if (cache.get(id) === entry) cache.delete(id);
      throw error;
    });
    cache.set(id, entry);
    return entry.promise;
  }
  resolve.invalidate = (id, staleUrl) => {
    if (!staleUrl || cache.get(id)?.url === staleUrl) cache.delete(id);
  };
  return resolve;
}

function pipeUpstream(req, res, upstream) {
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mp4');
  const encoded = upstream.headers.get('content-encoding') && upstream.headers.get('content-encoding') !== 'identity';
  for (const name of ['content-length', 'content-range']) {
    if (encoded) continue;
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  const length = !encoded && upstream.headers.get('content-length');
  if (length) res.setHeader('X-Total-Bytes', length);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  if (req.method === 'HEAD') {
    upstream.body?.cancel().catch(() => {});
    res.end();
    return;
  }
  // pipeline respects slow clients and cancels the upstream on disconnection.
  pipeline(Readable.fromWeb(upstream.body), res, (error) => {
    if (error && !res.destroyed) res.destroy(error);
  });
}

module.exports = { AUDIO_PROBE_SIZE, createRangedDownload, createDirectUrlResolver, pipeUpstream };
