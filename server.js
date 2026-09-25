const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const yts = require('yt-search');
const os = require('os');
let qrcode = null;
try {
  qrcode = require('qrcode-terminal');
} catch (e) {}

// Prevent stream abortion or socket reset from terminating server
process.on('uncaughtException', (err) => {
  console.warn('Recovered from uncaughtException:', err.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.warn('Recovered from unhandledRejection:', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'X-Total-Bytes']
}));
app.use(express.json());

// Serve static frontend files with no-cache for instant mobile updates
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('manifest.json') || filePath.endsWith('.svg')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// API: Search songs worldwide
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query || !query.trim()) {
    return res.json([]);
  }

  try {
    const searchResults = await yts(query.trim());
    const videos = (searchResults.videos || []).slice(0, 25).map((v) => ({
      id: v.videoId,
      title: v.title,
      artist: v.author ? v.author.name : 'Unknown Artist',
      duration: v.timestamp || '--:--',
      seconds: v.seconds || 0,
      thumbnail: v.thumbnail || v.image,
      views: v.views ? Number(v.views).toLocaleString() : ''
    }));

    res.json(videos);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Lỗi khi tìm kiếm bài hát' });
  }
});

// In-memory cache for resolved direct stream URLs (30 min TTL)
const streamUrlCache = new Map();

async function resolveDirectUrl(id) {
  const cached = streamUrlCache.get(id);
  if (cached && Date.now() < cached.expireAt) {
    return cached.url;
  }

  const videoUrl = `https://www.youtube.com/watch?v=${id}`;
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [
      '-m', 'yt_dlp',
      '--js-runtimes', 'node',
      '-f', 'ba[ext=m4a]/ba/b',
      '-g',
      videoUrl
    ]);

    let directUrl = '';
    proc.stdout.on('data', (d) => directUrl += d.toString());
    proc.on('close', (code) => {
      directUrl = directUrl.trim();
      if (code === 0 && directUrl && directUrl.startsWith('http')) {
        streamUrlCache.set(id, {
          url: directUrl,
          expireAt: Date.now() + 30 * 60 * 1000 // 30 minutes
        });
        resolve(directUrl);
      } else {
        reject(new Error('Failed to resolve direct url'));
      }
    });
    proc.on('error', reject);
  });
}

function pipeUpstream(req, res, upstream) {
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mp4');
  const clen = upstream.headers.get('content-length');
  if (clen) {
    res.setHeader('Content-Length', clen);
    res.setHeader('X-Total-Bytes', clen);
  }
  const crange = upstream.headers.get('content-range');
  if (crange) res.setHeader('Content-Range', crange);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, X-Total-Bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  if (req.method === 'HEAD') {
    return res.end();
  }

  const reader = upstream.body.getReader();
  const pump = async () => {
    try {
      const { done, value } = await reader.read();
      if (done) return res.end();
      res.write(Buffer.from(value));
      return pump();
    } catch (e) {
      res.end();
    }
  };
  req.on('close', () => reader.cancel());
  return pump();
}

// API: Stream / Download audio directly
app.get('/api/download', async (req, res) => {
  let id = req.query.id;
  if (!id) return res.status(400).send('Missing ID');
  id = id.replace(/^yt_/, '').trim();

  if (!/^[\w-]+$/.test(id)) {
    return res.status(400).send('Invalid video ID');
  }

  const upstreamHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };
  if (req.headers.range) {
    upstreamHeaders['Range'] = req.headers.range;
  }

  let directUrl = null;
  try {
    directUrl = await resolveDirectUrl(id);
  } catch (err) {
    console.warn(`Direct URL resolve failed for ${id}:`, err.message);
  }

  if (directUrl) {
    try {
      let upstream = await fetch(directUrl, { headers: upstreamHeaders });

      if (upstream.status === 403 || upstream.status === 410) {
        streamUrlCache.delete(id);
        directUrl = await resolveDirectUrl(id);
        upstream = await fetch(directUrl, { headers: upstreamHeaders });
      }

      if (upstream.ok || upstream.status === 206) {
        return pipeUpstream(req, res, upstream);
      }
    } catch (err) {
      console.warn('Direct stream proxy failed, using stdout fallback:', err.message);
    }
  }

  // Fallback: direct pipe from yt-dlp
  const videoUrl = `https://www.youtube.com/watch?v=${id}`;
  const fallbackProc = spawn('python', [
    '-m', 'yt_dlp',
    '--js-runtimes', 'node',
    '-f', 'ba[ext=m4a]/ba/b',
    '-o', '-',
    videoUrl
  ]);

  res.setHeader('Content-Type', 'audio/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, X-Total-Bytes');
  fallbackProc.stdout.pipe(res);
  req.on('close', () => {
    if (!fallbackProc.killed) fallbackProc.kill();
  });
});

// API: Proxy image to bypass CORS and store offline thumbnail Blob
app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const upstreamRes = await fetch(imageUrl);
    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send('Failed to fetch image');
    }

    const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800');

    const arrayBuffer = await upstreamRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('Image proxy error:', err.message);
    res.status(500).send('Proxy error');
  }
});

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get local IPv4 address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n======================================================');
  console.log('🎵 BOXMUSIC - ỨNG DỤNG NGHE NHẠC CÁ NHÂN OFFLINE');
  console.log('======================================================');
  console.log(`- Mở trên máy tính:    http://localhost:${PORT}`);
  console.log(`- Mở trên ĐIỆN THOẠI:  http://${localIP}:${PORT}`);
  console.log('------------------------------------------------------');
  if (qrcode) {
    console.log('Quét mã QR dưới đây bằng điện thoại để mở ngay:');
    qrcode.generate(`http://${localIP}:${PORT}`, { small: true });
  }
  console.log('======================================================\n');
});
