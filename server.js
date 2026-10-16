const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const yts = require('yt-search');
const os = require('os');
const { AUDIO_PROBE_SIZE, createRangedDownload, createDirectUrlResolver, pipeUpstream } = require('./lib/audio-stream');
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

let cloudflareTunnel = null;
let currentPublicUrl = null;
let currentRelayId = null;

// Health check / ping endpoint for LAN discovery
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, version: '1.1.2', time: Date.now() });
});

// API: Get server network info (LAN + Public Cloudflare Tunnel + Relay ID)
app.get('/api/server-info', (req, res) => {
  res.json({
    ok: true,
    version: '1.1.2',
    localUrl: `http://localhost:${PORT}`,
    lanUrl: `http://${localIP}:${PORT}`,
    publicUrl: currentPublicUrl || null,
    relayId: currentRelayId || null
  });
});

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

// A preview and an explicit download share one cached extraction, including while pending.
const resolveDirectUrl = createDirectUrlResolver((id) => new Promise((resolve, reject) => {
  const proc = spawn('python', [
    '-m', 'yt_dlp', '--js-runtimes', 'node',
    '-f', 'ba[ext=m4a]/ba/b', '-g',
    `https://www.youtube.com/watch?v=${id}`
  ]);
  const timer = setTimeout(() => {
    proc.kill();
    reject(new Error('Audio source extraction timed out'));
  }, 30000);
  let directUrl = '';
  proc.stderr.resume();
  proc.stdout.on('data', (data) => { directUrl += data.toString(); });
  proc.once('error', (error) => { clearTimeout(timer); reject(error); });
  proc.once('close', (code) => {
    clearTimeout(timer);
    directUrl = directUrl.trim();
    if (code === 0 && /^https?:\/\/\S+$/.test(directUrl)) resolve(directUrl);
    else reject(new Error('Failed to resolve direct URL'));
  });
}));

// API: Stream / Download audio directly
app.get('/api/download', async (req, res) => {
  let id = req.query.id;
  if (typeof id !== 'string' || !id) return res.status(400).send('Missing ID');
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
  const accelerated = req.query.download === '1' && !req.headers.range && req.method !== 'HEAD';
  if (accelerated) upstreamHeaders.Range = `bytes=0-${AUDIO_PROBE_SIZE - 1}`;

  const controller = new AbortController();
  res.once('close', () => controller.abort());
  let directUrl = null;
  try {
    directUrl = await resolveDirectUrl(id);
  } catch (err) {
    console.warn(`Direct URL resolve failed for ${id}:`, err.message);
  }

  if (res.destroyed) return;
  if (directUrl) {
    try {
      let upstream = await fetch(directUrl, { headers: upstreamHeaders, signal: controller.signal });

      if (upstream.status === 403 || upstream.status === 410) {
        await upstream.body?.cancel();
        resolveDirectUrl.invalidate(id, directUrl);
        directUrl = await resolveDirectUrl(id);
        upstream = await fetch(directUrl, { headers: upstreamHeaders, signal: controller.signal });
      }

      if (upstream.ok || upstream.status === 206) {
        if (accelerated) upstream = createRangedDownload(upstream, async (start, end) => {
          const part = await fetch(directUrl, {
            headers: { ...upstreamHeaders, Range: `bytes=${start}-${end}` }, signal: controller.signal
          });
          if (part.status === 403 || part.status === 410) resolveDirectUrl.invalidate(id, directUrl);
          return part;
        });
        return pipeUpstream(req, res, upstream);
      }
      await upstream.body?.cancel();
    } catch (err) {
      console.warn('Direct stream proxy failed, using stdout fallback:', err.message);
    }
  }

  if (res.destroyed) return;
  // Fallback: direct pipe from yt-dlp
  const videoUrl = `https://www.youtube.com/watch?v=${id}`;
  const fallbackProc = spawn('python', [
    '-m', 'yt_dlp',
    '--js-runtimes', 'node',
    '-f', 'ba[ext=m4a]/ba/b',
    '-o', '-',
    videoUrl
  ]);

  for (const header of ['Content-Length', 'Content-Range', 'X-Total-Bytes']) res.removeHeader(header);
  res.setHeader('Content-Type', 'audio/mp4');
  res.setHeader('Accept-Ranges', 'none');
  fallbackProc.stderr.resume();
  fallbackProc.stdout.pipe(res, { end: false });
  fallbackProc.once('error', () => {
    if (!res.headersSent) res.status(502).send('Không thể khởi động tải nhạc');
    else res.destroy();
  });
  fallbackProc.once('close', (code) => {
    if (res.destroyed || res.writableEnded) return;
    if (code === 0) res.end();
    else if (!res.headersSent) res.status(502).send('Không thể tải nguồn âm thanh');
    else res.destroy(new Error('Audio download interrupted'));
  });
  res.once('close', () => {
    if (fallbackProc.exitCode === null && !fallbackProc.killed) fallbackProc.kill();
  });
});

