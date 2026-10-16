(function (root) {
  async function readAudio(url, onProgress = () => {}) {
    const response = await fetch(url);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Không thể kết nối máy chủ tải nhạc');
    }
    const type = (response.headers.get('content-type') || 'audio/mp4').split(';')[0];
    if (!type.startsWith('audio/') && type !== 'application/octet-stream') {
      await response.body?.cancel();
      throw new Error('Máy chủ không trả về tệp âm thanh');
    }
    const length = Number(response.headers.get('content-length') || response.headers.get('x-total-bytes'));
    const totalBytes = Number.isFinite(length) && length > 0 ? length : 0;
    const reader = response.body.getReader();
    const chunks = [];
    let receivedBytes = 0;
    let lastUpdate = performance.now();
    onProgress({ receivedBytes, totalBytes, done: false });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.byteLength;
        if (performance.now() - lastUpdate >= 100) {
          onProgress({ receivedBytes, totalBytes, done: false });
          lastUpdate = performance.now();
        }
      }
      if (!receivedBytes) throw new Error('Dữ liệu âm thanh trống');
      if (totalBytes && !response.headers.get('content-encoding') && receivedBytes !== totalBytes) {
        throw new Error('Tệp âm thanh tải chưa đầy đủ. Vui lòng thử lại.');
      }
      onProgress({ receivedBytes, totalBytes, done: true });
      return new Blob(chunks, { type: type === 'application/octet-stream' ? 'audio/mp4' : type });
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
  }

  async function fetchCover(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null;
      return await response.blob();
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  async function save({ item, apiBase, db, onProgress, onThumbnail }) {
    const id = String(item.id).replace(/^yt_/, '').trim();
    let thumbnailBlob = null;
    const cover = item.thumbnail
      ? fetchCover(`${apiBase}/api/proxy-image?url=${encodeURIComponent(item.thumbnail)}`).then((blob) => { thumbnailBlob = blob; return blob; })
      : Promise.resolve(null);
    const audioBlob = await readAudio(`${apiBase}/api/download?id=${encodeURIComponent(id)}&download=1`, onProgress);
    const song = {
      id: `yt_${id}`, title: item.title, artist: item.artist,
      duration: item.duration, seconds: item.seconds,
      audioBlob, thumbnailBlob, thumbnail: item.thumbnail,
      audioMime: audioBlob.type, sizeBytes: audioBlob.size,
      source: 'youtube', favorite: false, createdAt: Date.now()
    };
    await db.saveSong(song);
    // An optional cover must never delay a ready-to-play offline song.
    cover.then(async (blob) => {
      if (!blob || song.thumbnailBlob) return;
      const updated = await db.updateSongThumbnail(song.id, blob);
      if (updated) {
        song.thumbnailBlob = updated.thumbnailBlob;
        onThumbnail?.(song);
      }
    }).catch((error) => console.warn('Ảnh bìa chưa được lưu:', error.message));
    return song;
  }

  const downloads = { readAudio, save };
  if (typeof module !== 'undefined' && module.exports) module.exports = downloads;
  else root.MusicDownload = downloads;
})(typeof window === 'undefined' ? this : window);
