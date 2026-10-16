// Boxmusic Main Application Logic
document.addEventListener('DOMContentLoaded', () => {
  // Service Worker Registration (only when supported and under http/https)
  if ('serviceWorker' in navigator && window.location && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js?v=1.1.2').then((reg) => {
      reg.update();
    }).catch((err) => {
      console.warn('Service Worker registration skipped:', err);
    });
  }

  // State & API base with custom override + LAN auto-discovery + Cloudflare 4G/Remote tunnel
  let customApiBase = (typeof localStorage !== 'undefined') ? localStorage.getItem('boxmusic_custom_api_base') : null;
  let autoDiscoveredApi = null;
  let remoteTunnelUrl = (typeof localStorage !== 'undefined') ? localStorage.getItem('boxmusic_remote_tunnel_url') : null;
  let relayBucketId = (typeof localStorage !== 'undefined') ? localStorage.getItem('boxmusic_relay_bucket_id') : null;
  let activeApiBase = null;

  function getApiBase() {
    if (typeof window !== 'undefined' && window.location && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
      return '';
    }
    if (activeApiBase) return activeApiBase.replace(/\/+$/, '');
    if (customApiBase) return customApiBase.replace(/\/+$/, '');
    if (autoDiscoveredApi) return autoDiscoveredApi.replace(/\/+$/, '');
    if (remoteTunnelUrl) return remoteTunnelUrl.replace(/\/+$/, '');
    return 'http://192.168.1.12:3000';
  }
  window.getApiBase = getApiBase;

  async function pingServer(baseUrl, timeoutMs = 1800) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), timeoutMs);
      const cleanUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
      const url = cleanUrl + '/api/ping';
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        return data.ok === true;
      }
    } catch (e) {}
    return false;
  }

  async function syncServerInfo(baseUrl) {
    try {
      const cleanUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(cleanUrl + '/api/server-info', { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          if (data.publicUrl) {
            remoteTunnelUrl = data.publicUrl;
            try { localStorage.setItem('boxmusic_remote_tunnel_url', data.publicUrl); } catch (e) {}
            const settingTunnel = document.getElementById('setting-remote-tunnel-url');
            if (settingTunnel && !settingTunnel.value) settingTunnel.value = data.publicUrl;
          }
          if (data.relayId) {
            relayBucketId = data.relayId;
            try { localStorage.setItem('boxmusic_relay_bucket_id', data.relayId); } catch (e) {}
          }
          return data;
        }
      }
    } catch (e) {}
    return null;
  }

  // Fetch current tunnel URL from ntfy.sh relay (works from any network — 4G, work Wi-Fi)
  async function fetchFromRelay() {
    if (!relayBucketId) return null;
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      // Poll ntfy.sh for the latest message (the current Cloudflare tunnel URL)
      const res = await fetch(`https://ntfy.sh/${relayBucketId}/json?poll=1&since=all`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (res.ok) {
        const text = (await res.text()).trim();
        if (!text) return null;
        // ntfy returns NDJSON — get the last line
        const lines = text.split('\n').filter(Boolean);
        const last = JSON.parse(lines[lines.length - 1]);
        const url = last && last.message && last.message.trim();
        if (url && url.startsWith('https://')) {
          remoteTunnelUrl = url;
          try { localStorage.setItem('boxmusic_remote_tunnel_url', url); } catch (e) {}
          const settingTunnel = document.getElementById('setting-remote-tunnel-url');
          if (settingTunnel) settingTunnel.value = url;
          return url;
        }
      }
    } catch (e) {}
    return null;
  }

  async function autoScanServer() {
    const candidates = [
      'http://192.168.1.12:3000',
      'http://192.168.1.15:3000',
      'http://192.168.1.10:3000',
      'http://192.168.1.11:3000',
      'http://192.168.1.13:3000',
      'http://192.168.1.14:3000',
      'http://192.168.1.16:3000',
      'http://192.168.1.17:3000',
      'http://192.168.1.18:3000',
      'http://192.168.1.19:3000',
      'http://192.168.1.20:3000',
      'http://localhost:3000'
    ];
    for (const ip of candidates) {
      const ok = await pingServer(ip, 700);
      if (ok) {
        autoDiscoveredApi = ip;
        customApiBase = ip;
        activeApiBase = ip;
        try { localStorage.setItem('boxmusic_custom_api_base', ip); } catch (e) {}
        syncServerInfo(ip);
        return ip;
      }
    }
    return null;
  }

  let currentFilter = 'all';
  let librarySongs = [];
  let libraryLoadVersion = 0;
  const libraryThumbnailUrls = [];
  let downloadedIds = new Set();
  let searchTimeout = null;
  let searchVersion = 0;

  // DOM Elements
  const libraryView = document.getElementById('library-view');
  const playlistView = document.getElementById('playlist-view');
  const searchView = document.getElementById('search-view');
  const navItems = document.querySelectorAll('.nav-item');
  const networkBadge = document.getElementById('network-badge');
  const networkStatusText = document.getElementById('network-status-text');

  // Library Elements
  const librarySongList = document.getElementById('library-song-list');
  const libraryEmpty = document.getElementById('library-empty');
  const storageStats = document.getElementById('storage-stats');
  const btnImportFile = document.getElementById('btn-import-file');
  const localFileInput = document.getElementById('local-file-input');
  const filterPills = document.querySelectorAll('.filter-pill');

  // Playlist Elements
  const playlistCardsContainer = document.getElementById('playlist-cards-container');
  const playlistEmpty = document.getElementById('playlist-empty');
  const playlistStats = document.getElementById('playlist-stats');
  const btnCreatePlaylist = document.getElementById('btn-create-playlist');

  // Search Elements
  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const searchResultsList = document.getElementById('search-results-list');
  const searchLoading = document.getElementById('search-loading');
  const searchOfflineNotice = document.getElementById('search-offline-notice');
  const searchPlaceholder = document.getElementById('search-placeholder');
  const searchSummary = document.getElementById('search-results-summary');
  const btnSavePreview = document.getElementById('btn-player-save-preview');

  function uiIcon(name) {
    return `<svg class="ui-icon" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
  }

  // Mini Player Elements
  const miniPlayer = document.getElementById('mini-player');
  const miniThumb = document.getElementById('mini-thumb');
  const miniTitle = document.getElementById('mini-title');
  const miniArtist = document.getElementById('mini-artist');
  const miniBtnPlay = document.getElementById('mini-btn-play');
  const miniPlayIcon = document.getElementById('mini-play-icon');
  const miniBtnNext = document.getElementById('mini-btn-next');
  const miniProgressFill = document.getElementById('mini-progress-fill');
  const miniInfoClick = document.getElementById('mini-info-click');

  // Full Player Elements
  const fullPlayer = document.getElementById('full-player');
  function setFullPlayerOpen(open) {
    fullPlayer.classList.toggle('open', open);
    document.body.classList.toggle('player-expanded', open);
    window.musicPlayer.visualizer?.setVisible(open);
    if (open) fullPlayer.scrollTop = 0;
  }
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('app-in-background', document.hidden);
  });

  const btnClosePlayer = document.getElementById('btn-close-player');
  const playerArt = document.getElementById('player-art-vinyl') || document.getElementById('player-art');
  const playerTitle = document.getElementById('player-title');
  const playerArtist = document.getElementById('player-artist');
  const playerBtnFav = document.getElementById('player-btn-fav');
  const playerSlider = document.getElementById('player-slider');
  const playerTimeCurrent = document.getElementById('player-time-current');
  const playerTimeTotal = document.getElementById('player-time-total');
  const playerBtnShuffle = document.getElementById('player-btn-shuffle');
  const playerBtnPrev = document.getElementById('player-btn-prev');
  const playerBtnPlay = document.getElementById('player-btn-play');
  const playerPlayIcon = document.getElementById('player-play-icon');
  const playerBtnNext = document.getElementById('player-btn-next');
  const playerBtnRepeat = document.getElementById('player-btn-repeat');
  const btnExportAudio = document.getElementById('btn-export-audio');
  const btnDeleteCurrent = document.getElementById('btn-delete-current');

  // Visualizer & Vinyl Effects Elements
  const vinylDisc = document.getElementById('vinyl-disc');
  const playerGlow = document.getElementById('player-glow');
  const playerVisualizer = document.getElementById('player-visualizer');
  const btnVisualMode = document.getElementById('btn-visual-mode');
  const visualModeText = document.getElementById('visual-mode-text');
  const btnFxBass = document.getElementById('btn-fx-bass');
  const bassModeText = document.getElementById('bass-mode-text');

  // Retro Elements
  const greetingTime = document.getElementById('greeting-time');
  const btnToggleArtMode = document.getElementById('btn-toggle-art-mode');
  const artModeText = document.getElementById('art-mode-text');
  const retroCardView = document.getElementById('retro-card-view');
  const retroVinylView = document.getElementById('retro-vinyl-view');
  const playerArtVinyl = document.getElementById('player-art-vinyl');
  const genreChips = document.querySelectorAll('.genre-chip');

  // Intro Splash Elements
  const introSplash = document.getElementById('intro-splash');
  const btnIntroStart = document.getElementById('btn-intro-start');
  const introSkipBtn = document.getElementById('intro-skip-btn');
  const btnWarnYes = document.getElementById('btn-warn-yes');
  const btnWarnNo = document.getElementById('btn-warn-no');
  const btnReplayIntro = document.getElementById('btn-replay-intro');
  const introLoadingText = document.getElementById('intro-loading-text');
  const segBlocks = document.querySelectorAll('.intro-segmented-bar .seg-block');

  // SVG Paths
  const PLAY_PATH = 'M8 5v14l11-7z';
  const PAUSE_PATH = 'M6 19h4V5H6v14zm8-14v14h4V5h-4z';

  // --- Retro 8-bit Synth Chimes ---
  function play8BitChime(type = 'dive') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      if (type === 'dive') {
        // Magical ascending chime arpeggio + resonant sweep
        const freqs = [392.00, 523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98]; // G4 -> G6
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(450, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(7500, ctx.currentTime + 0.85);
        filter.connect(ctx.destination);

        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = idx % 2 === 0 ? 'square' : 'triangle';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
          gain.gain.setValueAtTime(0.09, ctx.currentTime + idx * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.35);
          osc.connect(gain);
          gain.connect(filter);
          osc.start(ctx.currentTime + idx * 0.08);
          osc.stop(ctx.currentTime + idx * 0.08 + 0.35);
        });
      } else if (type === 'blip') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
      }
    } catch (e) {}
  }

  // --- 3D Cinematic Hyperspace Dive Engine ---
  const diveCanvas = document.getElementById('dive-canvas-3d');

  function run3DCinematicDive(onComplete) {
    if (!diveCanvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (onComplete) onComplete();
      return;
    }

    const ctx = diveCanvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    diveCanvas.width = Math.floor(w * dpr);
    diveCanvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);
    diveCanvas.classList.add('active');

    // Box origin on screen
    const boxEl = document.getElementById('pixel-music-box') || document.getElementById('intro-box-container');
    let originX = w / 2;
    let originY = h * 0.46;
    if (boxEl) {
      const rect = boxEl.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
    }

    // 3D Particles & Notes
    const numStars = window.innerWidth < 640 ? 56 : 80;
    const stars = [];
    const colors = ['#fde047', '#facc15', '#38bdf8', '#ec4899', '#ffffff', '#a855f7', '#4ade80'];
    const noteSymbols = ['♪', '♫', '♬', '✦', '★', '✨'];

    for (let i = 0; i < numStars; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 0.75 + 0.35;
      const dist = Math.random() * 260 + 20;
      stars.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        z: Math.random() * 1000 + 200,
        speed: speed,
        color: colors[Math.floor(Math.random() * colors.length)],
        isNote: i % 4 === 0,
        symbol: noteSymbols[Math.floor(Math.random() * noteSymbols.length)],
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.12
      });
    }

    const startTime = performance.now();
    const duration = 1350; // ms

    let previousTime = startTime;
    function animate(time) {
      const frameScale = Math.min(3, (time - previousTime) / (1000 / 60));
      previousTime = time;
      const elapsed = time - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Smooth cubic acceleration curve
      const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      ctx.clearRect(0, 0, w, h);

      // 1. Hyperspace Radial Speed Lines
      if (progress > 0.1) {
        const lineAlpha = Math.min(0.7, (progress - 0.1) * 1.6) * (1 - progress * 0.5);
        ctx.strokeStyle = `rgba(254, 240, 138, ${lineAlpha})`;
        ctx.lineWidth = 2.5;
        const numBeams = 20;
        for (let b = 0; b < numBeams; b++) {
          const bAngle = (b / numBeams) * Math.PI * 2 + progress * 0.7;
          const innerR = 25 + progress * 90;
          const outerR = Math.max(w, h) * (0.35 + progress * 1.4);
          ctx.beginPath();
          ctx.moveTo(originX + Math.cos(bAngle) * innerR, originY + Math.sin(bAngle) * innerR);
          ctx.lineTo(originX + Math.cos(bAngle) * outerR, originY + Math.sin(bAngle) * outerR);
          ctx.stroke();
        }
      }

      // 2. 3D Concentric Neon Rings expanding towards viewer
      const numRings = 5;
      for (let r = 0; r < numRings; r++) {
        const ringProgress = (progress * 2.4 + r / numRings) % 1;
        const ringRadius = Math.pow(ringProgress, 1.7) * Math.max(w, h) * 0.9;
        const ringAlpha = Math.sin(ringProgress * Math.PI) * (1 - progress * 0.25);
        ctx.beginPath();
        ctx.arc(originX, originY, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = r % 2 === 0 ? `rgba(250, 204, 21, ${ringAlpha})` : `rgba(56, 189, 248, ${ringAlpha})`;
        ctx.lineWidth = Math.max(1.5, ringProgress * 7);
        ctx.stroke();
      }

      // 3. 3D Stars & Floating Musical Notes
      stars.forEach((p) => {
        // Accelerate towards camera
        const zSpeed = (14 + ease * 40) * p.speed;
        p.z -= zSpeed * frameScale;
        if (p.z <= 10) {
          p.z = 1000;
        }

        const k = 420 / p.z;
        const px = originX + p.x * k;
        const py = originY + p.y * k;
        const size = Math.max(1, (1 - p.z / 1000) * 18);
        const alpha = Math.min(1, (1 - p.z / 1000) * 1.6);

        if (px >= -60 && px <= w + 60 && py >= -60 && py <= h + 60) {
          ctx.save();
          ctx.translate(px, py);
          if (p.isNote) {
            p.rot += p.rotSpeed * frameScale;
            ctx.rotate(p.rot);
            ctx.font = `bold ${Math.floor(size * 1.8 + 12)}px monospace`;
            ctx.fillStyle = p.color;
            ctx.globalAlpha = alpha;
            ctx.fillText(p.symbol, -size, size / 2);
          } else {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.arc(0, 0, size, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      });

      // 4. Climax Flash Bloom Transition
      if (progress > 0.72) {
        const flashAlpha = Math.sin((progress - 0.72) * (1 / 0.28) * Math.PI * 0.5) * 0.92;
        ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
        ctx.fillRect(0, 0, w, h);
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        diveCanvas.classList.remove('active');
        ctx.clearRect(0, 0, w, h);
        if (onComplete) onComplete();
      }
    }

    requestAnimationFrame(animate);
  }

  // --- 3D Dive Into Music Box Animation ---
  function triggerDiveIntoMusicBox() {
    if (!introSplash || introSplash.classList.contains('diving')) return;
    play8BitChime('dive');
    introSplash.classList.add('diving');

    run3DCinematicDive(() => {
      introSplash.classList.add('hidden');
      introSplash.classList.remove('diving');
      showToast('🎶 Đã bước vào thế giới âm nhạc Boxmusic!');
    });
  }

  function runIntroProgress() {
    if (!introSplash) return;
    introSplash.classList.remove('hidden', 'diving');
    segBlocks.forEach(b => b.classList.remove('filled'));
    let count = 0;
    const total = segBlocks.length;
    
    const interval = setInterval(() => {
      if (count < total) {
        segBlocks[count].classList.add('filled');
        count++;
        if (introLoadingText) {
          introLoadingText.textContent = `LOADING... ${Math.floor((count / total) * 100)}%`;
        }
      } else {
        clearInterval(interval);
        if (introLoadingText) {
          introLoadingText.textContent = 'READY! CLICK START';
        }
      }
    }, 85);
  }

  // Auto run loading progress on startup
  runIntroProgress();

  if (btnIntroStart) btnIntroStart.addEventListener('click', triggerDiveIntoMusicBox);
  if (introSkipBtn) introSkipBtn.addEventListener('click', triggerDiveIntoMusicBox);
  if (btnWarnYes) btnWarnYes.addEventListener('click', triggerDiveIntoMusicBox);
  if (btnWarnNo) btnWarnNo.addEventListener('click', triggerDiveIntoMusicBox);
  if (btnReplayIntro) btnReplayIntro.addEventListener('click', runIntroProgress);

  // Click on the music box itself triggers 3D dive
  const pixelMusicBox = document.getElementById('pixel-music-box');
  if (pixelMusicBox) pixelMusicBox.addEventListener('click', triggerDiveIntoMusicBox);

  // --- Android PWA Installation Management ---
  let deferredInstallPrompt = null;
  const btnInstallAndroid = document.getElementById('btn-install-android');
  const introInstallBtn = document.getElementById('intro-install-btn');
  const btnBannerInstall = document.getElementById('btn-banner-install');
  const modalInstallGuide = document.getElementById('modal-install-guide');
  const btnCloseInstallModal = document.getElementById('btn-close-install-modal');
  const btnModalGotIt = document.getElementById('btn-modal-got-it');
  const directInstallContainer = document.getElementById('direct-install-container');
  const btnTriggerPwaInstall = document.getElementById('btn-trigger-pwa-install');
  const retroInstallBanner = document.getElementById('retro-install-banner');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (directInstallContainer) directInstallContainer.style.display = 'block';
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (modalInstallGuide) modalInstallGuide.classList.add('hidden');
    if (retroInstallBanner) retroInstallBanner.style.display = 'none';
    showToast('🎉 Boxmusic đã được cài đặt thành công lên màn hình điện thoại!');
  });

  function openInstallModal() {
    if (!modalInstallGuide) return;
    if (deferredInstallPrompt && directInstallContainer) {
      directInstallContainer.style.display = 'block';
    }
    modalInstallGuide.classList.remove('hidden');
  }

  function closeInstallModal() {
    if (!modalInstallGuide) return;
    modalInstallGuide.classList.add('hidden');
  }

  async function handleInstallTrigger() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try {
        const choice = await deferredInstallPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          showToast('Đang cài đặt Boxmusic vào điện thoại...');
          deferredInstallPrompt = null;
          closeInstallModal();
          return;
        }
      } catch (err) {}
    }
    openInstallModal();
  }

  if (btnInstallAndroid) btnInstallAndroid.addEventListener('click', handleInstallTrigger);
  if (introInstallBtn) introInstallBtn.addEventListener('click', handleInstallTrigger);
  if (btnBannerInstall) btnBannerInstall.addEventListener('click', handleInstallTrigger);
  if (btnTriggerPwaInstall) btnTriggerPwaInstall.addEventListener('click', handleInstallTrigger);
  if (btnCloseInstallModal) btnCloseInstallModal.addEventListener('click', closeInstallModal);
  if (btnModalGotIt) btnModalGotIt.addEventListener('click', closeInstallModal);
  if (modalInstallGuide) {
    modalInstallGuide.addEventListener('click', (e) => {
      if (e.target === modalInstallGuide) closeInstallModal();
    });
  }

  // --- Dynamic Retro Greeting ---
  function updateGreeting() {
    if (!greetingTime) return;
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      greetingTime.textContent = 'CHÀO BUỔI SÁNG ☕';
    } else if (hour >= 12 && hour < 18) {
      greetingTime.textContent = 'CHÀO BUỔI CHIỀU 🍃';
    } else {
      greetingTime.textContent = 'CHÀO BUỔI TỐI ✨';
    }
  }
  updateGreeting();

  // --- Retro Artwork Mode Toggle (Card / Vinyl) ---
  let isVinylView = false;
  if (btnToggleArtMode) {
    btnToggleArtMode.addEventListener('click', () => {
      isVinylView = !isVinylView;
      if (isVinylView) {
        if (retroCardView) retroCardView.style.display = 'none';
        if (retroVinylView) retroVinylView.style.display = 'flex';
        artModeText.textContent = 'Ảnh Bìa 🎴';
        showToast('Chế độ: Đĩa Than 💿');
      } else {
        if (retroCardView) retroCardView.style.display = 'flex';
        if (retroVinylView) retroVinylView.style.display = 'none';
        artModeText.textContent = 'Đĩa Than 💿';
        showToast('Chế độ: Thẻ Bo Tròn 🎴');
      }
    });
  }

  // --- Genre Chips Quick Search ---
  genreChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const q = chip.getAttribute('data-query');
      if (q && searchInput) {
        searchInput.value = q;
        if (searchClearBtn) searchClearBtn.classList.add('visible');
        performSearch(q);
      }
    });
  });

  // --- Network Status ---
  function updateNetworkStatus(serverOk) {
    const isOnline = (typeof serverOk === 'boolean') ? serverOk : navigator.onLine;
    if (networkBadge) {
      networkBadge.className = `network-badge ${isOnline ? 'online' : 'offline'}`;
      if (networkStatusText) {
        if (!isOnline) {
          networkStatusText.textContent = 'Ngoại tuyến';
        } else if (activeApiBase && activeApiBase.includes('trycloudflare.com')) {
          networkStatusText.textContent = '4G/Từ xa';
        } else {
          networkStatusText.textContent = 'Trực tuyến';
        }
      }
    }
    if (searchOfflineNotice) {
      searchOfflineNotice.style.display = isOnline ? 'none' : 'block';
    }
    if (isOnline && searchPlaceholder && searchResultsList && searchResultsList.children.length === 0) {
      searchPlaceholder.style.display = 'block';
    } else if (!isOnline && searchPlaceholder) {
      searchPlaceholder.style.display = 'none';
    }
  }

  window.addEventListener('online', () => {
    updateNetworkStatus(true);
    showToast('🟢 Đã kết nối mạng trở lại!');
  });
  window.addEventListener('offline', () => {
    updateNetworkStatus(false);
    showToast('🟠 Thiết bị đang ngoại tuyến. Nhạc trong Thư viện vẫn phát bình thường 100%!');
  });
  updateNetworkStatus();

  // --- Toast Notifications ---
  function showToast(msg, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // --- Tab Navigation & One-Handed Swipes ---
  function switchTab(tabId) {
    navItems.forEach((b) => {
      const active = b.getAttribute('data-tab') === tabId;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });

    document.querySelectorAll('.view-panel').forEach((panel) => {
      panel.classList.remove('active');
    });

    const targetPanel = document.getElementById(tabId);
    if (targetPanel) {
      targetPanel.classList.add('active');
    }

    if (tabId === 'library-view') {
      loadLibrary();
    } else if (tabId === 'playlist-view') {
      loadPlaylists();
    }
  }

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  document.querySelectorAll('[data-goto]').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.goto));
  });

  // --- One-Handed Swipe Gestures (Lướt qua trái / phải 1 tay) ---
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  document.addEventListener('touchstart', (e) => {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;
    const elapsedTime = Date.now() - touchStartTime;

    if (elapsedTime > 800) return;

    const isHorizontalSwipe = Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.35;
    const isVerticalSwipe = Math.abs(diffY) > 50 && Math.abs(diffY) > Math.abs(diffX) * 1.35;

    const target = e.target;
    if (target.closest('input, select, button, .retro-modal-overlay, .retro-tabs, .genre-chips-scroll')) return;
    const isInsideFullPlayer = fullPlayer && fullPlayer.classList.contains('open');
    const isInsideMiniPlayer = target.closest('#mini-player');

    // 1. Gesture in Full Player
    if (isInsideFullPlayer) {
      if (isHorizontalSwipe) {
        if (diffX < 0) {
          // Swipe Left -> Next Track
          window.musicPlayer.next();
          showToast('⏭ BÀI TIẾP THEO');
        } else {
          // Swipe Right -> Previous Track
          window.musicPlayer.prev();
          showToast('⏮ BÀI TRƯỚC');
        }
      } else if (isVerticalSwipe && diffY > 0) {
        // Swipe Down -> Dismiss Full Player
        setFullPlayerOpen(false);
      }
      return;
    }

    // 2. Gesture in Mini Player
    if (isInsideMiniPlayer && isHorizontalSwipe) {
      if (diffX < 0) {
        window.musicPlayer.next();
        showToast('⏭ BÀI TIẾP THEO');
      } else {
        window.musicPlayer.prev();
        showToast('⏮ BÀI TRƯỚC');
      }
      return;
    }

    // 3. Gesture on Main Screens: Swipe Left / Right across 3 tabs
    if (isHorizontalSwipe) {
      const activeTabBtn = document.querySelector('.bottom-nav .nav-item.active');
      const activeTabId = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'library-view';

      if (diffX < 0) {
        if (activeTabId === 'library-view') {
          switchTab('playlist-view');
          showToast('📑 LƯỚT SANG PLAYLIST');
        } else if (activeTabId === 'playlist-view') {
          switchTab('search-view');
          showToast('🔍 LƯỚT SANG TÌM KIẾM');
        }
      } else if (diffX > 0) {
        if (activeTabId === 'search-view') {
          switchTab('playlist-view');
          showToast('📑 LƯỚT SANG PLAYLIST');
        } else if (activeTabId === 'playlist-view') {
          switchTab('library-view');
          showToast('📁 LƯỚT SANG THƯ VIỆN');
        }
      }
    }
  }, { passive: true });

  // --- Library Management ---
  async function loadLibrary(savedSong = null) {
    const version = ++libraryLoadVersion;
    try {
      const songs = savedSong
        ? [savedSong, ...librarySongs.filter((song) => song.id !== savedSong.id)]
        : await window.musicDB.getAllSongs();
      if (version !== libraryLoadVersion) return;
      const stats = await window.musicDB.getStats(songs);
      if (version !== libraryLoadVersion) return;
      librarySongs = songs;

      storageStats.textContent = `${stats.count} bài • ${stats.totalMB} MB`;
      updateDeviceStorageInfo(stats.count, stats.totalBytes || 0);

      // Update Modern Dashboard Bar
      const favCount = librarySongs.filter((s) => s.favorite).length;
      const dashSongCount = document.getElementById('dash-song-count');
      const dashStorageMb = document.getElementById('dash-storage-mb');
      const dashFavCount = document.getElementById('dash-fav-count');
      if (dashSongCount) dashSongCount.textContent = stats.count;
      if (dashStorageMb) dashStorageMb.textContent = `${stats.totalMB} MB`;
      if (dashFavCount) dashFavCount.textContent = favCount;

      downloadedIds.clear();
      librarySongs.forEach((s) => downloadedIds.add(s.id));

      renderLibraryList();
      if (playlistView.classList.contains('active')) loadPlaylists();
    } catch (err) {
      console.error('Failed to load library:', err);
    }
  }

  // --- Device Storage & Vault Status (Mobile vs PC) ---
  async function updateDeviceStorageInfo(songCount = 0, totalBytes = 0) {
    const badgeEl = document.getElementById('vault-device-badge');
    const freeEl = document.getElementById('vault-free-space');
    const pathEl = document.getElementById('vault-path-text');
    const barEl = document.getElementById('vault-progress-bar');
    if (!badgeEl || !freeEl || !pathEl) return;

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.innerWidth <= 768);
    const isAndroid = /Android/i.test(navigator.userAgent);

    if (isMobile) {
      badgeEl.textContent = isAndroid ? '📱 THIẾT BỊ ANDROID' : '📱 THIẾT BỊ DI ĐỘNG';
      pathEl.textContent = '/storage/emulated/0/Boxmusic';
    } else {
      badgeEl.textContent = '💻 MÁY TÍNH (PC)';
      pathEl.textContent = 'C:\\Users\\AppData\\Boxmusic';
    }

    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const quotaBytes = estimate.quota || (64 * 1024 * 1024 * 1024);
        const usageBytes = estimate.usage || totalBytes;
        const freeBytes = Math.max(0, quotaBytes - usageBytes);

        const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);
        const usedMB = (usageBytes / (1024 * 1024)).toFixed(1);
        const percent = Math.min(100, Math.max(5, Math.round((usageBytes / quotaBytes) * 100)));

        freeEl.textContent = `TRỐNG: ${freeGB} GB (${usedMB} MB ĐÃ DÙNG)`;
        if (barEl) barEl.style.width = `${percent}%`;
      } catch (e) {
        freeEl.textContent = `TRỐNG: KHẢ DỤNG (${songCount} BÀI)`;
        if (barEl) barEl.style.width = '10%';
      }
    } else {
      freeEl.textContent = `TRỐNG: KHẢ DỤNG (${songCount} BÀI)`;
      if (barEl) barEl.style.width = '10%';
    }
  }

  // --- Vault Backup & Restore (Bảo vệ dữ liệu bài hát khi Cập nhật Phiên bản) ---
  const btnExportVault = document.getElementById('btn-export-vault');
  const btnImportVault = document.getElementById('btn-import-vault');
  const vaultFileInput = document.getElementById('vault-file-input');

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(';base64,');
    const contentType = (parts[0].split(':')[1] || 'audio/mp4');
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  }

  if (btnExportVault) {
    btnExportVault.addEventListener('click', async () => {
      try {
        const songs = await window.musicDB.getAllSongs();
        if (!songs || songs.length === 0) {
          showToast('ℹ️ Thư viện chưa có bài hát nào để sao lưu!');
          return;
        }

        showToast(`📦 Đang chuẩn bị sao lưu ${songs.length} bài hát...`);
        const backupSongs = [];
        for (let i = 0; i < songs.length; i++) {
          const s = songs[i];
          let audioB64 = null;
          if (s.audioBlob) {
            audioB64 = await blobToBase64(s.audioBlob);
          }
          let thumbB64 = null;
          if (s.thumbnailBlob) {
            thumbB64 = await blobToBase64(s.thumbnailBlob);
          }
          backupSongs.push({
            id: s.id,
            title: s.title,
            artist: s.artist,
            duration: s.duration,
            seconds: s.seconds,
            source: s.source,
            favorite: s.favorite,
            audioMime: s.audioMime || 'audio/mp4',
            audioBase64: audioB64,
            thumbnailBase64: thumbB64,
            createdAt: s.createdAt || Date.now()
          });
        }

        const backupData = {
          app: 'Boxmusic',
          version: '1.0.3',
          exportDate: new Date().toISOString(),
          totalSongs: backupSongs.length,
          songs: backupSongs
        };

        const jsonStr = JSON.stringify(backupData);
        const jsonBlob = new Blob([jsonStr], { type: 'application/json' });
        const dlUrl = URL.createObjectURL(jsonBlob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.href = dlUrl;
        a.download = `Boxmusic_Backup_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(dlUrl);

        showToast(`✅ Đã xuất tệp sao lưu Thư viện (${backupSongs.length} bài) thành công!`);
      } catch (err) {
        console.error('Export vault error:', err);
        showToast('❌ Lỗi khi xuất tệp sao lưu!');
      }
    });
  }

  if (btnImportVault && vaultFileInput) {
    btnImportVault.addEventListener('click', () => {
      vaultFileInput.value = '';
      vaultFileInput.click();
    });

    vaultFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      showToast('📥 Đang đọc tệp sao lưu Thư viện...');
      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data || !Array.isArray(data.songs)) {
          showToast('❌ Tệp sao lưu không đúng định dạng Boxmusic!');
          return;
        }

        let importedCount = 0;
        showToast(`⏳ Đang nạp ${data.songs.length} bài hát vào bộ nhớ máy...`);

        for (const s of data.songs) {
          if (!s.audioBase64) continue;
          const restoredBlob = dataUrlToBlob(s.audioBase64);
          let restoredThumb = null;
          if (s.thumbnailBase64) {
            restoredThumb = dataUrlToBlob(s.thumbnailBase64);
          }

          const restoredSong = {
            id: s.id,
            title: s.title || 'Bài hát không tên',
            artist: s.artist || 'Không rõ nghệ sĩ',
            duration: s.duration || '--:--',
            seconds: s.seconds || 0,
            audioBlob: restoredBlob,
            thumbnailBlob: restoredThumb,
            audioMime: s.audioMime || 'audio/mp4',
            sizeBytes: restoredBlob.size,
            source: s.source || 'local',
            favorite: !!s.favorite,
            createdAt: s.createdAt || Date.now()
          };

          await window.musicDB.saveSong(restoredSong);
          importedCount++;
        }

        await loadLibrary();
        showToast(`🎉 Đã khôi phục thành công ${importedCount} bài hát vào Thư viện!`);
      } catch (err) {
        console.error('Import vault error:', err);
        showToast('❌ Lỗi khi khôi phục bài hát từ tệp sao lưu!');
      }
    });
  }

  // --- Settings Modal & PC Server IP Configuration ---
  const modalSettings = document.getElementById('modal-settings');
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const settingServerIp = document.getElementById('setting-server-ip');
  const btnSaveServerIp = document.getElementById('btn-save-server-ip');
  const btnPingServer = document.getElementById('btn-ping-server');
  const btnScanServer = document.getElementById('btn-scan-server');
  const settingRemoteTunnelUrl = document.getElementById('setting-remote-tunnel-url');
  const btnSaveRemoteTunnel = document.getElementById('btn-save-remote-tunnel');
  const btnPingRemoteTunnel = document.getElementById('btn-ping-remote-tunnel');
  const btnFetchRemoteTunnel = document.getElementById('btn-fetch-remote-tunnel');
  const serverPingResult = document.getElementById('server-ping-result');

  if (btnOpenSettings) {
    btnOpenSettings.addEventListener('click', async () => {
      if (settingServerIp) settingServerIp.value = customApiBase || autoDiscoveredApi || 'http://192.168.1.12:3000';
      if (settingRemoteTunnelUrl) settingRemoteTunnelUrl.value = remoteTunnelUrl || '';
      if (serverPingResult) {
        serverPingResult.className = 'server-ping-status';
        serverPingResult.textContent = '';
      }
      modalSettings.classList.remove('hidden');
      const stats = await window.musicDB.getStats();
      updateDeviceStorageInfo(stats.count, stats.totalBytes || 0);
    });
  }
  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => {
      modalSettings.classList.add('hidden');
    });
  }

  if (btnSaveServerIp) {
    btnSaveServerIp.addEventListener('click', () => {
      let val = (settingServerIp ? settingServerIp.value : '').trim();
      if (!val) {
        showToast('⚠️ Vui lòng nhập địa chỉ IP máy chủ');
        return;
      }
      if (!val.startsWith('http://') && !val.startsWith('https://')) {
        val = 'http://' + val;
      }
      val = val.replace(/\/+$/, '');
      customApiBase = val;
      activeApiBase = val;
      try { localStorage.setItem('boxmusic_custom_api_base', val); } catch (e) {}
      showToast(`✅ Đã lưu máy chủ LAN: ${val}`);
      if (btnPingServer) btnPingServer.click();
    });
  }

  if (btnPingServer) {
    btnPingServer.addEventListener('click', async () => {
      const ip = (settingServerIp ? settingServerIp.value.trim() : '') || getApiBase();
      serverPingResult.className = 'server-ping-status loading';
      serverPingResult.textContent = '⏳ Đang kiểm tra kết nối tới ' + ip + '...';
      const ok = await pingServer(ip, 2500);
      if (ok) {
        activeApiBase = ip;
        serverPingResult.className = 'server-ping-status success';
        serverPingResult.textContent = '✓ Kết nối thành công! Máy chủ LAN đang chạy.';
        updateNetworkStatus(true);
        syncServerInfo(ip);
      } else {
        serverPingResult.className = 'server-ping-status error';
        serverPingResult.textContent = '✕ Không thể kết nối. Hãy kiểm tra lại IP hoặc chắc chắn PC đang chạy "node server.js".';
        updateNetworkStatus(false);
      }
    });
  }

  if (btnScanServer) {
    btnScanServer.addEventListener('click', async () => {
      serverPingResult.className = 'server-ping-status loading';
      serverPingResult.textContent = '🔍 Đang tự động dò tìm máy chủ Boxmusic trên mạng LAN...';
      const found = await autoScanServer();
      if (found) {
        if (settingServerIp) settingServerIp.value = found;
        serverPingResult.className = 'server-ping-status success';
        serverPingResult.textContent = `✓ Đã tìm thấy máy chủ tại: ${found}!`;
        updateNetworkStatus(true);
        showToast(`🎉 Tìm thấy máy chủ: ${found}`);
      } else {
        serverPingResult.className = 'server-ping-status error';
        serverPingResult.textContent = '✕ Không tìm thấy máy chủ. Hãy bật "node server.js" trên máy tính!';
      }
    });
  }

  if (btnSaveRemoteTunnel) {
    btnSaveRemoteTunnel.addEventListener('click', () => {
      let val = (settingRemoteTunnelUrl ? settingRemoteTunnelUrl.value : '').trim();
      if (!val) {
        showToast('⚠️ Vui lòng nhập link Cloudflare từ xa');
        return;
      }
      if (!val.startsWith('http://') && !val.startsWith('https://')) {
        val = 'https://' + val;
      }
      val = val.replace(/\/+$/, '');
      remoteTunnelUrl = val;
      activeApiBase = val;
      try { localStorage.setItem('boxmusic_remote_tunnel_url', val); } catch (e) {}
      showToast(`🌐 Đã lưu link Cloudflare từ xa: ${val}`);
      if (btnPingRemoteTunnel) btnPingRemoteTunnel.click();
    });
  }

  if (btnPingRemoteTunnel) {
    btnPingRemoteTunnel.addEventListener('click', async () => {
      const tunnel = (settingRemoteTunnelUrl ? settingRemoteTunnelUrl.value.trim() : '') || remoteTunnelUrl;
      if (!tunnel) {
        serverPingResult.className = 'server-ping-status error';
        serverPingResult.textContent = '✕ Chưa có link Cloudflare. Hãy bấm "LẤY LINK TỰ ĐỘNG" hoặc nhập link!';
        return;
      }
      serverPingResult.className = 'server-ping-status loading';
      serverPingResult.textContent = '⏳ Đang kiểm tra kết nối 4G/Cloudflare tới ' + tunnel + '...';
      const ok = await pingServer(tunnel, 4000);
      if (ok) {
        activeApiBase = tunnel;
        serverPingResult.className = 'server-ping-status success';
        serverPingResult.textContent = '✓ Kết nối 4G/Cloudflare thành công! Tải nhạc từ mọi nơi mượt mà.';
        updateNetworkStatus(true);
        showToast('🎉 Kết nối từ xa Cloudflare thành công!');
      } else {
        serverPingResult.className = 'server-ping-status error';
        serverPingResult.textContent = '✕ Không thể kết nối Cloudflare. Hãy kiểm tra xem "node server.js" trên máy tính có đang mở không.';
        updateNetworkStatus(false);
      }
    });
  }

  if (btnFetchRemoteTunnel) {
    btnFetchRemoteTunnel.addEventListener('click', async () => {
      serverPingResult.className = 'server-ping-status loading';
      serverPingResult.textContent = '🔄 Đang truy vấn link Cloudflare từ máy tính qua mạng LAN...';
      const localBase = customApiBase || autoDiscoveredApi || 'http://192.168.1.12:3000';
      const info = await syncServerInfo(localBase);
      if (info && info.publicUrl) {
        if (settingRemoteTunnelUrl) settingRemoteTunnelUrl.value = info.publicUrl;
        serverPingResult.className = 'server-ping-status success';
        serverPingResult.textContent = `✓ Đã nhận link Cloudflare từ máy tính: ${info.publicUrl}`;
        showToast('🔗 Đồng bộ link Cloudflare thành công!');
      } else {
        serverPingResult.className = 'server-ping-status error';
        serverPingResult.textContent = '✕ Không kết nối được LAN máy tính. Bạn hãy xem dòng trycloudflare.com trên màn hình PC và dán vào ô trên!';
      }
    });
  }

  // Network badge click: quick ping check or open settings
  if (networkBadge) {
    networkBadge.addEventListener('click', async () => {
      showToast('🔍 Đang kiểm tra kết nối máy chủ PC...');
      const ok = await pingServer(getApiBase(), 2000);
      if (ok) {
        updateNetworkStatus(true);
        showToast('✅ Máy chủ PC đang hoạt động tốt!');
      } else {
        updateNetworkStatus(false);
        showToast('⚠️ Không kết nối được PC. Nhấn ⚙️ CÀI ĐẶT để kiểm tra kết nối!');
      }
    });
  }

  // --- Custom Playlist Management (Hoàn Toàn Offline 100%) ---
  let userPlaylists = [];
  let playlistSongMap = new Map();
  let currentSelectedSongForPlaylist = null;
  let playlistLoadVersion = 0;
  let playlistCoverUrls = [];
  let detailCoverUrls = [];
  const playlistSearch = document.getElementById('playlist-search');
  const playlistSort = document.getElementById('playlist-sort');
  const playlistNoResults = document.getElementById('playlist-no-results');

  function releaseCoverUrls(urls) {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls.length = 0;
  }

  function playlistCoverMarkup(songs, urls, index = 0) {
    const covers = songs.filter((song) => song.thumbnailBlob).slice(0, 4);
    let images = '';
    if (covers.length) {
      const tiles = covers.length === 1 ? covers : Array.from({ length: 4 }, (_, i) => covers[i % covers.length]);
      images = `<span class="cover-images ${covers.length === 1 ? 'single' : ''}">${tiles.map((song) => {
        const url = URL.createObjectURL(song.thumbnailBlob);
        urls.push(url);
        return `<img src="${url}" alt="" loading="lazy">`;
      }).join('')}</span>`;
    }
    return `<span class="cover-record"></span><span class="cover-star">✳</span>
      <span class="cover-caption">YOUR<br>MIXTAPE<small>THE SOUND OF YOU</small></span>${images}
      <span class="cover-index">MIX / ${String(index + 1).padStart(2, '0')}</span>`;
  }

  async function loadPlaylists() {
    const version = ++playlistLoadVersion;
    try {
      const [playlists, songs] = await Promise.all([
        window.musicDB.getAllPlaylists(), window.musicDB.getAllSongs()
      ]);
      if (version !== playlistLoadVersion) return;
      userPlaylists = playlists;
      playlistSongMap = new Map(songs.map((song) => [song.id, song]));
      renderPlaylists();
    } catch (e) {
      console.error('Failed to load playlists:', e);
      showToast('Không thể tải playlist. Vui lòng thử lại.');
    }
  }

  function renderPlaylists() {
    if (!playlistCardsContainer) return;
    releaseCoverUrls(playlistCoverUrls);
    playlistCardsContainer.replaceChildren();
    const playlists = window.PlaylistUI.select(userPlaylists, playlistSearch.value, playlistSort.value, playlistSongMap);
    playlistStats.textContent = `${userPlaylists.length} playlist`;
    playlistEmpty.style.display = userPlaylists.length ? 'none' : 'block';
    playlistNoResults.hidden = !userPlaylists.length || !!playlists.length;

    const fragment = document.createDocumentFragment();
    playlists.forEach((pl) => {
      const songs = window.PlaylistUI.songsFor(pl, playlistSongMap);
      const duration = window.PlaylistUI.durationLabel(songs);
      const card = document.createElement('article');
      card.className = 'playlist-card';
      card.dataset.palette = window.PlaylistUI.palette(pl.id);
      card.innerHTML = `
        <button class="playlist-card-open" type="button" aria-label="Mở playlist ${escapeHtml(pl.name)}">
          <span class="playlist-cover" aria-hidden="true">${playlistCoverMarkup(songs, playlistCoverUrls, userPlaylists.indexOf(pl))}</span>
          <span class="playlist-card-info">
            <span class="playlist-card-title" title="${escapeHtml(pl.name)}">${escapeHtml(pl.name)}</span>
            <span class="playlist-card-count">${songs.length} bài hát${duration ? ` · ${duration}` : ''}</span>
          </span>
        </button>
        <div class="playlist-card-actions">
          <span class="playlist-offline-tag">● OFFLINE MIX</span>
          <button class="btn-pl-delete" type="button" aria-label="Xóa playlist ${escapeHtml(pl.name)}" title="Xóa playlist">×</button>
          <button class="btn-pl-play" type="button" aria-label="Phát playlist ${escapeHtml(pl.name)}" title="Phát playlist" ${songs.length ? '' : 'disabled'}>▶</button>
        </div>`;
      card.querySelector('.playlist-card-open').addEventListener('click', () => openPlaylistDetailModal(pl.id));
      card.querySelector('.btn-pl-play').addEventListener('click', () => playPlaylistById(pl.id));
      card.querySelector('.btn-pl-delete').addEventListener('click', async () => {
        if (!confirm(`Bạn có chắc muốn xóa playlist "${pl.name}"? (Bài hát trong thư viện vẫn được giữ nguyên)`)) return;
        try {
          await window.musicDB.deletePlaylist(pl.id);
          showToast(`Đã xóa playlist: ${pl.name}`);
          await loadPlaylists();
        } catch (err) { showToast(`Không thể xóa playlist: ${err.message}`); }
      });
      fragment.appendChild(card);
    });
    playlistCardsContainer.appendChild(fragment);
  }

  playlistSearch.addEventListener('input', renderPlaylists);
  playlistSort.addEventListener('change', renderPlaylists);
  document.getElementById('btn-reset-playlist-search').addEventListener('click', () => {
    playlistSearch.value = '';
    renderPlaylists();
    playlistSearch.focus();
  });

  async function playPlaylistById(playlistId) {
    const pl = await window.musicDB.getPlaylist(playlistId);
    if (!pl || !pl.songIds || pl.songIds.length === 0) {
      showToast('ℹ️ Playlist này chưa có bài hát nào!');
      return;
    }

    const allSongs = await window.musicDB.getAllSongs();
    const songMap = new Map();
    allSongs.forEach((s) => songMap.set(s.id, s));

    const queue = [];
    pl.songIds.forEach((id) => {
      if (songMap.has(id)) queue.push(songMap.get(id));
    });

    if (queue.length === 0) {
      showToast('⚠️ Không tìm thấy bài hát trong thư viện!');
      return;
    }

    if (window.musicPlayer) {
      window.musicPlayer.setQueue(queue, 0, true);
      showToast(`▶ Đang phát playlist: ${pl.name} (${queue.length} bài)`);
    }
  }

  // Create Playlist Modal
  const modalPlaylistCreate = document.getElementById('modal-playlist-create');
  const inputPlaylistName = document.getElementById('input-playlist-name');
  const btnConfirmCreatePl = document.getElementById('btn-confirm-create-pl');
  const btnCancelCreatePl = document.getElementById('btn-cancel-create-pl');
  const btnCloseCreatePl = document.getElementById('btn-close-create-pl');
  let createPlaylistOpener = null;
  let addPlaylistOpener = null;
  let detailPlaylistOpener = null;

  function openPlaylistCreateModal() {
    if (inputPlaylistName) inputPlaylistName.value = '';
    createPlaylistOpener = document.activeElement;
    if (modalPlaylistCreate) modalPlaylistCreate.classList.remove('hidden');
    setTimeout(() => inputPlaylistName && inputPlaylistName.focus(), 150);
  }

  if (btnCreatePlaylist) {
    btnCreatePlaylist.addEventListener('click', () => {
      currentSelectedSongForPlaylist = null;
      openPlaylistCreateModal();
    });
  }
  document.getElementById('btn-create-first-playlist').addEventListener('click', () => {
    currentSelectedSongForPlaylist = null;
    openPlaylistCreateModal();
  });
  inputPlaylistName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); btnConfirmCreatePl.click(); }
  });
  function closePlaylistCreate() {
    modalPlaylistCreate.classList.add('hidden');
    currentSelectedSongForPlaylist = null;
    if (createPlaylistOpener && createPlaylistOpener.isConnected) createPlaylistOpener.focus();
  }
  btnCloseCreatePl.addEventListener('click', closePlaylistCreate);
  btnCancelCreatePl.addEventListener('click', closePlaylistCreate);

  if (btnConfirmCreatePl) {
    btnConfirmCreatePl.addEventListener('click', async () => {
      const name = inputPlaylistName ? inputPlaylistName.value.trim() : '';
      if (!name) {
        showToast('⚠️ Vui lòng nhập tên playlist');
        return;
      }
      btnConfirmCreatePl.disabled = true;
      try {
        const newPl = await window.musicDB.createPlaylist(name);
        if (modalPlaylistCreate) modalPlaylistCreate.classList.add('hidden');
        showToast(`✅ Đã tạo playlist: ${newPl.name}`);
        playlistSearch.value = '';

        if (currentSelectedSongForPlaylist) {
          await window.musicDB.addSongToPlaylist(newPl.id, currentSelectedSongForPlaylist.id);
          showToast(`✓ Đã thêm "${currentSelectedSongForPlaylist.title}" vào playlist "${newPl.name}"!`);
          currentSelectedSongForPlaylist = null;
          const modalAdd = document.getElementById('modal-add-to-playlist');
          if (modalAdd) modalAdd.classList.add('hidden');
        }
        await loadPlaylists();
        btnCreatePlaylist.focus();
      } catch (err) {
        showToast(`✕ Lỗi: ${err.message}`);
      } finally { btnConfirmCreatePl.disabled = false; }
    });
  }

  // Add Song to Playlist Modal
  const modalAddToPlaylist = document.getElementById('modal-add-to-playlist');
  const addPlSongTitle = document.getElementById('add-pl-song-title');
  const playlistSelectList = document.getElementById('playlist-select-list');
  const btnQuickNewPl = document.getElementById('btn-quick-new-pl');
  const btnCloseAddPl = document.getElementById('btn-close-add-pl');

  async function openAddToPlaylistModal(song) {
    addPlaylistOpener = document.activeElement;
    currentSelectedSongForPlaylist = song;
    if (addPlSongTitle) addPlSongTitle.textContent = song.title || 'Bài hát';
    const playlists = await window.musicDB.getAllPlaylists();

    if (playlistSelectList) {
      playlistSelectList.innerHTML = '';
      if (playlists.length === 0) {
        playlistSelectList.innerHTML = '<div style="font-size:0.75rem; color:#64748b; padding:10px; text-align:center;">Chưa có playlist nào. Nhấn nút bên dưới để tạo ngay!</div>';
      } else {
        playlists.forEach((pl) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'playlist-select-item';
          const count = (pl.songIds && pl.songIds.length) || 0;
          const alreadyIn = pl.songIds && pl.songIds.includes(song.id);
          item.innerHTML = `
            <span>📑 ${escapeHtml(pl.name)} (${count} bài)</span>
            <span>${alreadyIn ? '✓ Đã có' : '➕ Thêm'}</span>
          `;
          item.disabled = !!alreadyIn;
          item.addEventListener('click', async () => {
            item.disabled = true;
            try {
              await window.musicDB.addSongToPlaylist(pl.id, song.id);
              showToast(`✓ Đã thêm vào playlist "${pl.name}"!`);
              if (modalAddToPlaylist) modalAddToPlaylist.classList.add('hidden');
              currentSelectedSongForPlaylist = null;
              if (addPlaylistOpener && addPlaylistOpener.isConnected) addPlaylistOpener.focus();
              loadPlaylists();
            } catch (err) { item.disabled = false; showToast(`Không thể thêm bài hát: ${err.message}`); }
          });
          playlistSelectList.appendChild(item);
        });
      }
    }

    if (modalAddToPlaylist) {
      modalAddToPlaylist.classList.remove('hidden');
      setTimeout(() => btnCloseAddPl.focus(), 150);
    }
  }

  if (btnQuickNewPl) {
    btnQuickNewPl.addEventListener('click', () => {
      if (modalAddToPlaylist) modalAddToPlaylist.classList.add('hidden');
      openPlaylistCreateModal();
    });
  }
  if (btnCloseAddPl) {
    btnCloseAddPl.addEventListener('click', () => {
      if (modalAddToPlaylist) modalAddToPlaylist.classList.add('hidden');
      currentSelectedSongForPlaylist = null;
      if (addPlaylistOpener && addPlaylistOpener.isConnected) addPlaylistOpener.focus();
    });
  }

  // Playlist Detail Modal
  const modalPlaylistDetail = document.getElementById('modal-playlist-detail');
  const detailPlName = document.getElementById('detail-pl-name');
  const detailPlCount = document.getElementById('detail-pl-count');
  const detailPlSongList = document.getElementById('detail-pl-song-list');
  const detailPlEmpty = document.getElementById('detail-pl-empty');
  const btnPlayWholePlaylist = document.getElementById('btn-play-whole-playlist');
  const btnDeleteThisPlaylist = document.getElementById('btn-delete-this-playlist');
  const btnCloseDetailPl = document.getElementById('btn-close-detail-pl');
  let currentViewingPlaylistId = null;

  async function openPlaylistDetailModal(playlistId) {
    if (modalPlaylistDetail.classList.contains('hidden')) detailPlaylistOpener = document.activeElement;
    currentViewingPlaylistId = playlistId;
    try {
      const [pl, allSongs] = await Promise.all([
        window.musicDB.getPlaylist(playlistId), window.musicDB.getAllSongs()
      ]);
      if (!pl || currentViewingPlaylistId !== playlistId) return;
      releaseCoverUrls(detailCoverUrls);
      const songMap = new Map(allSongs.map((song) => [song.id, song]));
      const plSongs = window.PlaylistUI.songsFor(pl, songMap);
      const duration = window.PlaylistUI.durationLabel(plSongs);
      detailPlName.textContent = pl.name;
      document.getElementById('detail-pl-heading').textContent = pl.name;
      detailPlCount.textContent = `${plSongs.length} bài hát${duration ? ` · ${duration}` : ''}`;
      document.getElementById('detail-pl-date').textContent = pl.createdAt
        ? `Đã tạo ${new Date(pl.createdAt).toLocaleDateString('vi-VN')}` : '';
      const art = document.getElementById('detail-pl-art');
      art.parentElement.dataset.palette = window.PlaylistUI.palette(pl.id);
      art.innerHTML = playlistCoverMarkup(plSongs, detailCoverUrls, Math.max(0, userPlaylists.findIndex((item) => item.id === pl.id)));
      btnPlayWholePlaylist.disabled = !plSongs.length;
      detailPlSongList.replaceChildren();
      detailPlEmpty.style.display = plSongs.length ? 'none' : 'block';
      plSongs.forEach((song, index) => {
        let thumbnail = 'icons/icon.svg';
        if (song.thumbnailBlob) {
          thumbnail = URL.createObjectURL(song.thumbnailBlob);
          detailCoverUrls.push(thumbnail);
        }
        const row = document.createElement('div');
        row.className = 'song-card';
        row.innerHTML = `
          <span class="track-number">${String(index + 1).padStart(2, '0')}</span>
          <button class="track-open" type="button" aria-label="Phát ${escapeHtml(song.title)}">
            <img class="track-thumb" src="${thumbnail}" alt="" loading="lazy">
            <span class="song-info"><span class="song-title">${escapeHtml(song.title)}</span>
            <span class="song-meta">${escapeHtml(song.artist || 'Không rõ nghệ sĩ')}</span></span>
          </button>
          <span class="track-duration">${escapeHtml(song.duration || formatTime(song.seconds))}</span>
          <button class="action-btn delete-btn" type="button" aria-label="Xóa ${escapeHtml(song.title)} khỏi playlist" title="Xóa khỏi playlist">×</button>`;
        row.querySelector('.track-open').addEventListener('click', () => {
          if (window.musicPlayer) {
            window.musicPlayer.setQueue(plSongs, index, true);
            showToast(`Đang phát: ${song.title}`);
          }
        });
        row.querySelector('.delete-btn').addEventListener('click', async () => {
          try {
            await window.musicDB.removeSongFromPlaylist(pl.id, song.id);
            showToast(`Đã xóa khỏi playlist: ${song.title}`);
            await openPlaylistDetailModal(pl.id);
            await loadPlaylists();
          } catch (err) { showToast(`Không thể xóa bài hát: ${err.message}`); }
        });
        detailPlSongList.appendChild(row);
      });
      const wasHidden = modalPlaylistDetail.classList.contains('hidden');
      modalPlaylistDetail.classList.remove('hidden');
      if (wasHidden) setTimeout(() => btnCloseDetailPl.focus(), 150);
    } catch (err) { showToast(`Không thể mở playlist: ${err.message}`); }
  }

  function closePlaylistDetail() {
    modalPlaylistDetail.classList.add('hidden');
    currentViewingPlaylistId = null;
    releaseCoverUrls(detailCoverUrls);
    const firstCard = playlistCardsContainer.querySelector('.playlist-card-open');
    const opener = detailPlaylistOpener && detailPlaylistOpener.isConnected ? detailPlaylistOpener : firstCard;
    (opener || btnCreatePlaylist).focus();
  }

  document.getElementById('btn-playlist-goto-library').addEventListener('click', () => {
    closePlaylistDetail();
    switchTab('library-view');
    btnImportFile.focus();
  });

  if (btnPlayWholePlaylist) {
    btnPlayWholePlaylist.addEventListener('click', () => {
      if (currentViewingPlaylistId) {
        playPlaylistById(currentViewingPlaylistId);
        closePlaylistDetail();
      }
    });
  }
  if (btnDeleteThisPlaylist) {
    btnDeleteThisPlaylist.addEventListener('click', async () => {
      if (!currentViewingPlaylistId) return;
      const pl = await window.musicDB.getPlaylist(currentViewingPlaylistId);
      if (!pl) return;
      if (confirm(`Bạn có chắc muốn xóa playlist "${pl.name}"?`)) {
        await window.musicDB.deletePlaylist(currentViewingPlaylistId);
        closePlaylistDetail();
        showToast(`🗑️ Đã xóa playlist: ${pl.name}`);
        loadPlaylists();
      }
    });
  }
  if (btnCloseDetailPl) {
    btnCloseDetailPl.addEventListener('click', () => {
      closePlaylistDetail();
    });
  }

  const playlistModals = [modalPlaylistCreate, modalAddToPlaylist, modalPlaylistDetail];
  const closeButtons = [btnCloseCreatePl, btnCloseAddPl, btnCloseDetailPl];
  playlistModals.forEach((modal, index) => {
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    if (index === 2) modal.setAttribute('aria-labelledby', 'detail-pl-name');
    if (!modal.hasAttribute('aria-label') && !modal.hasAttribute('aria-labelledby')) {
      modal.setAttribute('aria-label', index === 0 ? 'Tạo playlist mới' : index === 1 ? 'Thêm vào playlist' : 'Chi tiết playlist');
    }
    closeButtons[index].setAttribute('aria-label', 'Đóng hộp thoại');
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeButtons[index].click();
    });
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeButtons[index].click(); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(modal.querySelectorAll('button:not(:disabled), input, select, [tabindex="0"]')).filter((el) => el.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  });

  // Full player add to playlist button
  const btnPlayerAddPlaylist = document.getElementById('btn-player-add-playlist');
  if (btnPlayerAddPlaylist) {
    btnPlayerAddPlaylist.addEventListener('click', () => {
      const cur = (window.musicPlayer && window.musicPlayer.getCurrentSong) ? window.musicPlayer.getCurrentSong() : null;
      if (cur) {
        openAddToPlaylistModal(cur);
      } else {
        showToast('⚠️ Không có bài hát nào đang phát');
      }
    });
  }

  // Close download dock button
  const dlDockClose = document.getElementById('dl-dock-close');
  if (dlDockClose) {
    dlDockClose.addEventListener('click', () => {
      if (downloadDock) downloadDock.classList.add('hidden');
    });
  }

  // Startup server connectivity check with LAN → 4G cache → Relay → LAN scan
  (async function initServerConnection() {
    // 1. Try local LAN first (fastest when at home)
    const localCandidate = window.location.protocol.startsWith('http')
      ? '' : customApiBase || autoDiscoveredApi || 'http://192.168.1.12:3000';
    const localOk = await pingServer(localCandidate, 1500);
    if (localOk) {
      activeApiBase = localCandidate;
      updateNetworkStatus(true);
      syncServerInfo(localCandidate); // auto-save tunnel URL + relay ID in background
      return;
    }

    // 2. Try saved tunnel URL (might be valid if server hasn't restarted)
    if (remoteTunnelUrl) {
      const remoteOk = await pingServer(remoteTunnelUrl, 3000);
      if (remoteOk) {
        activeApiBase = remoteTunnelUrl;
        updateNetworkStatus(true);
        showToast('🌐 Đã kết nối máy chủ Boxmusic qua mạng 4G/Cloudflare!');
        return;
      }
    }

    // 3. Try relay (kvdb.io) to get the latest tunnel URL — works even after server restart
    const relayUrl = await fetchFromRelay();
    if (relayUrl && relayUrl !== remoteTunnelUrl) {
      const relayOk = await pingServer(relayUrl, 3000);
      if (relayOk) {
        activeApiBase = relayUrl;
        updateNetworkStatus(true);
        showToast('🌐 Đã kết nối máy chủ Boxmusic qua 4G (relay tự động)!');
        return;
      }
    }

    // 4. Last resort: scan LAN (slow but thorough)
    const found = await autoScanServer();
    if (found) {
      activeApiBase = found;
      updateNetworkStatus(true);
      showToast(`🔗 Đã kết nối máy chủ: ${found}`);
      return;
    }

    updateNetworkStatus(false);
  })();

  function renderLibraryList() {
    releaseCoverUrls(libraryThumbnailUrls);
    librarySongList.innerHTML = '';

    let filtered = librarySongs;
    if (currentFilter === 'favorite') {
      filtered = librarySongs.filter((s) => s.favorite);
    } else if (currentFilter === 'youtube') {
      filtered = librarySongs.filter((s) => s.source === 'youtube');
    } else if (currentFilter === 'local') {
      filtered = librarySongs.filter((s) => s.source === 'local');
    }

    if (filtered.length === 0) {
      libraryEmpty.style.display = 'block';
      return;
    }
    libraryEmpty.style.display = 'none';

    const currentSong = (window.musicPlayer && window.musicPlayer.getCurrentSong) ? window.musicPlayer.getCurrentSong() : null;

    filtered.forEach((song, idx) => {
      const card = document.createElement('div');
      const isNowPlaying = currentSong && currentSong.id === song.id;
      card.className = `song-card ${isNowPlaying ? 'now-playing' : ''}`;
      card.dataset.songId = song.id;

      // Cover Art URL
      let thumbSrc = 'icons/icon.svg';
      if (song.thumbnailBlob) {
        thumbSrc = URL.createObjectURL(song.thumbnailBlob);
        libraryThumbnailUrls.push(thumbSrc);
      }

      const sourceBadge = song.source === 'youtube' ? 'YouTube' : 'Từ máy';
      const sizeMB = (song.sizeBytes / (1024 * 1024)).toFixed(1);

      card.innerHTML = `
        <div class="song-cover-stack">
          <div class="peeking-vinyl"></div>
          <div class="song-thumb-frame">
            <img class="song-thumb" src="${thumbSrc}" alt="thumb" loading="lazy">
            <div class="card-play-overlay">
              <span class="card-play-icon">${isNowPlaying ? '⏸' : '▶'}</span>
            </div>
          </div>
        </div>
        <div class="song-info">
          <div class="song-title-row">
            <span class="song-title">${escapeHtml(song.title)}</span>
          </div>
          <div class="song-meta">
            <span class="badge-tag">${sourceBadge}</span>
            <span class="song-artist-name">${escapeHtml(song.artist || 'Không rõ ca sĩ')}</span>
            <span class="meta-sep">•</span>
            <span class="song-duration-pill">${song.duration || formatTime(song.seconds)}</span>
            <span class="meta-sep">•</span>
            <span class="song-size">${sizeMB} MB</span>
          </div>
        </div>
        <div class="song-actions">
          <button class="action-btn add-to-pl-btn" type="button" title="Thêm vào Playlist">📑</button>
          <button class="action-btn favorite ${song.favorite ? 'active' : ''}" type="button" aria-label="Favorite">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          </button>
          <button class="action-btn delete-btn" type="button" aria-label="Delete">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>
      `;

      // Add to playlist button
      const plBtn = card.querySelector('.add-to-pl-btn');
      if (plBtn) {
        plBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openAddToPlaylistModal(song);
        });
      }

      // Play song on card tap
      card.addEventListener('click', (e) => {
        if (e.target.closest('.song-actions')) return;
        if (window.musicPlayer) {
          window.musicPlayer.setQueue(filtered, idx, true);
        }
        highlightNowPlayingCard(song.id);
      });

      // Favorite button
      const favBtn = card.querySelector('.favorite');
      favBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isFav = await window.musicDB.toggleFavorite(song.id);
        song.favorite = isFav;
        favBtn.classList.toggle('active', isFav);
        const dashFav = document.getElementById('dash-fav-count');
        if (dashFav) {
          const currentFavs = librarySongs.filter((s) => s.favorite).length;
          dashFav.textContent = currentFavs;
        }
        showToast(isFav ? 'Đã thêm vào Yêu thích ❤️' : 'Đã bỏ Yêu thích');
        if (currentFilter === 'favorite') {
          renderLibraryList();
        }
      });

      // Delete button
      const delBtn = card.querySelector('.delete-btn');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Bạn muốn xóa bài "${song.title}" khỏi máy?`)) {
          await window.musicDB.deleteSong(song.id);
          showToast(`Đã xóa "${song.title}"`);
          loadLibrary();
        }
      });

      librarySongList.appendChild(card);
    });
  }

  function highlightNowPlayingCard(id) {
    document.querySelectorAll('#library-song-list .song-card').forEach((card) => {
      card.classList.remove('now-playing');
      const eq = card.querySelector('.card-eq-indicator');
      if (eq) eq.remove();
    });

    librarySongList.querySelectorAll('.song-card').forEach((card) => {
      if (card.dataset.songId === id) {
        card.classList.add('now-playing');
        const titleEl = card.querySelector('.song-title');
        if (titleEl) {
          const eq = document.createElement('span');
          eq.className = 'card-eq-indicator';
          eq.innerHTML = '<span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span>';
          titleEl.appendChild(eq);
        }
      }
    });
  }

  // Filter pills
  filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      filterPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.getAttribute('data-filter');
      renderLibraryList();
    });
  });

  // --- Local File Import (MP3/MP4/M4A) ---
  if (btnImportFile && localFileInput) {
    btnImportFile.addEventListener('click', () => {
      localFileInput.click();
    });

    localFileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files || files.length === 0) return;

      showToast(`Đang nạp ${files.length} tệp âm thanh...`);

      let importedCount = 0;
      for (const file of files) {
        try {
          const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
          const durationSec = await getAudioDuration(file);

          const song = {
            id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            title: cleanName,
            artist: 'Tệp từ máy',
            duration: formatTime(durationSec),
            seconds: durationSec,
            audioBlob: file,
            thumbnailBlob: null,
            audioMime: file.type || 'audio/mp4',
            sizeBytes: file.size,
            source: 'local',
            favorite: false,
            createdAt: Date.now()
          };

          await window.musicDB.saveSong(song);
          importedCount++;
        } catch (err) {
          console.error('Error importing file:', file.name, err);
        }
      }

      localFileInput.value = '';
      showToast(`Đã thêm thành công ${importedCount} bài hát vào máy! 🎉`);
      await loadLibrary();
    });
  }

  function getAudioDuration(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = url;
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(audio.duration || 0);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
    });
  }

  // --- Online Search & Download ---
  document.getElementById('search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();
    if (query) { searchInput.blur(); performSearch(query); }
  });

  searchInput.addEventListener('input', () => {
    searchVersion++;
    const val = searchInput.value.trim();
    searchClearBtn.classList.toggle('visible', val.length > 0);

    clearTimeout(searchTimeout);
    if (!val) {
      searchResultsList.innerHTML = '';
      searchSummary.hidden = true;
      searchPlaceholder.style.display = 'block';
      searchLoading.style.display = 'none';
      return;
    }

    searchTimeout = setTimeout(() => {
      performSearch(val);
    }, 450);
  });

  searchClearBtn.addEventListener('click', () => {
    clearTimeout(searchTimeout);
    searchVersion++;
    searchSummary.hidden = true;
    searchOfflineNotice.style.display = 'none';
    searchInput.focus();
    searchInput.value = '';
    searchClearBtn.classList.remove('visible');
    searchResultsList.innerHTML = '';
    searchPlaceholder.style.display = 'block';
    searchLoading.style.display = 'none';
  });

  // --- YouTube Search Engine (Độc Lập Không Cần Máy Chủ PC) ---
  // Chiến lược 1: InnerTube API (YouTube internal API - ổn định nhất)
  // Chiến lược 2: Cào HTML với bracket-depth parser (thay regex lỗi)
  // Chiến lược 3: CORS proxy fallback
  function _extractYtInitialData(html) {
    const marker = 'ytInitialData';
    const idx = html.indexOf(marker);
    if (idx === -1) return null;
    const start = html.indexOf('{', idx);
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch (e) { return null; }
      }
    }
    return null;
  }

  function _parseYtResults(data) {
    const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    const results = [];
    for (const sec of sections) {
      for (const item of (sec?.itemSectionRenderer?.contents || [])) {
        const v = item.videoRenderer;
        if (!v || !v.videoId) continue;
        const title = v.title?.runs?.[0]?.text || v.title?.simpleText || 'Không rõ tiêu đề';
        const artist = v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || 'YouTube';
        const duration = v.lengthText?.simpleText || '0:00';
        const thumbs = v.thumbnail?.thumbnails || [];
        const thumbnail = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
        const parts = duration.split(':').map(Number);
        const seconds = parts.length === 3 ? parts[0]*3600+parts[1]*60+parts[2] : (parts[0]||0)*60+(parts[1]||0);
        results.push({ id: v.videoId, title, artist, duration, seconds, views: v.viewCountText?.simpleText || '', thumbnail });
      }
    }
    return results;
  }

  async function searchYouTubeDirect(query) {
    const enc = encodeURIComponent(query);

    // Chiến lược 1: InnerTube API (POST JSON, không cần parse HTML)
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          context: {
            client: { clientName: 'WEB', clientVersion: '2.20231201.00.00', hl: 'vi', gl: 'VN' }
          }
        }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        const results = _parseYtResults(data);
        if (results.length > 0) return results;
      }
    } catch (e) { console.warn('[YT-InnerTube]', e.message); }

    // Chiến lược 2: Cào HTML trực tiếp (hoạt động tốt trong Android WebView)
    const htmlUrls = [
      `https://www.youtube.com/results?search_query=${enc}&hl=vi`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent('https://www.youtube.com/results?search_query=' + enc + '&hl=vi')}`
    ];
    for (const url of htmlUrls) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(tid);
        if (!res.ok) continue;
        const html = await res.text();
        const data = _extractYtInitialData(html);
        if (!data) continue;
        const results = _parseYtResults(data);
        if (results.length > 0) return results;
      } catch (e) { console.warn('[YT-HTML]', url, e.message); }
    }

    throw new Error('Tất cả chiến lược tìm kiếm đều thất bại');
  }

  async function performSearch(query) {
    clearTimeout(searchTimeout);
    const version = ++searchVersion;
    searchSummary.hidden = true;
    if (!navigator.onLine) {
      searchOfflineNotice.style.display = 'block';
      searchPlaceholder.style.display = 'none';
      searchResultsList.innerHTML = '';
      return;
    }

    searchOfflineNotice.style.display = 'none';
    searchPlaceholder.style.display = 'none';
    searchLoading.style.display = 'block';
    searchResultsList.innerHTML = '';

    let results = null;

    // 1. Thử gọi máy chủ PC trước với timeout 2.5 giây
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${getApiBase()}/api/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        results = await res.json();
      }
    } catch (localErr) {
      console.log('Máy chủ PC không phản hồi, tự động chuyển sang tìm kiếm trực tiếp YouTube...');
    }

    if (version !== searchVersion) return;

    // 2. Nếu máy chủ PC đang tắt, tự động tìm kiếm trực tiếp từ YouTube trên điện thoại!
    if (!results || results.length === 0) {
      try {
        results = await searchYouTubeDirect(query);
      } catch (directErr) {
        console.warn('Direct YouTube search error:', directErr);
      }
    }

    if (version !== searchVersion) return;
    searchLoading.style.display = 'none';

    if (!results || results.length === 0) {
      searchResultsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🤷</div>
          <div class="empty-title">Không tìm thấy bài hát</div>
          <div class="empty-desc">Thử tìm kiếm với từ khóa khác xem sao.</div>
        </div>
      `;
      return;
    }

    renderSearchResults(results);
  }

  // --- REAL-TIME AUDIO DOWNLOAD WITH PROGRESS TRACKER ---
  const downloadDock = document.getElementById('download-progress-dock');
  const dlDockTitle = document.getElementById('dl-dock-title');
  const dlDockPercent = document.getElementById('dl-dock-percent');
  const dlDockFill = document.getElementById('dl-dock-fill');
  const dlDockSize = document.getElementById('dl-dock-size');
  const dlDockStatus = document.getElementById('dl-dock-status');
  let dockHideTimeout = null;
  const activeDownloads = new Set();

  async function downloadSongWithProgress(item, cardEl, dlBtnEl) {
    const cleanYtId = String(item.id).replace(/^yt_/, '').trim();
    const downloadId = `yt_${cleanYtId}`;
    if (downloadedIds.has(downloadId) || activeDownloads.has(downloadId)) return;
    activeDownloads.add(downloadId);
    if (dlBtnEl) {
      dlBtnEl.classList.add('downloading');
      dlBtnEl.innerHTML = '<span class="retro-spinner" style="width:12px;height:12px;border-width:2px;"></span> 0%';
    }

    // Card in-place progress bar
    const cardProgressWrap = cardEl ? cardEl.querySelector('.card-dl-progress-wrap') : null;
    const cardProgressFill = cardEl ? cardEl.querySelector('.card-dl-fill') : null;
    const cardProgressText = cardEl ? cardEl.querySelector('.card-dl-text') : null;

    if (cardProgressWrap) cardProgressWrap.classList.remove('hidden');

    // Show floating download dock
    if (downloadDock) {
      if (dockHideTimeout) clearTimeout(dockHideTimeout);
      downloadDock.classList.remove('hidden');
      if (dlDockTitle) dlDockTitle.textContent = `Đang tải: ${item.title}`;
      if (dlDockPercent) dlDockPercent.textContent = '0%';
      if (dlDockFill) {
        dlDockFill.classList.remove('success');
        dlDockFill.style.width = '2%';
      }
      if (dlDockSize) dlDockSize.textContent = '0.0 MB / ...';
      if (dlDockStatus) dlDockStatus.textContent = 'Đang kết nối luồng âm thanh...';
    }

    try {
      const savedSong = await window.MusicDownload.save({
        item,
        apiBase: getApiBase(),
        db: window.musicDB,
        onProgress: ({ receivedBytes, totalBytes, done }) => {
          const estimated = totalBytes || (item.seconds > 0 ? Math.round(item.seconds * 16384) : 0);
          const totalText = estimated ? `${totalBytes ? '' : '~'}${(estimated / 1048576).toFixed(1)} MB` : '…';
          const currentMB = (receivedBytes / 1048576).toFixed(1);
          const percent = estimated ? Math.min(99, Math.round(receivedBytes / estimated * 100)) : 2;
          if (cardProgressFill) cardProgressFill.style.width = `${percent}%`;
          if (cardProgressText) cardProgressText.textContent = `${percent}% · ${currentMB} / ${totalText}`;
          if (dlBtnEl) dlBtnEl.textContent = `${percent}%`;
          if (dlDockPercent) dlDockPercent.textContent = `${percent}%`;
          if (dlDockFill) dlDockFill.style.width = `${percent}%`;
          if (dlDockSize) dlDockSize.textContent = `${currentMB} MB / ${totalText}`;
          if (dlDockStatus) dlDockStatus.textContent = done ? 'Đang lưu vào Thư viện…' : 'Đang tải âm thanh…';
        },
        onThumbnail: (song) => {
          const cached = librarySongs.find((entry) => entry.id === song.id);
          if (cached) {
            cached.thumbnailBlob = song.thumbnailBlob;
            if (libraryView.classList.contains('active')) renderLibraryList();
          }
          const current = window.musicPlayer.getCurrentSong();
          if (window.Discovery.isSameTrack(current, song)) current.thumbnailBlob = song.thumbnailBlob;
          if (playlistView.classList.contains('active')) loadPlaylists();
        }
      });
      const audioBlob = savedSong.audioBlob;
      downloadedIds.add(savedSong.id);

      // Play success chime
      play8BitChime('dive');

      // Update card UI
      if (cardProgressFill) cardProgressFill.style.width = '100%';
      if (cardProgressText) cardProgressText.textContent = `✓ Đã lưu xong (100%) • ${(audioBlob.size / 1024 / 1024).toFixed(1)} MB`;
      if (dlBtnEl) {
        dlBtnEl.classList.remove('downloading');
        dlBtnEl.classList.add('downloaded');
        dlBtnEl.innerHTML = '✓ ĐÃ LƯU';
        dlBtnEl.title = 'Đã lưu về máy';
      }

      // Update floating dock to success state
      if (dlDockPercent) dlDockPercent.textContent = '100%';
      if (dlDockFill) {
        dlDockFill.classList.add('success');
        dlDockFill.style.width = '100%';
      }
      if (dlDockStatus) dlDockStatus.textContent = '✓ Đã lưu thành công vào Hộp Nhạc!';
      if (dlDockSize) dlDockSize.textContent = `${(audioBlob.size / (1024 * 1024)).toFixed(1)} MB • Sẵn sàng nghe offline`;

      showToast(`✅ Đã tải & lưu vào Thư viện thành công: ${item.title}`);
      await loadLibrary(savedSong);
      const current = window.musicPlayer.getCurrentSong();
      if (window.Discovery.isSameTrack(current, savedSong)) {
        Object.assign(current, savedSong, { isPreview: false });
      }
      if (current) syncPlayerLibraryActions(current);
      syncDiscoveryPlayback();
      searchResultsList.querySelectorAll('.discovery-card').forEach((card) => {
        if (card.dataset.songId === savedSong.id) {
          const button = card.querySelector('.download-btn');
          button.classList.remove('downloading');
          button.classList.add('downloaded');
          button.innerHTML = `${uiIcon('check')} Đã lưu`;
          button.setAttribute('aria-label', `Đã lưu ${savedSong.title}`);
          button.title = 'Đã lưu về máy';
        }
      });

      // Auto-hide floating dock after 2.8s
      dockHideTimeout = setTimeout(() => {
        if (downloadDock) downloadDock.classList.add('hidden');
        if (cardProgressWrap) cardProgressWrap.classList.add('hidden');
      }, 2800);

    } catch (err) {
      console.error('Download error:', err);
      if (dlBtnEl) {
        dlBtnEl.classList.remove('downloading');
        dlBtnEl.innerHTML = '✕ THỬ LẠI';
      }
      if (dlDockStatus) dlDockStatus.textContent = `✕ ${err.message}`;
      if (cardProgressText) cardProgressText.textContent = '✕ Tải chưa hoàn tất';

      if (navigator.onLine) {
        showToast(`Không thể lưu bài hát: ${err.message}`);
      } else {
        showToast('⚠️ Thiết bị không có kết nối mạng internet!');
      }

      dockHideTimeout = setTimeout(() => {
        if (downloadDock) downloadDock.classList.add('hidden');
        if (cardProgressWrap) cardProgressWrap.classList.add('hidden');
      }, 3500);
    } finally {
      activeDownloads.delete(downloadId);
      const current = window.musicPlayer.getCurrentSong();
      if (dlBtnEl === btnSavePreview && current && !window.Discovery.isSameTrack(current, { id: downloadId })) syncPlayerLibraryActions(current);
    }
  }

  function syncDiscoveryPlayback(isPlaying = window.musicPlayer.isPlaying) {
    const current = window.musicPlayer.getCurrentSong();
    searchResultsList.querySelectorAll('.discovery-card').forEach((card) => {
      const active = window.Discovery.isSameTrack({ id: card.dataset.songId }, current);
      card.classList.toggle('is-current', active);
      const button = card.querySelector('.preview-btn');
      button.setAttribute('aria-pressed', String(active && isPlaying));
      const label = active ? (isPlaying ? 'Tạm dừng' : 'Nghe tiếp') : 'Nghe thử';
      button.setAttribute('aria-label', `${label} ${card.querySelector('.song-title').textContent}`);
      button.querySelector('.preview-icon').innerHTML = uiIcon(active && isPlaying ? 'pause' : 'play');
      button.querySelector('.preview-label').textContent = label;
    });
  }

  function syncPlayerLibraryActions(track) {
    const saved = !!track.audioBlob || downloadedIds.has(track.id);
    playerBtnFav.disabled = !saved;
    playerBtnFav.title = saved ? 'Yêu thích' : 'Tải về để thêm vào Yêu thích';
    playerBtnFav.classList.toggle('active', !!track.favorite);
    document.getElementById('btn-player-add-playlist').disabled = !saved;
    btnSavePreview.hidden = saved;
    btnSavePreview.classList.remove('downloading', 'downloaded');
    btnSavePreview.innerHTML = `${uiIcon('download')} Tải về`;
    if (!saved && activeDownloads.has(track.id)) {
      btnSavePreview.classList.add('downloading');
      btnSavePreview.textContent = 'Đang tải…';
    }
    document.getElementById('player-source-badge').textContent = saved ? 'YOUR PERSONAL COLLECTION' : 'ONLINE / NGHE THỬ';
    document.getElementById('player-source-note').textContent = saved
      ? 'Đã lưu trong thư viện · Sẵn sàng nghe offline.' : 'Nghe trước, tải về khi bạn thích.';
  }

  btnSavePreview.addEventListener('click', () => {
    const track = window.musicPlayer.getCurrentSong();
    if (track && !track.audioBlob) downloadSongWithProgress(track, null, btnSavePreview);
  });

  function renderSearchResults(results) {
    searchResultsList.replaceChildren();
    searchSummary.hidden = false;
    document.getElementById('search-result-count').textContent = `${results.length} bài hát`;
    results.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'song-card discovery-card';
      card.dataset.songId = `yt_${String(item.id).replace(/^yt_/, '')}`;
      const isDownloaded = downloadedIds.has(card.dataset.songId);
      card.innerHTML = `
        <button class="discovery-track" type="button" aria-label="Nghe thử ${escapeHtml(item.title)}">
          <img class="song-thumb" alt="" loading="lazy">
          <span class="song-info"><span class="song-title">${escapeHtml(item.title)}</span>
            <span class="song-meta"><span>${escapeHtml(item.artist || 'Không rõ nghệ sĩ')}</span><span>·</span><span class="song-duration">${escapeHtml(item.duration || '--:--')}</span></span>
          </span>
        </button>
        <div class="card-dl-progress-wrap hidden"><div class="card-dl-track"><div class="card-dl-fill"></div></div><div class="card-dl-text">0% · 0 MB</div></div>
        <div class="discovery-actions"><span class="discovery-hint">LISTEN FIRST</span>
          <button class="preview-btn" type="button" aria-pressed="false"><span class="preview-icon">${uiIcon('play')}</span><span class="preview-label">Nghe thử</span></button>
          <button class="download-btn ${isDownloaded ? 'downloaded' : ''}" type="button" aria-label="${isDownloaded ? 'Đã lưu' : 'Tải về'} ${escapeHtml(item.title)}" title="${isDownloaded ? 'Đã lưu về máy' : 'Tải về để nghe offline'}">${uiIcon(isDownloaded ? 'check' : 'download')} ${isDownloaded ? 'Đã lưu' : 'Tải về'}</button>
        </div>`;
      const img = card.querySelector('img');
      img.src = item.thumbnail || 'icons/icon.svg';
      img.addEventListener('error', () => { img.src = 'icons/icon.svg'; }, { once: true });
      const preview = () => window.Discovery.preview(item, librarySongs, window.musicPlayer, getApiBase());
      card.querySelector('.discovery-track').addEventListener('click', preview);
      card.querySelector('.preview-btn').addEventListener('click', preview);
      const download = card.querySelector('.download-btn');
      download.addEventListener('click', () => {
        if (downloadedIds.has(card.dataset.songId)) { showToast('Bài hát đã có trong thư viện offline.'); return; }
        downloadSongWithProgress(item, card, download);
      });
      searchResultsList.appendChild(card);
    });
    syncDiscoveryPlayback();
  }

  // --- Player Event Listeners ---
  const dynamicIsland = document.getElementById('dynamic-island');
  const islandCapsule = document.getElementById('island-capsule');
  const islandThumb = document.getElementById('island-thumb');
  const islandTitle = document.getElementById('island-title');
  const islandEq = document.getElementById('island-eq');
  const islandTime = document.getElementById('island-time');
  const islandExpThumb = document.getElementById('island-exp-thumb');
  const islandExpTitle = document.getElementById('island-exp-title');
  const islandExpArtist = document.getElementById('island-exp-artist');
  const islandExpProgressBar = document.getElementById('island-exp-progress-bar');
  const islandBtnCloseExp = document.getElementById('island-btn-close-exp');
  const islandBtnPlay = document.getElementById('island-btn-play');
  const islandBtnPrev = document.getElementById('island-btn-prev');
  const islandBtnNext = document.getElementById('island-btn-next');
  const islandBtnFull = document.getElementById('island-btn-full');
  const toneArm = document.getElementById('tone-arm');
  const btnMinimizePlayer = document.getElementById('btn-minimize-player');

  window.musicPlayer.on('track', (track) => {
    document.body.classList.add('has-mini-player');
    miniPlayer.classList.remove('hidden');
    miniTitle.textContent = track.title || 'Bài hát không tên';
    miniArtist.textContent = track.artist || 'Không rõ nghệ sĩ';
    miniThumb.src = track.coverUrl || 'icons/icon.svg';

    playerTitle.textContent = track.title || 'Bài hát không tên';
    playerTitle.title = track.title || '';
    syncPlayerLibraryActions(track);
    syncDiscoveryPlayback(false);
    playerSlider.value = 0;
    playerSlider.style.setProperty('--seek', '0%');
    playerTimeCurrent.textContent = '0:00';
    playerTimeTotal.textContent = track.duration || '0:00';
    document.getElementById('player-playback-status').textContent = 'Đang mở bài hát…';
    playerArtist.textContent = track.artist || 'Không rõ nghệ sĩ';

    let trackArt = track.coverUrl;
    if (!trackArt || trackArt.includes('icon.svg') || trackArt.includes('icon-192.png')) {
      const cleanId = String(track.id || '').replace(/^yt_/, '').trim();
      if (cleanId && cleanId.length === 11) {
        trackArt = `https://i.ytimg.com/vi/${cleanId}/hqdefault.jpg`;
      }
    }
    const finalCover = trackArt || 'icons/icon-192.png';

    const setSafeArt = (imgEl) => {
      if (!imgEl) return;
      imgEl.src = finalCover;
      imgEl.onerror = () => {
        const cleanId = String(track.id || '').replace(/^yt_/, '').trim();
        if (cleanId && cleanId.length === 11 && !imgEl.src.includes('mqdefault')) {
          imgEl.src = `https://i.ytimg.com/vi/${cleanId}/mqdefault.jpg`;
        } else {
          imgEl.src = 'icons/icon-192.png';
        }
      };
    };

    setSafeArt(playerArt);
    if (playerArtVinyl && playerArtVinyl !== playerArt) {
      setSafeArt(playerArtVinyl);
    }
    setSafeArt(miniThumb);

    // Send high-res track artwork to native Android Dynamic Island / MediaSession
    const syncNativeIslandArt = () => {
      if (!window.AndroidBridge || typeof window.AndroidBridge.updateMedia !== 'function') return;
      const isPlaying = window.musicPlayer ? window.musicPlayer.isPlaying : true;
      try {
        if (playerArtVinyl && playerArtVinyl.complete && playerArtVinyl.naturalWidth > 0) {
          const cvs = document.createElement('canvas');
          cvs.width = 160;
          cvs.height = 160;
          const cctx = cvs.getContext('2d');
          cctx.drawImage(playerArtVinyl, 0, 0, 160, 160);
          const b64 = cvs.toDataURL('image/jpeg', 0.85);
          window.AndroidBridge.updateMedia(
            track.title || 'Boxmusic',
            track.artist || 'Không rõ nghệ sĩ',
            b64,
            isPlaying
          );
          return;
        }
      } catch (e) {
        // Fallback to URL if canvas tainted
      }
      window.AndroidBridge.updateMedia(
        track.title || 'Boxmusic',
        track.artist || 'Không rõ nghệ sĩ',
        finalCover,
        isPlaying
      );
    };

    if (playerArtVinyl) {
      if (playerArtVinyl.complete && playerArtVinyl.naturalWidth > 0) {
        syncNativeIslandArt();
      } else {
        playerArtVinyl.onload = syncNativeIslandArt;
      }
    } else {
      syncNativeIslandArt();
    }

    playerBtnFav.classList.toggle('active', !!track.favorite);

    highlightNowPlayingCard(track.id);
  });

  // Attach Audio Visualizer Canvas
  if (playerVisualizer) {
    window.musicPlayer.attachVisualizer(playerVisualizer);
    window.musicPlayer.visualizer.onFrame = () => {
      const player = window.musicPlayer;
      if (isDraggingSlider || player.isYtPlaying || !player.audio.duration) return;
      const percent = Math.min(100, player.audio.currentTime / player.audio.duration * 100);
      playerSlider.value = percent;
      playerSlider.style.setProperty('--seek', `${percent}%`);
    };
  }

  window.musicPlayer.on('state', ({ isPlaying, error }) => {
    const icon = uiIcon(isPlaying ? 'pause' : 'play');
    if (miniPlayIcon) miniPlayIcon.innerHTML = icon;
    if (playerPlayIcon) playerPlayIcon.innerHTML = icon;
    miniBtnPlay.setAttribute('aria-label', isPlaying ? 'Tạm dừng' : 'Phát nhạc');
    playerBtnPlay.setAttribute('aria-label', isPlaying ? 'Tạm dừng' : 'Phát nhạc');
    fullPlayer.classList.toggle('is-playing', isPlaying);
    syncDiscoveryPlayback(isPlaying);
    document.getElementById('player-playback-status').textContent = error ? 'Chưa thể phát' : isPlaying ? 'Đang phát' : 'Đã tạm dừng';
    if (error) showToast('Chưa phát được bài hát. Kiểm tra kết nối và thử lại.');
    if (islandBtnPlay) islandBtnPlay.textContent = isPlaying ? '⏸' : '▶';

    if (isPlaying) {
      if (vinylDisc) vinylDisc.classList.add('playing');
      if (toneArm) toneArm.classList.add('playing');
      if (playerArt) playerArt.classList.add('playing');
      if (playerGlow) playerGlow.classList.add('active');
      if (miniPlayer) miniPlayer.classList.add('playing');
      if (dynamicIsland) dynamicIsland.classList.add('is-playing');
      if (islandEq) islandEq.classList.add('playing');
    } else {
      if (vinylDisc) vinylDisc.classList.remove('playing');
      if (toneArm) toneArm.classList.remove('playing');
      if (playerArt) playerArt.classList.remove('playing');
      if (playerGlow) playerGlow.classList.remove('active');
      if (miniPlayer) miniPlayer.classList.remove('playing');
      if (dynamicIsland) dynamicIsland.classList.remove('is-playing');
      if (islandEq) islandEq.classList.remove('playing');
    }
  });

  // FX Buttons: Visual Mode & Bass Boost
  if (btnVisualMode) {
    btnVisualMode.addEventListener('click', () => {
      const mode = window.musicPlayer.toggleVisualMode();
      const isNeon = mode === 1;
      if (visualModeText) visualModeText.textContent = isNeon ? 'LED' : 'CYBER';
      btnVisualMode.classList.toggle('active', isNeon);
      btnVisualMode.setAttribute('aria-pressed', String(isNeon));
      showToast(isNeon ? 'LED · Ánh ngọc và hổ phách' : 'CYBER · Xanh lam và tím');
    });
  }

  if (btnFxBass) {
    btnFxBass.addEventListener('click', () => {
      const isBoosted = window.musicPlayer.toggleBassBoost();
      btnFxBass.classList.toggle('active', isBoosted);
      if (bassModeText) bassModeText.textContent = 'BASS';
      btnFxBass.setAttribute('aria-pressed', String(isBoosted));
      showToast(isBoosted ? '🔥 Đã kích hoạt Siêu Âm Trầm (Bass Boost)' : 'Bass Boost: Đã tắt');
    });
  }

  let isDraggingSlider = false;
  window.musicPlayer.on('time', ({ currentTime, duration, percent }) => {
    if (!isDraggingSlider) {
      playerSlider.value = percent;
      playerSlider.style.setProperty('--seek', `${percent}%`);
      playerTimeCurrent.textContent = formatTime(currentTime);
      playerTimeTotal.textContent = formatTime(duration);
      miniProgressFill.style.width = `${percent}%`;
    }
    // Dynamic Island time & progress bar sync
    if (islandTime) islandTime.textContent = formatTime(currentTime);
    if (islandExpProgressBar) islandExpProgressBar.style.width = `${percent}%`;
  });

  window.musicPlayer.on('mode', ({ isShuffle, repeatMode }) => {
    playerBtnShuffle.classList.toggle('active', isShuffle);
    playerBtnShuffle.setAttribute('aria-pressed', String(isShuffle));
    playerBtnRepeat.classList.toggle('active', repeatMode !== 'none');
    playerBtnRepeat.setAttribute('aria-pressed', String(repeatMode !== 'none'));
    playerBtnRepeat.dataset.repeat = repeatMode;
    playerBtnRepeat.title = repeatMode === 'one' ? 'Lặp lại một bài' : repeatMode === 'all' ? 'Lặp lại danh sách' : 'Tắt lặp lại';
  });

  // Slider events
  playerSlider.addEventListener('input', () => {
    isDraggingSlider = true;
    const pct = parseFloat(playerSlider.value);
    playerSlider.style.setProperty('--seek', `${pct}%`);
    miniProgressFill.style.width = `${pct}%`;
  });

  playerSlider.addEventListener('change', () => {
    const pct = parseFloat(playerSlider.value);
    window.musicPlayer.seekPercent(pct);
    isDraggingSlider = false;
  });

  // Player controls
  miniBtnPlay.addEventListener('click', (e) => {
    e.stopPropagation();
    window.musicPlayer.togglePlay();
  });

  miniBtnNext.addEventListener('click', (e) => {
    e.stopPropagation();
    window.musicPlayer.next();
  });

  miniInfoClick.addEventListener('click', () => {
    setFullPlayerOpen(true);
  });

  btnClosePlayer.addEventListener('click', () => {
    setFullPlayerOpen(false);
  });

  if (btnMinimizePlayer) {
    btnMinimizePlayer.addEventListener('click', () => {
      setFullPlayerOpen(false);
    });
  }

  // Dynamic Island interactive gestures & controls
  if (islandCapsule && dynamicIsland) {
    islandCapsule.addEventListener('click', () => {
      dynamicIsland.classList.add('expanded');
    });
  }

  if (islandBtnCloseExp && dynamicIsland) {
    islandBtnCloseExp.addEventListener('click', (e) => {
      e.stopPropagation();
      dynamicIsland.classList.remove('expanded');
    });
  }

  if (islandBtnPlay) {
    islandBtnPlay.addEventListener('click', (e) => {
      e.stopPropagation();
      window.musicPlayer.togglePlay();
    });
  }

  if (islandBtnPrev) {
    islandBtnPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      window.musicPlayer.prev();
    });
  }

  if (islandBtnNext) {
    islandBtnNext.addEventListener('click', (e) => {
      e.stopPropagation();
      window.musicPlayer.next();
    });
  }

  if (islandBtnFull && fullPlayer) {
    islandBtnFull.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dynamicIsland) dynamicIsland.classList.remove('expanded');
      setFullPlayerOpen(true);
    });
  }

  playerBtnPlay.addEventListener('click', () => {
    window.musicPlayer.togglePlay();
  });

  playerBtnNext.addEventListener('click', () => {
    window.musicPlayer.next();
  });

  playerBtnPrev.addEventListener('click', () => {
    window.musicPlayer.prev();
  });

  playerBtnShuffle.addEventListener('click', () => {
    const active = window.musicPlayer.toggleShuffle();
    showToast(active ? 'Trộn bài: BẬT' : 'Trộn bài: TẮT');
  });

  playerBtnRepeat.addEventListener('click', () => {
    const mode = window.musicPlayer.toggleRepeat();
    const modeNames = { all: 'Lặp lại danh sách', one: 'Lặp lại 1 bài', none: 'Tắt lặp lại' };
    showToast(modeNames[mode] || 'Lặp lại');
  });

  playerBtnFav.addEventListener('click', async () => {
    const cur = window.musicPlayer.getCurrentSong();
    if (!cur) return;
    const isFav = await window.musicDB.toggleFavorite(cur.id);
    cur.favorite = isFav;
    playerBtnFav.classList.toggle('active', isFav);
    showToast(isFav ? 'Đã thêm vào Yêu thích ❤️' : 'Đã bỏ Yêu thích');
    loadLibrary();
  });

  // Smart Player More Menu Popover
  const btnPlayerMore = document.getElementById('btn-player-more');
  const playerMoreMenu = document.getElementById('player-more-menu');
  if (btnPlayerMore && playerMoreMenu) {
    btnPlayerMore.addEventListener('click', (e) => {
      e.stopPropagation();
      playerMoreMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!playerMoreMenu.contains(e.target) && e.target !== btnPlayerMore) {
        playerMoreMenu.classList.add('hidden');
      }
    });
  }

  // Export audio file
  if (btnExportAudio) {
    btnExportAudio.addEventListener('click', () => {
      if (playerMoreMenu) playerMoreMenu.classList.add('hidden');
      const cur = window.musicPlayer.getCurrentSong();
      if (!cur || !cur.audioBlob) {
        showToast('Bài này đang phát từ luồng trực tuyến, hãy tải về trước.');
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(cur.audioBlob);
      a.download = `${cur.title || 'song'}.m4a`;
      a.click();
      showToast('Đang xuất tệp âm thanh về máy...');
    });
  }

  // Delete current playing song
  if (btnDeleteCurrent) {
    btnDeleteCurrent.addEventListener('click', async () => {
      if (playerMoreMenu) playerMoreMenu.classList.add('hidden');
      const cur = window.musicPlayer.getCurrentSong();
      if (!cur) return;
      if (confirm(`Bạn muốn xóa bài "${cur.title}" khỏi máy?`)) {
        await window.musicDB.deleteSong(cur.id);
        showToast(`Đã xóa "${cur.title}"`);
        window.musicPlayer.next();
        loadLibrary();
      }
    });
  }

  // Helpers
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Button go to library from offline notice
  const btnGotoLibrary = document.getElementById('btn-goto-library');
  if (btnGotoLibrary) {
    btnGotoLibrary.addEventListener('click', () => {
      navItems.forEach((btn) => {
        if (btn.getAttribute('data-tab') === 'library-view') {
          btn.click();
        }
      });
    });
  }

  // Initial load
  updateNetworkStatus();

  // Initial load
  loadLibrary();
});