// API: Proxy image to bypass CORS and store offline thumbnail Blob
app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Missing url parameter');
  }

  const controller = new AbortController();
  res.once('close', () => controller.abort());
  try {
    const upstreamRes = await fetch(imageUrl, { signal: controller.signal });
    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send('Failed to fetch image');
    }

    const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800');

    const arrayBuffer = await upstreamRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    if (res.destroyed) return;
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

if (require.main === module) app.listen(PORT, '0.0.0.0', () => {
  console.log('\n======================================================');
  console.log('🎵 BOXMUSIC - MÁY CHỦ ÂM NHẠC ĐA NỀN TẢNG (PRO)');
  console.log('======================================================');
  console.log(`- Mở trên máy tính:        http://localhost:${PORT}`);
  console.log(`- Mạng nội bộ Wi-Fi (LAN): http://${localIP}:${PORT}`);
  console.log('------------------------------------------------------');
  if (qrcode) {
    console.log('📱 Mã QR kết nối Wi-Fi nội bộ:');
    qrcode.generate(`http://${localIP}:${PORT}`, { small: true });
  }
  console.log('======================================================');

  startCloudflareTunnel(PORT);
});

function startCloudflareTunnel(port) {
  try {
    const { Tunnel } = require('cloudflared');
    console.log('\n🌍 Đang khởi tạo kết nối Internet toàn cầu (Cloudflare Tunnel)...');
    cloudflareTunnel = Tunnel.quick(`http://localhost:${port}`);
    cloudflareTunnel.on('url', async (url) => {
      currentPublicUrl = url;
      console.log('\n======================================================');
      console.log('🚀 ĐÃ KÍCH HOẠT KẾT NỐI TOÀN CẦU (4G / 5G / NGOÀI NHÀ)!');
      console.log('======================================================');
      console.log(`🌐 Link truy cập từ bất kỳ đâu: ${url}`);
      console.log('------------------------------------------------------');
      if (qrcode) {
        console.log('📱 Quét mã QR dưới đây để mở trên điện thoại (4G / 5G):');
        qrcode.generate(url, { small: true });
        console.log('======================================================\n');
      }
      // Register tunnel URL to a global relay (kvdb.io) so phone can find it without home Wi-Fi
      registerToRelay(url).then((relayId) => {
        if (relayId) {
          currentRelayId = relayId;
          console.log(`🔑 Relay ID: ${relayId} (lưu trong ứng dụng để tự động kết nối 4G)`);
        }
      }).catch(() => {});
    });
    cloudflareTunnel.on('error', (err) => {
      console.warn('Lưu ý Cloudflare Tunnel:', err.message || err);
    });
  } catch (e) {
    console.warn('Không thể nạp cloudflared:', e.message);
  }
}

// Register tunnel URL to ntfy.sh relay so phone can find it from any network (no signup needed)
const RELAY_TOPIC_FILE = path.join(__dirname, 'data', 'relay-topic.txt');
async function registerToRelay(tunnelUrl) {
  try {
    let topicId;
    if (fs.existsSync(RELAY_TOPIC_FILE)) {
      topicId = fs.readFileSync(RELAY_TOPIC_FILE, 'utf8').trim();
    } else {
      // Generate a stable random topic ID for this server installation
      topicId = 'boxmusic-' + Math.random().toString(36).slice(2, 12);
      fs.mkdirSync(path.dirname(RELAY_TOPIC_FILE), { recursive: true });
      fs.writeFileSync(RELAY_TOPIC_FILE, topicId);
    }
    // Publish current tunnel URL to ntfy.sh (free, no account, poll-based)
    const res = await fetch(`https://ntfy.sh/${topicId}`, {
      method: 'POST',
      body: tunnelUrl,
      headers: { 'Title': 'BoxmusicTunnel', 'Tags': 'link', 'Priority': '1' }
    });
    if (res.ok) return topicId;
  } catch (e) {
    console.warn('Relay registration skipped:', e.message);
  }
  return null;
}

function cleanupTunnel() {
  if (cloudflareTunnel && typeof cloudflareTunnel.stop === 'function') {
    try { cloudflareTunnel.stop(); } catch (e) {}
  }
}

process.on('SIGINT', () => {
  cleanupTunnel();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanupTunnel();
  process.exit(0);
});

process.on('exit', () => {
  cleanupTunnel();
});

module.exports = app;
