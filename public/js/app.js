// Boxmusic Main Application Logic
document.addEventListener('DOMContentLoaded', () => {
  // Service Worker v4 Registration & Auto Update
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js?v=4.0').then((reg) => {
      reg.update();
    }).catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
  }

  // State & API base
  const API_BASE = (typeof window !== 'undefined' && window.location && (window.location.protocol === 'http:' || window.location.protocol === 'https:'))
    ? ''
    : 'http://192.168.1.15:3000';
  let currentFilter = 'all';
  let librarySongs = [];
  let downloadedIds = new Set();
  let searchTimeout = null;

  // DOM Elements
  const libraryView = document.getElementById('library-view');
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

  // Search Elements
  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const searchResultsList = document.getElementById('search-results-list');
  const searchLoading = document.getElementById('search-loading');
  const searchOfflineNotice = document.getElementById('search-offline-notice');
  const searchPlaceholder = document.getElementById('search-placeholder');

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
  const btnClosePlayer = document.getElementById('btn-close-player');
  const playerArt = document.getElementById('player-art');
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
    if (!diveCanvas) {
      if (onComplete) onComplete();
      return;
    }

    const ctx = diveCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
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
    const numStars = 100;
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

    function animate(time) {
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
        p.z -= zSpeed;
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
            p.rot += p.rotSpeed;
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
  function updateNetworkStatus() {
    const isOnline = navigator.onLine;
    if (isOnline) {
      networkBadge.className = 'network-badge online';
      networkStatusText.textContent = 'Trực tuyến';
      searchOfflineNotice.style.display = 'none';
    } else {
      networkBadge.className = 'network-badge offline';
      networkStatusText.textContent = 'Ngoại tuyến';
      if (searchResultsList.children.length === 0) {
        searchOfflineNotice.style.display = 'block';
        searchPlaceholder.style.display = 'none';
      }
    }
  }

  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
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
      b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
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
    }
  }

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
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
        fullPlayer.classList.remove('open');
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

    // 3. Gesture on Main Screens: Swipe Left / Right to switch between Library and Search
    if (isHorizontalSwipe) {
      const activeTabBtn = document.querySelector('.bottom-nav .nav-item.active');
      const activeTabId = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : 'library-view';

      if (diffX < 0 && activeTabId === 'library-view') {
        // Swipe Left: Library -> Search
        switchTab('search-view');
        showToast('🔍 LƯỚT SANG TÌM KIẾM');
      } else if (diffX > 0 && activeTabId === 'search-view') {
        // Swipe Right: Search -> Library
        switchTab('library-view');
        showToast('📁 LƯỚT SANG THƯ VIỆN');
      }
    }
  }, { passive: true });

  // --- Library Management ---
  async function loadLibrary() {
    try {
      librarySongs = await window.musicDB.getAllSongs();
      const stats = await window.musicDB.getStats();

      storageStats.textContent = `${stats.count} bài • ${stats.totalMB} MB`;
      await updateDeviceStorageInfo(stats.count, stats.totalBytes || 0);

      downloadedIds.clear();
      librarySongs.forEach((s) => downloadedIds.add(s.id));

      renderLibraryList();
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

  function renderLibraryList() {
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

      // Cover Art URL
      let thumbSrc = 'icons/icon.svg';
      if (song.thumbnailBlob) {
        thumbSrc = URL.createObjectURL(song.thumbnailBlob);
      }

      const sourceBadge = song.source === 'youtube' ? 'YouTube' : 'Từ máy';
      const sizeMB = (song.sizeBytes / (1024 * 1024)).toFixed(1);

      card.innerHTML = `
        <img class="song-thumb" src="${thumbSrc}" alt="thumb">
        <div class="song-info">
          <div class="song-title">${escapeHtml(song.title)}</div>
          <div class="song-meta">
            <span class="badge-tag">${sourceBadge}</span>
            <span>${song.artist || 'Không rõ nghệ sĩ'}</span>
            <span>•</span>
            <span>${song.duration || formatTime(song.seconds)}</span>
            <span>•</span>
            <span>${sizeMB} MB</span>
          </div>
        </div>
        <div class="song-actions">
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

    const cards = librarySongList.querySelectorAll('.song-card');
    librarySongs.forEach((song, i) => {
      if (song.id === id && cards[i]) {
        cards[i].classList.add('now-playing');
        const titleEl = cards[i].querySelector('.song-title');
        if (titleEl && !cards[i].querySelector('.card-eq-indicator')) {
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
  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    searchClearBtn.classList.toggle('visible', val.length > 0);

    clearTimeout(searchTimeout);
    if (!val) {
      searchResultsList.innerHTML = '';
      searchPlaceholder.style.display = 'block';
      searchLoading.style.display = 'none';
      return;
    }

    searchTimeout = setTimeout(() => {
      performSearch(val);
    }, 450);
  });

  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchClearBtn.classList.remove('visible');
    searchResultsList.innerHTML = '';
    searchPlaceholder.style.display = 'block';
    searchLoading.style.display = 'none';
  });

  async function performSearch(query) {
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

    try {
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
      const results = await res.json();

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
    } catch (err) {
      searchLoading.style.display = 'none';
      showToast('Lỗi khi tìm kiếm, vui lòng thử lại.');
      console.error('Search fetch error:', err);
    }
  }

  function renderSearchResults(results) {
    searchResultsList.innerHTML = '';

    results.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'song-card';

      const isDownloaded = downloadedIds.has(`yt_${item.id}`);

      card.innerHTML = `
        <img class="song-thumb" src="${item.thumbnail}" alt="thumb" loading="lazy">
        <div class="song-info">
          <div class="song-title">${escapeHtml(item.title)}</div>
          <div class="song-meta">
            <span>${escapeHtml(item.artist)}</span>
            <span>•</span>
            <span>${item.duration}</span>
            ${item.views ? `<span>•</span><span>${item.views} lượt xem</span>` : ''}
          </div>
        </div>
        <div class="song-actions">
          <button class="action-btn download-btn ${isDownloaded ? 'downloaded' : ''}" type="button" aria-label="Tải về">
            ${isDownloaded ? `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
              </svg>
            ` : `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
              </svg>
            `}
          </button>
        </div>
      `;

      // Click card to play (offline if already saved, or live stream)
      card.addEventListener('click', (e) => {
        if (e.target.closest('.song-actions')) return;
        
        const offlineSong = librarySongs.find((s) => s.id === `yt_${item.id}`);
        if (offlineSong) {
          if (window.musicPlayer) {
            window.musicPlayer.setQueue([offlineSong], 0, true);
          }
          showToast(`▶ Đang phát offline: ${item.title}`);
          return;
        }

        const onlineTrack = {
          id: item.id,
          title: item.title,
          artist: item.artist,
          duration: item.duration,
          seconds: item.seconds,
          thumbnail: item.thumbnail,
          streamUrl: `${API_BASE}/api/download?id=${item.id}`,
          source: 'youtube',
          favorite: false
        };
        if (window.musicPlayer) {
          window.musicPlayer.setQueue([onlineTrack], 0, true);
        }
        showToast(`▶ Đang phát trực tuyến: ${item.title}`);
      });

      // Download button
      const dlBtn = card.querySelector('.download-btn');
      dlBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (dlBtn.classList.contains('downloaded') || dlBtn.classList.contains('downloading')) {
          return;
        }

        dlBtn.classList.add('downloading');
        dlBtn.innerHTML = '<span class="retro-spinner" style="width:14px;height:14px;border-width:2px;"></span> ĐANG TẢI...';
        showToast(`Đang tải bài hát về máy... 📥`);

        try {
          // Download audio stream
          const audioRes = await fetch(`${API_BASE}/api/download?id=${item.id}`);
          if (!audioRes.ok) throw new Error('Không thể tải bài hát');
          const audioBlob = await audioRes.blob();

          // Fetch thumbnail for offline use
          let thumbBlob = null;
          try {
            const thumbRes = await fetch(`${API_BASE}/api/proxy-image?url=${encodeURIComponent(item.thumbnail)}`);
            if (thumbRes.ok) thumbBlob = await thumbRes.blob();
          } catch (e) {
            console.warn('Thumbnail proxy failed:', e);
          }

          // Save to IndexedDB
          const savedSong = {
            id: `yt_${item.id}`,
            title: item.title,
            artist: item.artist,
            duration: item.duration,
            seconds: item.seconds,
            audioBlob: audioBlob,
            thumbnailBlob: thumbBlob,
            audioMime: 'audio/mp4',
            sizeBytes: audioBlob.size,
            source: 'youtube',
            favorite: false,
            createdAt: Date.now()
          };

          await window.musicDB.saveSong(savedSong);
          downloadedIds.add(savedSong.id);

          // Save actual file directly into device Downloads folder
          try {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(audioBlob);
            const safeFileName = (item.title || 'song').replace(/[^\w\s\u00C0-\u1EF9]/gi, '').trim();
            a.download = `${safeFileName}.m4a`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
              URL.revokeObjectURL(a.href);
              a.remove();
            }, 1200);
          } catch (e) {
            console.warn('Device file save anchor failed:', e);
          }

          dlBtn.classList.remove('downloading');
          dlBtn.classList.add('downloaded');
          dlBtn.innerHTML = '✓ ĐÃ LƯU';

          showToast(`✅ Đã lưu vào Thư viện & Tải về máy thành công!`);
          await loadLibrary();
        } catch (err) {
          console.error('Download error:', err);
          dlBtn.classList.remove('downloading');
          dlBtn.innerHTML = '✕ THỬ LẠI';
          showToast(`Tải thất bại, vui lòng thử lại!`);
        }
      });

      searchResultsList.appendChild(card);
    });
  }

  // --- Player Event Listeners ---
  window.musicPlayer.on('track', (track) => {
    miniPlayer.classList.remove('hidden');
    miniTitle.textContent = track.title || 'Bài hát không tên';
    miniArtist.textContent = track.artist || 'Không rõ nghệ sĩ';
    miniThumb.src = track.coverUrl || 'icons/icon.svg';

    playerTitle.textContent = track.title || 'Bài hát không tên';
    playerArtist.textContent = track.artist || 'Không rõ nghệ sĩ';
    playerArt.src = track.coverUrl || 'icons/icon.svg';
    if (playerArtVinyl) playerArtVinyl.src = track.coverUrl || 'icons/icon.svg';

    playerBtnFav.classList.toggle('active', !!track.favorite);

    highlightNowPlayingCard(track.id);
  });

  // Attach Audio Visualizer Canvas
  if (playerVisualizer) {
    window.musicPlayer.attachVisualizer(playerVisualizer);
  }

  window.musicPlayer.on('state', ({ isPlaying }) => {
    if (miniPlayIcon) miniPlayIcon.textContent = isPlaying ? '⏸' : '▶';
    if (playerPlayIcon) playerPlayIcon.textContent = isPlaying ? '⏸' : '▶';

    if (isPlaying) {
      if (vinylDisc) vinylDisc.classList.add('playing');
      if (playerArt) playerArt.classList.add('playing');
      if (playerGlow) playerGlow.classList.add('active');
      if (miniPlayer) miniPlayer.classList.add('playing');
    } else {
      if (vinylDisc) vinylDisc.classList.remove('playing');
      if (playerArt) playerArt.classList.remove('playing');
      if (playerGlow) playerGlow.classList.remove('active');
      if (miniPlayer) miniPlayer.classList.remove('playing');
    }
  });

  // FX Buttons: Visual Mode & Bass Boost
  if (btnVisualMode) {
    btnVisualMode.addEventListener('click', () => {
      const mode = window.musicPlayer.toggleVisualMode();
      const isNeon = mode === 1;
      visualModeText.textContent = isNeon ? 'Hiệu ứng: Sóng Neon' : 'Hiệu ứng: Dải Cyber';
      showToast(isNeon ? '⚡ Đổi hiệu ứng: Sóng Âm Neon' : '⚡ Đổi hiệu ứng: Dải Phổ Cyber');
    });
  }

  if (btnFxBass) {
    btnFxBass.addEventListener('click', () => {
      const isBoosted = window.musicPlayer.toggleBassBoost();
      btnFxBass.classList.toggle('active', isBoosted);
      bassModeText.textContent = isBoosted ? 'Bass Boost: BẬT 🔥' : 'Bass Boost: Tắt';
      showToast(isBoosted ? '🔥 Đã kích hoạt Siêu Âm Trầm (Bass Boost)' : 'Bass Boost: Đã tắt');
    });
  }

  let isDraggingSlider = false;
  window.musicPlayer.on('time', ({ currentTime, duration, percent }) => {
    if (!isDraggingSlider) {
      playerSlider.value = percent;
      playerTimeCurrent.textContent = formatTime(currentTime);
      playerTimeTotal.textContent = formatTime(duration);
      miniProgressFill.style.width = `${percent}%`;
    }
  });

  window.musicPlayer.on('mode', ({ isShuffle, repeatMode }) => {
    playerBtnShuffle.classList.toggle('active', isShuffle);
    playerBtnRepeat.classList.toggle('active', repeatMode !== 'none');
  });

  // Slider events
  playerSlider.addEventListener('input', () => {
    isDraggingSlider = true;
    const pct = parseFloat(playerSlider.value);
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
    fullPlayer.classList.add('open');
  });

  btnClosePlayer.addEventListener('click', () => {
    fullPlayer.classList.remove('open');
  });

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

  // Export audio file
  btnExportAudio.addEventListener('click', () => {
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

  // Delete current playing song
  btnDeleteCurrent.addEventListener('click', async () => {
    const cur = window.musicPlayer.getCurrentSong();
    if (!cur) return;
    if (confirm(`Bạn muốn xóa bài "${cur.title}" khỏi máy?`)) {
      await window.musicDB.deleteSong(cur.id);
      showToast(`Đã xóa "${cur.title}"`);
      window.musicPlayer.next();
      loadLibrary();
    }
  });

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

  // Initial load
  loadLibrary();
});
