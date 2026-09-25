// Boxmusic Audio Player Controller
class MusicPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.queue = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isShuffle = false;
    this.repeatMode = 'all'; // 'none' | 'all' | 'one'
    this.currentAudioUrl = null;
    this.currentCoverUrl = null;

    // Listeners
    this.listeners = {
      state: [],
      track: [],
      time: [],
      queue: [],
      mode: []
    };

    this._bindAudioEvents();
  }

  _bindAudioEvents() {
    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this._notify('state', { isPlaying: true });
      this._updateMediaSessionState('playing');
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this._notify('state', { isPlaying: false });
      this._updateMediaSessionState('paused');
    });

    this.audio.addEventListener('timeupdate', () => {
      this._notify('time', {
        currentTime: this.audio.currentTime,
        duration: this.audio.duration || 0,
        percent: this.audio.duration ? (this.audio.currentTime / this.audio.duration) * 100 : 0
      });
      this._updateMediaSessionPosition();
    });

    this.audio.addEventListener('ended', () => {
      if (this.repeatMode === 'one') {
        this.audio.currentTime = 0;
        this.audio.play();
      } else {
        this.next(false); // don't loop if 'none' and end of list
      }
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
      this.isPlaying = false;
      this._notify('state', { isPlaying: false, error: true });
    });
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  _notify(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    }
  }

  setQueue(songs, startIndex = 0, autoPlay = true) {
    this.queue = [...songs];
    this._notify('queue', this.queue);
    if (this.queue.length > 0) {
      const idx = Math.max(0, Math.min(startIndex, this.queue.length - 1));
      this.playIndex(idx, autoPlay);
    }
  }

  getCurrentSong() {
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      return this.queue[this.currentIndex];
    }
    return null;
  }

  async playIndex(index, autoPlay = true) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    const song = this.queue[index];

    // Cleanup previous object URLs
    if (this.currentAudioUrl && this.currentAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentAudioUrl);
    }
    if (this.currentCoverUrl && this.currentCoverUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentCoverUrl);
    }

    // Determine audio source URL
    if (song.audioBlob) {
      this.currentAudioUrl = URL.createObjectURL(song.audioBlob);
    } else if (song.streamUrl) {
      this.currentAudioUrl = song.streamUrl;
    } else if (song.id) {
      const cleanId = String(song.id).replace(/^yt_/, '').trim();
      this.currentAudioUrl = `/api/download?id=${cleanId}`;
    }

    // Determine cover art URL
    if (song.thumbnailBlob) {
      this.currentCoverUrl = URL.createObjectURL(song.thumbnailBlob);
    } else if (song.thumbnail) {
      this.currentCoverUrl = song.thumbnail;
    } else {
      this.currentCoverUrl = 'icons/icon.svg';
    }

    this.audio.src = this.currentAudioUrl;
    this.audio.currentTime = 0;

    const currentTrackData = {
      ...song,
      coverUrl: this.currentCoverUrl,
      index: this.currentIndex,
      total: this.queue.length
    };

    this._notify('track', currentTrackData);
    this._setupMediaSession(currentTrackData);

    if (autoPlay) {
      this.play();
    }
  }

  async play() {
    try {
      await this.audio.play();
    } catch (e) {
      console.warn('Playback error / blocked by browser policy:', e);
      // Try again on user touch
      const resumeOnTouch = () => {
        this.audio.play().catch(console.warn);
        document.removeEventListener('click', resumeOnTouch);
        document.removeEventListener('touchstart', resumeOnTouch);
      };
      document.addEventListener('click', resumeOnTouch, { once: true });
      document.addEventListener('touchstart', resumeOnTouch, { once: true });
    }
  }

  pause() {
    this.audio.pause();
  }

  togglePlay() {
    if (this.audio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  next(userTriggered = true) {
    if (this.queue.length === 0) return;

    if (this.isShuffle && this.queue.length > 1) {
      let nextIdx = Math.floor(Math.random() * this.queue.length);
      while (nextIdx === this.currentIndex && this.queue.length > 1) {
        nextIdx = Math.floor(Math.random() * this.queue.length);
      }
      this.playIndex(nextIdx, true);
      return;
    }

    let nextIdx = this.currentIndex + 1;
    if (nextIdx >= this.queue.length) {
      if (this.repeatMode === 'all' || userTriggered) {
        nextIdx = 0;
      } else {
        // Stop at end
        this.pause();
        return;
      }
    }
    this.playIndex(nextIdx, true);
  }

  prev() {
    if (this.queue.length === 0) return;
    // If playing for more than 3 seconds, restart current song
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }

    let prevIdx = this.currentIndex - 1;
    if (prevIdx < 0) {
      prevIdx = this.queue.length - 1;
    }
    this.playIndex(prevIdx, true);
  }

  seek(seconds) {
    if (isFinite(seconds) && this.audio.duration) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration));
    }
  }

  seekPercent(percent) {
    if (isFinite(percent) && this.audio.duration) {
      this.audio.currentTime = (percent / 100) * this.audio.duration;
    }
  }

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    this._notify('mode', { isShuffle: this.isShuffle, repeatMode: this.repeatMode });
    return this.isShuffle;
  }

  toggleRepeat() {
    const modes = ['all', 'one', 'none'];
    const nextModeIdx = (modes.indexOf(this.repeatMode) + 1) % modes.length;
    this.repeatMode = modes[nextModeIdx];
    this._notify('mode', { isShuffle: this.isShuffle, repeatMode: this.repeatMode });
    return this.repeatMode;
  }

  // --- Web Audio API & Visualizer Engine ---
  _initAudioContext() {
    // Left native for pure speaker/bluetooth output without mobile WebAudio muting
  }

  toggleBassBoost() {
    this.isBassBoosted = !this.isBassBoosted;
    return this.isBassBoosted;
  }

  toggleVisualMode() {
    this.visualMode = this.visualMode === 1 ? 2 : 1;
    return this.visualMode;
  }

  attachVisualizer(canvas) {
    this.canvas = canvas;
    this.canvasCtx = canvas.getContext('2d');
    this.visualMode = 1; // 1: Neon Waves, 2: Cyber Spectrum
    this.isBassBoosted = false;
    this.peakHeights = new Array(36).fill(0);
    this._startVisualizerLoop();
  }

  _startVisualizerLoop() {
    const draw = () => {
      requestAnimationFrame(draw);
      if (!this.canvas || !this.canvasCtx) return;

      const canvas = this.canvas;
      const ctx = this.canvasCtx;

      // Adapt canvas size
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const targetWidth = Math.floor(rect.width * dpr);
      const targetHeight = Math.floor(rect.height * dpr);

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      // Get frequency data or synthesize fluid wave
      const numBars = 32;
      let freqArray = new Uint8Array(numBars);
      let hasRealAudio = false;

      if (this.analyser && this.audioCtx && this.audioCtx.state === 'running') {
        const fullFreq = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(fullFreq);
        for (let i = 0; i < numBars; i++) {
          freqArray[i] = fullFreq[i] || 0;
          if (freqArray[i] > 10) hasRealAudio = true;
        }
      }

      // If playing without direct analyser access (e.g. CORS), generate rich responsive rhythm
      if (!hasRealAudio && this.isPlaying) {
        const time = performance.now() * 0.004;
        for (let i = 0; i < numBars; i++) {
          const bass = Math.sin(time * 3) * 60 + 120;
          const mid = Math.cos(time * 2 + i * 0.35) * 50 + 80;
          const treble = Math.sin(time * 4 - i * 0.5) * 40 + 60;
          const val = Math.max(10, Math.min(250, (bass * (1 - i / numBars) + mid * 0.6 + treble * 0.4)));
          freqArray[i] = Math.floor(val);
        }
      } else if (!this.isPlaying) {
        // Smoothly decay to flat
        for (let i = 0; i < numBars; i++) {
          this.peakHeights[i] = Math.max(0, this.peakHeights[i] * 0.88);
          freqArray[i] = 0;
        }
      }

      // Track peak heights
      for (let i = 0; i < numBars; i++) {
        if (freqArray[i] > this.peakHeights[i]) {
          this.peakHeights[i] = freqArray[i];
        } else {
          this.peakHeights[i] = Math.max(0, this.peakHeights[i] - 3.5);
        }
      }

      if (this.visualMode === 1) {
        // MODE 1: Fluid Neon Mirrored Waves & Glow Spectrum
        this._renderNeonWaves(ctx, w, h, freqArray, numBars);
      } else {
        // MODE 2: Cyber Floating Peak Spectrum
        this._renderCyberSpectrum(ctx, w, h, freqArray, numBars);
      }
    };

    requestAnimationFrame(draw);
  }

  _renderNeonWaves(ctx, w, h, freqArray, numBars) {
    // MODE 1: Authentic 8-Bit Segmented LED Stereo Bars (Winamp / Boombox style)
    const barSpacing = w / numBars;
    const barWidth = Math.max(3, barSpacing - 2);
    const numSegments = 10;
    const segHeight = Math.max(2, (h - numSegments * 2) / numSegments);

    for (let i = 0; i < numBars; i++) {
      const x = i * barSpacing + (barSpacing - barWidth) / 2;
      const activeSegs = Math.floor((freqArray[i] / 255) * numSegments);

      for (let s = 0; s < numSegments; s++) {
        const y = h - (s + 1) * (segHeight + 2);
        
        if (s < activeSegs) {
          // Color based on height (Green -> Yellow -> Red)
          if (s >= 8) {
            ctx.fillStyle = '#ef4444'; // Red peak
          } else if (s >= 5) {
            ctx.fillStyle = '#facc15'; // Yellow mid
          } else {
            ctx.fillStyle = '#84cc16'; // Green bass
          }
        } else {
          // Inactive dark LED block
          ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        }

        ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(barWidth), Math.floor(segHeight));
      }

      // Floating Pixel Peak Dot
      const peakSeg = Math.min(numSegments - 1, Math.floor((this.peakHeights[i] / 255) * numSegments));
      const peakY = h - (peakSeg + 1) * (segHeight + 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.floor(x), Math.floor(peakY), Math.floor(barWidth), Math.floor(segHeight));
    }
  }

  _renderCyberSpectrum(ctx, w, h, freqArray, numBars) {
    // MODE 2: Retro Cyan & Magenta Pixel Soundwave
    const barSpacing = w / numBars;
    const barWidth = Math.max(3, barSpacing - 2);

    for (let i = 0; i < numBars; i++) {
      const x = i * barSpacing + (barSpacing - barWidth) / 2;
      const barH = Math.max(2, (freqArray[i] / 255) * h);

      // 8-bit stepped pixel height
      const steppedH = Math.floor(barH / 4) * 4;

      ctx.fillStyle = (i % 2 === 0) ? '#38bdf8' : '#c084fc';
      ctx.fillRect(Math.floor(x), Math.floor(h - steppedH), Math.floor(barWidth), Math.floor(steppedH));

      // Peak highlight
      const peakH = Math.floor(((this.peakHeights[i] / 255) * h) / 4) * 4;
      ctx.fillStyle = '#facc15';
      ctx.fillRect(Math.floor(x), Math.floor(h - peakH - 4), Math.floor(barWidth), 3);
    }
  }

  _setupMediaSession(song) {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || 'Boxmusic',
      artist: song.artist || 'Không rõ nghệ sĩ',
      album: 'Boxmusic Offline',
      artwork: [
        { src: song.coverUrl || 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next(true));
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        this.seek(details.seekTime);
      }
    });
  }

  _updateMediaSessionState(state) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state;
    }
  }

  _updateMediaSessionPosition() {
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && this.audio.duration) {
      try {
        navigator.mediaSession.setPositionState({
          duration: this.audio.duration || 0,
          playbackRate: this.audio.playbackRate || 1,
          position: Math.min(this.audio.currentTime || 0, this.audio.duration || 0)
        });
      } catch (e) {
        // Can fail if duration is NaN or out of sync
      }
    }
  }
}

window.musicPlayer = new MusicPlayer();
