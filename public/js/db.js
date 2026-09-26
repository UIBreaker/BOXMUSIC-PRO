const DB_NAME = 'BoxmusicDB';
const DB_VERSION = 2;
const STORE_NAME = 'songs';

class MusicDB {
  constructor() {
    this.db = null;
  }

  async open() {
    if (this.db) return this.db;

    // Request persistent storage so browser/system never purges songs
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        await navigator.storage.persist();
      } catch (e) {}
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('favorite', 'favorite', { unique: false });
          store.createIndex('title', 'title', { unique: false });
        }
        if (!db.objectStoreNames.contains('playlists')) {
          const pStore = db.createObjectStore('playlists', { keyPath: 'id' });
          pStore.createIndex('createdAt', 'createdAt', { unique: false });
          pStore.createIndex('name', 'name', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  async saveSong(song) {
    if (!song.audioBlob || song.audioBlob.size === 0) {
      throw new Error('Dữ liệu âm thanh rỗng, không thể lưu');
    }

    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const songData = {
        id: song.id,
        title: song.title || 'Bài hát không tên',
        artist: song.artist || 'Không rõ nghệ sĩ',
        duration: song.duration || '--:--',
        seconds: song.seconds || 0,
        audioBlob: song.audioBlob, // Blob
        thumbnailBlob: song.thumbnailBlob || null, // Blob
        audioMime: song.audioMime || 'audio/mp4',
        sizeBytes: song.sizeBytes || (song.audioBlob ? song.audioBlob.size : 0),
        source: song.source || 'local',
        favorite: !!song.favorite,
        createdAt: song.createdAt || Date.now()
      };

      const req = store.put(songData);
      req.onsuccess = () => resolve(songData);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllSongs() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        // Sort descending by createdAt
        const list = req.result || [];
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getSong(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteSong(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async toggleFavorite(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => {
        const item = req.result;
        if (!item) return resolve(false);
        item.favorite = !item.favorite;
        const putReq = store.put(item);
        putReq.onsuccess = () => resolve(item.favorite);
        putReq.onerror = () => reject(putReq.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getStats() {
    const songs = await this.getAllSongs();
    const count = songs.length;
    let totalBytes = 0;
    let favoritesCount = 0;

    songs.forEach((s) => {
      totalBytes += s.sizeBytes || (s.audioBlob ? s.audioBlob.size : 0);
      if (s.favorite) favoritesCount++;
    });

    return {
      count,
      totalBytes,
      totalMB: (totalBytes / (1024 * 1024)).toFixed(1),
      favoritesCount
    };
  }

  // --- Playlist Operations (Hoàn Toàn Offline) ---
  async createPlaylist(name) {
    if (!name || !name.trim()) throw new Error('Tên playlist không được để trống');
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('playlists', 'readwrite');
      const store = tx.objectStore('playlists');
      const playlist = {
        id: 'pl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        name: name.trim(),
        songIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const req = store.add(playlist);
      req.onsuccess = () => resolve(playlist);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllPlaylists() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('playlists', 'readonly');
      const store = tx.objectStore('playlists');
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getPlaylist(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('playlists', 'readonly');
      const store = tx.objectStore('playlists');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async addSongToPlaylist(playlistId, songId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('playlists', 'readwrite');
      const store = tx.objectStore('playlists');
      const getReq = store.get(playlistId);
      getReq.onsuccess = () => {
        const pl = getReq.result;
        if (!pl) return reject(new Error('Không tìm thấy danh sách phát'));
        if (!pl.songIds) pl.songIds = [];
        if (!pl.songIds.includes(songId)) {
          pl.songIds.push(songId);
          pl.updatedAt = Date.now();
          const putReq = store.put(pl);
          putReq.onsuccess = () => resolve(pl);
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve(pl);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async removeSongFromPlaylist(playlistId, songId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('playlists', 'readwrite');
      const store = tx.objectStore('playlists');
      const getReq = store.get(playlistId);
      getReq.onsuccess = () => {
        const pl = getReq.result;
        if (!pl) return reject(new Error('Không tìm thấy danh sách phát'));
        if (pl.songIds) {
          pl.songIds = pl.songIds.filter(id => id !== songId);
          pl.updatedAt = Date.now();
          const putReq = store.put(pl);
          putReq.onsuccess = () => resolve(pl);
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve(pl);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async deletePlaylist(playlistId) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('playlists', 'readwrite');
      const store = tx.objectStore('playlists');
      const req = store.delete(playlistId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
}

window.musicDB = new MusicDB();
