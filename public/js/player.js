// Boxmusic Audio Player Controller
class MusicPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'metadata';
    this.queue = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.isShuffle = false;
    this.repeatMode = 'all'; // 'none' | 'all' | 'one'
    this.currentAudioUrl = null;
    this.currentCoverUrl = null;
    this.isYtPlaying = false;
    this.ytPlayer = null;
    this.ytInterval = null;
    this._ytInitialized = false;

    // Listeners
    this.listeners = {
      state: [],
      track: [],
      time: [],
      queue: [],
      mode: []
    };

    this._bindAudioEvents();
    if (typeof window !== 'undefined') {
      setTimeout(() => this._initYouTubePlayer(), 1000);
    }
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
      const cur = this.getCurrentSong();
      if (cur && !cur.audioBlob && (cur.id || cur.source === 'youtube')) {
        const cleanId = String(cur.id).replace(/^yt_/, '').trim();
        if (cleanId && this._playYouTubeFallback(cleanId)) {
          return;
        }
      }
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

    // Stop YouTube player if it was playing
    if (this.isYtPlaying && this.ytPlayer && typeof this.ytPlayer.stopVideo === 'function') {
      try { this.ytPlayer.stopVideo(); } catch (e) {}
    }
    this.isYtPlaying = false;
    this._stopYTTimeTracker();

    // Cleanup previous object URLs
    if (this.currentAudioUrl && this.currentAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentAudioUrl);
    }
    if (this.currentCoverUrl && this.currentCoverUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentCoverUrl);
    }

    // Determine audio source URL (handle Blob or ArrayBuffer safely)
    let blob = song.audioBlob;
    if (blob) {
      if (!(blob instanceof Blob)) {
        blob = new Blob([blob], { type: song.audioMime || 'audio/mp4' });
      }
      this.currentAudioUrl = URL.createObjectURL(blob);
    } else if (song.streamUrl) {
      this.currentAudioUrl = song.streamUrl;
    } else if (song.id) {
      const cleanId = String(song.id).replace(/^yt_/, '').trim();
      const api = (typeof getApiBase === 'function') ? getApiBase() : '';
      this.currentAudioUrl = `${api}/api/download?id=${cleanId}`;
    }

    // Determine cover art URL
    let tBlob = song.thumbnailBlob;
    if (tBlob) {
      if (!(tBlob instanceof Blob)) {
        tBlob = new Blob([tBlob], { type: 'image/jpeg' });
      }
      this.currentCoverUrl = URL.createObjectURL(tBlob);
    } else if (song.thumbnail && !song.thumbnail.includes('icon.svg')) {
      this.currentCoverUrl = song.thumbnail;
    } else {
      const cleanId = String(song.id || '').replace(/^yt_/, '').trim();
      if (cleanId && cleanId.length === 11) {
        this.currentCoverUrl = `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;
      } else {
        this.currentCoverUrl = 'icons/icon-192.png';
      }
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
    this._initAudioContext();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    if (this.isYtPlaying && this.ytPlayer && typeof this.ytPlayer.playVideo === 'function') {
      try { this.ytPlayer.playVideo(); } catch (e) {}
      this.isPlaying = true;
      this._notify('state', { isPlaying: true });
      return;
    }
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
    if (this.isYtPlaying && this.ytPlayer && typeof this.ytPlayer.pauseVideo === 'function') {
      try { this.ytPlayer.pauseVideo(); } catch (e) {}
      this.isPlaying = false;
      this._notify('state', { isPlaying: false });
    }
    this.audio.pause();
  }

  togglePlay() {
    if (this.isYtPlaying && this.ytPlayer) {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
      return;
    }
    if (this.audio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  seek(seconds) {
    if (this.isYtPlaying && this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
      this.ytPlayer.seekTo(seconds, true);
      return;
    }
    if (isFinite(seconds) && this.audio.duration) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration));
    }
  }

  seekPercent(percent) {
    if (this.isYtPlaying && this.ytPlayer && typeof this.ytPlayer.seekTo === 'function') {
      const dur = this.ytPlayer.getDuration() || 0;
      if (dur > 0) {
        this.ytPlayer.seekTo((percent / 100) * dur, true);
      }
      return;
    }
    if (isFinite(percent) && this.audio.duration) {
      this.audio.currentTime = (percent / 100) * this.audio.duration;
    }
  }

  _initYouTubePlayer() {
    if (this._ytInitialized || typeof window === 'undefined') return;
    this._ytInitialized = true;

    const setupYT = () => {
      if (typeof YT !== 'undefined' && YT.Player && !this.ytPlayer) {
        try {
          this.ytPlayer = new YT.Player('yt-player-element', {
            height: '200',
            width: '200',
            playerVars: {
              autoplay: 1,
              controls: 0,
              disablekb: 1,
              fs: 0,
              playsinline: 1
            },
            events: {
              onStateChange: (event) => {
                if (event.data === (window.YT ? YT.PlayerState.PLAYING : 1)) {
                  this.isPlaying = true;
                  this._notify('state', { isPlaying: true });
                  this._startYTTimeTracker();
                } else if (event.data === (window.YT ? YT.PlayerState.PAUSED : 2)) {
                  this.isPlaying = false;
                  this._notify('state', { isPlaying: false });
                  this._stopYTTimeTracker();
                } else if (event.data === (window.YT ? YT.PlayerState.ENDED : 0)) {
                  this._stopYTTimeTracker();
                  if (this.repeatMode === 'one') {
                    this.ytPlayer.seekTo(0, true);
                    this.ytPlayer.playVideo();
                  } else {
                    this.next(false);
                  }
                }
              }
            }
          });
        } catch (e) {
          console.warn('YT.Player init failed:', e);
        }
      }
    };

    if (window.YT && window.YT.Player) {
      setupYT();
    } else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === 'function') prev();
        setupYT();
      };
    }
  }

  _playYouTubeFallback(videoId) {
    this._initYouTubePlayer();
    if (this.ytPlayer && typeof this.ytPlayer.loadVideoById === 'function') {
      try {
        this.isYtPlaying = true;
        this.audio.pause();
        this.ytPlayer.loadVideoById(videoId);
        this.ytPlayer.playVideo();
        if (typeof showToast === 'function') {
          showToast('▶ Máy tính đang tắt máy chủ, phát YouTube trực tiếp!');
        }
        return true;
      } catch (err) {
        console.warn('YT fallback error:', err);
      }
    }
    return false;
  }

  _startYTTimeTracker() {
    this._stopYTTimeTracker();
    this.ytInterval = setInterval(() => {
      if (this.isYtPlaying && this.ytPlayer && typeof this.ytPlayer.getCurrentTime === 'function') {
        const currentTime = this.ytPlayer.getCurrentTime() || 0;
        const duration = this.ytPlayer.getDuration() || 0;
        const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
        this._notify('time', { currentTime, duration, percent });
      }
    }, 500);
  }

  _stopYTTimeTracker() {
    if (this.ytInterval) {
      clearInterval(this.ytInterval);
      this.ytInterval = null;
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
    if (this.audioCtx) return;
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;
      this.audioCtx = new AudioCtxClass();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.35; // Fast transient response to bass punch!
      this.analyser.minDecibels = -85;
      this.analyser.maxDecibels = -15;

      // Connect HTML5 audio element
      this.audioSource = this.audioCtx.createMediaElementSource(this.audio);

      // Bass boost filter
      this.bassFilter = this.audioCtx.createBiquadFilter();
      this.bassFilter.type = 'lowshelf';
      this.bassFilter.frequency.value = 220;
      this.bassFilter.gain.value = this.isBassBoosted ? 12 : 0;

      this.audioSource.connect(this.bassFilter);
      this.bassFilter.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
    } catch (e) {
      console.warn('AudioContext init note:', e);
    }
  }

  toggleBassBoost() {
    this.isBassBoosted = !this.isBassBoosted;
    if (this.bassFilter && this.audioCtx) {
      this.bassFilter.gain.setTargetAtTime(this.isBassBoosted ? 12 : 0, this.audioCtx.currentTime, 0.05);
    }
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
    this.numBars = 28;
    this.barHeights = new Float32Array(this.numBars);
    this.peakHeights = new Float32Array(this.numBars);
    this.peakHoldTimers = new Uint8Array(this.numBars);
    this.peakVel = new Float32Array(this.numBars);
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

      const numBars = this.numBars || 28;
      const targetBars = new Float32Array(numBars);
      let hasRealAudio = false;

      if (this.analyser && this.audioCtx && this.audioCtx.state === 'running') {
        const fullFreq = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(fullFreq);

        let totalSum = 0;
        for (let b = 0; b < fullFreq.length; b++) {
          totalSum += fullFreq[b];
        }

        if (totalSum > 30) {
          hasRealAudio = true;
          const rawBass = (fullFreq[0] * 1.5 + fullFreq[1] * 1.2 + fullFreq[2] * 0.9) / 3.6;
          if (!this._lastBassAvg) this._lastBassAvg = 0;
          const bassDelta = Math.max(0, rawBass - this._lastBassAvg);
          this._lastBassAvg = this._lastBassAvg * 0.85 + rawBass * 0.15;
          const bassPunch = bassDelta * 1.3;

          for (let i = 0; i < numBars; i++) {
            const ratio = i / (numBars - 1);
            const binIndex = Math.min(fullFreq.length - 1, Math.floor(Math.pow(ratio, 1.85) * (fullFreq.length * 0.72)));
            let val = fullFreq[binIndex] || 0;

            if (i < 8) {
              const boostFactor = (8 - i) / 8;
              val = Math.max(val, fullFreq[Math.floor(i * 0.6)] || 0);
              val = val * (1.1 + boostFactor * 0.5) + bassPunch * boostFactor;
            } else if (i < 18) {
              val = val * 1.35;
            } else {
              val = val * 1.55;
            }
            targetBars[i] = Math.max(0, Math.min(255, val));
          }
        }
      }

      // If stream/CORS prevents direct buffer read or playing via iframe, synthesize authentic bouncy beats
      if (!hasRealAudio && this.isPlaying) {
        const timeMs = performance.now();
        const beatDuration = 468; // ~128 BPM
        const beatPhase = (timeMs % beatDuration) / beatDuration;
        const beatIndex = Math.floor(timeMs / beatDuration) % 16;

        // Punchy exponential transient decay
        const kickDecay = Math.exp(-beatPhase * 9.5);
        const isKickBeat = (beatIndex % 2 === 0);
        const isHeavyKick = (beatIndex % 4 === 0);
        const kickPower = (isHeavyKick ? 250 : (isKickBeat ? 215 : 120)) * kickDecay;

        const isSnareBeat = (beatIndex % 4 === 2);
        const snareDecay = Math.exp(-beatPhase * 11);
        const snarePower = (isSnareBeat ? 225 : 55) * snareDecay;

        const hatPhase = (timeMs % (beatDuration / 4)) / (beatDuration / 4);
        const hatDecay = Math.exp(-hatPhase * 14);
        const hatPower = 180 * hatDecay;

        for (let i = 0; i < numBars; i++) {
          let barVal = 0;
          if (i < 8) {
            const falloff = Math.pow(1 - (i / 8), 1.2);
            barVal = kickPower * falloff;
          } else if (i < 18) {
            const midDist = 1 - Math.abs(i - 13) / 6;
            barVal = snarePower * Math.max(0, midDist) + (kickPower * 0.35 * Math.max(0, midDist));
          } else {
            const trebleRatio = (i - 18) / 10;
            barVal = hatPower * trebleRatio;
          }
          targetBars[i] = Math.max(0, Math.min(255, barVal));
        }
      }

      // Physics-based gravity & bounce decay
      for (let i = 0; i < numBars; i++) {
        const target = this.isPlaying ? targetBars[i] : 0;
        if (target > this.barHeights[i]) {
          // Instant explosive attack on bass drops!
          this.barHeights[i] = target;
        } else {
          // Smooth, springy exponential gravity decay
          this.barHeights[i] = Math.max(0, this.barHeights[i] * 0.83 - 1.8);
        }

        // Peak Hold Dot with realistic gravity drop
        if (this.barHeights[i] >= this.peakHeights[i]) {
          this.peakHeights[i] = this.barHeights[i];
          this.peakHoldTimers[i] = 12; // Hold at apex for 12 frames
          this.peakVel[i] = 0;
        } else {
          if (this.peakHoldTimers[i] > 0) {
            this.peakHoldTimers[i]--;
          } else {
            this.peakVel[i] += 0.45;
            this.peakHeights[i] = Math.max(0, this.peakHeights[i] - this.peakVel[i]);
          }
        }
      }

      if (this.visualMode === 1) {
        // MODE 1: Authentic 8-Bit Segmented LED Stereo Bars (Winamp / Boombox style)
        this._renderNeonWaves(ctx, w, h, this.barHeights, this.peakHeights, numBars);
      } else {
        // MODE 2: Cyber Floating Peak Spectrum
        this._renderCyberSpectrum(ctx, w, h, this.barHeights, this.peakHeights, numBars);
      }
    };

    requestAnimationFrame(draw);
  }

  _renderNeonWaves(ctx, w, h, barHeights, peakHeights, numBars) {
    const barSpacing = w / numBars;
    const barWidth = Math.max(3, barSpacing - 2);
    const numSegments = 10;
    const segHeight = Math.max(2, (h - numSegments * 2) / numSegments);

    for (let i = 0; i < numBars; i++) {
      const x = i * barSpacing + (barSpacing - barWidth) / 2;
      const activeSegs = Math.floor((barHeights[i] / 255) * numSegments);

      for (let s = 0; s < numSegments; s++) {
        const y = h - (s + 1) * (segHeight + 2);
        
        if (s < activeSegs) {
          if (s >= 8) {
            ctx.fillStyle = '#ef4444'; // Red peak
          } else if (s >= 5) {
            ctx.fillStyle = '#f59e0b'; // Amber yellow mid
          } else {
            ctx.fillStyle = '#10b981'; // Emerald green bass
          }
        } else {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        }

        ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(barWidth), Math.floor(segHeight));
      }

      // Floating Pixel Peak Dot
      const peakSeg = Math.min(numSegments - 1, Math.floor((peakHeights[i] / 255) * numSegments));
      if (peakHeights[i] > 15 && peakSeg > 0) {
        const peakY = h - (peakSeg + 1) * (segHeight + 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.floor(x), Math.floor(peakY), Math.floor(barWidth), Math.floor(segHeight));
      }
    }
  }

  _renderCyberSpectrum(ctx, w, h, barHeights, peakHeights, numBars) {
    const barSpacing = w / numBars;
    const barWidth = Math.max(3, barSpacing - 2);

    for (let i = 0; i < numBars; i++) {
      const x = i * barSpacing + (barSpacing - barWidth) / 2;
      const barH = Math.max(0, (barHeights[i] / 255) * (h - 6));

      if (barH > 1) {
        const grad = ctx.createLinearGradient(0, h, 0, h - barH);
        grad.addColorStop(0, '#06b6d4');
        grad.addColorStop(0.6, '#a855f7');
        grad.addColorStop(1, '#ec4899');
        ctx.fillStyle = grad;
        ctx.fillRect(Math.floor(x), Math.floor(h - barH), Math.floor(barWidth), Math.floor(barH));
      }

      // Floating peak bar
      const peakH = Math.max(0, (peakHeights[i] / 255) * (h - 6));
      if (peakH > 4) {
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(Math.floor(x), Math.floor(h - peakH - 3), Math.floor(barWidth), 2);
      }
    }
  }

  _setupMediaSession(song) {
    if (window.AndroidBridge && typeof window.AndroidBridge.updateMedia === 'function') {
      window.AndroidBridge.updateMedia(
        song.title || 'Boxmusic',
        song.artist || 'Không rõ nghệ sĩ',
        song.coverUrl || '',
        this.isPlaying
      );
    }

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
    if (window.AndroidBridge && typeof window.AndroidBridge.updateMedia === 'function') {
      const cur = this.getCurrentSong() || {};
      window.AndroidBridge.updateMedia(
        cur.title || 'Boxmusic',
        cur.artist || 'Không rõ nghệ sĩ',
        cur.coverUrl || '',
        state === 'playing'
      );
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
