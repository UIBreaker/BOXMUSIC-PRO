/* A single, visibility-aware animation loop. Geometry and gradients change only on resize. */
(function (root, factory) {
  const Spectrum = factory();
  if (typeof module === 'object' && module.exports) module.exports = Spectrum;
  else root.BoxmusicSpectrum = Spectrum;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  class Spectrum {
    constructor(canvas, player, env = window) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.player = player;
      this.env = env;
      this.visible = false;
      this.mode = 1;
      this.frame = null;
      this.lastTime = null;
      this.count = 36;
      this.heights = new Float32Array(this.count);
      this.peaks = new Float32Array(this.count);
      this.holds = new Float32Array(this.count);
      this.targets = new Float32Array(this.count);
      this.bassLevel = 0;
      this.bassAverage = 0;
      this.bassPulse = 0;
      this.bassGlow = 0;
      this.motion = env.matchMedia('(prefers-reduced-motion: reduce)');
      this.draw = this.draw.bind(this);
      this.resize = this.resize.bind(this);
      this.sync = this.sync.bind(this);
      this.motion.addEventListener('change', this.sync);
      env.document.addEventListener('visibilitychange', this.sync);
      if (env.ResizeObserver) {
        this.observer = new env.ResizeObserver(this.resize);
        this.observer.observe(canvas);
      } else env.addEventListener('resize', this.resize);
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (!this.ctx || !rect.width || !rect.height) return;
      this.width = rect.width;
      this.height = rect.height;
      const density = Math.min(this.env.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(rect.width * density);
      this.canvas.height = Math.round(rect.height * density);
      this.ctx.setTransform(density, 0, 0, density, 0, 0);
      this.gradients = [this.gradient(['#36c9bb', '#a4f3d0', '#ffd791', '#ff929c']), this.gradient(['#4778ef', '#59d8ec', '#b9a2ff', '#f4b8e8'])];
      this.sync();
    }

    gradient(colors) {
      const gradient = this.ctx.createLinearGradient(0, this.height, 0, 0);
      colors.forEach((color, i) => gradient.addColorStop(i / (colors.length - 1), color));
      return gradient;
    }

    setVisible(visible) {
      this.visible = visible;
      this.sync();
    }

    setMode(mode) {
      this.mode = mode;
      this.sync();
    }

    sync() {
      const active = this.visible && !this.env.document.hidden && this.ctx && this.width;
      const animate = active && this.player.isPlaying && !this.motion.matches;
      if (!animate && this.frame !== null) {
        this.env.cancelAnimationFrame(this.frame);
        this.frame = null;
      }
      if (!animate) this.lastTime = null;
      if (active && !animate) this.paint();
      if (animate && this.frame === null) this.frame = this.env.requestAnimationFrame(this.draw);
    }

    draw(time) {
      this.frame = null;
      if (!this.visible || this.env.document.hidden || !this.player.isPlaying || this.motion.matches) return;
      const seconds = this.lastTime === null ? 1 / 60 : Math.min(.05, Math.max(0, (time - this.lastTime) / 1000));
      this.lastTime = time;
      this.sample(time);
      this.advance(seconds);
      this.paint();
      if (this.onFrame) this.onFrame();
      this.frame = this.env.requestAnimationFrame(this.draw);
    }

    sample(time) {
      const analyser = this.player.analyser;
      if (analyser && this.player.audioCtx?.state === 'running') {
        if (this.frequencies?.length !== analyser.frequencyBinCount) {
          this.frequencies = new Uint8Array(analyser.frequencyBinCount);
          this.bins = new Uint16Array(this.count);
          this.bandEnds = new Uint16Array(this.count);
          const sampleRate = this.player.audioCtx.sampleRate || 48000;
          const ceiling = Math.min(16000, sampleRate / 2);
          const binHz = sampleRate / 2 / this.frequencies.length;
          this.bassStart = Math.max(1, Math.floor(35 / binHz));
          this.bassEnd = Math.min(this.frequencies.length, Math.ceil(180 / binHz));
          for (let i = 0; i < this.count; i++) {
            const frequency = 35 * Math.pow(ceiling / 35, i / (this.count - 1));
            const nextFrequency = 35 * Math.pow(ceiling / 35, (i + 1) / (this.count - 1));
            this.bins[i] = Math.min(this.frequencies.length - 1, Math.floor(frequency / binHz));
            this.bandEnds[i] = Math.min(this.frequencies.length, Math.max(this.bins[i] + 1, Math.ceil(nextFrequency / binHz)));
          }
        }
        analyser.getByteFrequencyData(this.frequencies);
        let bassPower = 0;
        for (let i = this.bassStart; i < this.bassEnd; i++) bassPower += (this.frequencies[i] / 255) ** 2;
        this.bassLevel = Math.sqrt(bassPower / Math.max(1, this.bassEnd - this.bassStart));
        for (let i = 0; i < this.count; i++) {
          let total = 0, peak = 0;
          for (let bin = this.bins[i]; bin < this.bandEnds[i]; bin++) {
            const value = this.frequencies[bin] / 255;
            total += value;
            peak = Math.max(peak, value);
          }
          const energy = .65 * peak + .35 * total / (this.bandEnds[i] - this.bins[i]);
          this.targets[i] = Math.min(1, Math.pow(Math.max(0, (energy - .035) / .965), .8));
        }
      } else {
        this.bassLevel = 0;
        // Gentle activity for sources that cannot expose their audio samples.
        for (let i = 0; i < this.count; i++) {
          this.targets[i] = .12 + .22 * (1 + Math.sin(time * .0024 + i * .42)) / 2;
        }
      }
    }

    advance(seconds) {
      // Time-based smoothing keeps the same motion at 60, 90 and 120 Hz.
      const onset = Math.max(0, this.bassLevel - this.bassAverage - .055);
      this.bassAverage += (this.bassLevel - this.bassAverage) * (1 - Math.exp(-3 * seconds));
      this.bassPulse = Math.max(Math.min(1, onset * 2.5), this.bassPulse * Math.exp(-11 * seconds));
      const glowTarget = Math.max(this.bassLevel * .35, this.bassPulse);
      this.bassGlow += (glowTarget - this.bassGlow) * (1 - Math.exp(-(glowTarget > this.bassGlow ? 35 : 10) * seconds));
      const attack = 1 - Math.exp(-42 * seconds), release = 1 - Math.exp(-6 * seconds);
      for (let i = 0; i < this.count; i++) {
        // Only the low-frequency columns get the transient lift; treble keeps its own signal.
        const bassWeight = Math.max(0, 1 - i / 12);
        const target = Math.min(1, this.targets[i] * (1 + bassWeight * .15) + this.bassPulse * bassWeight * .36);
        this.heights[i] += (target - this.heights[i]) * (target > this.heights[i] ? attack : release);
        if (this.heights[i] >= this.peaks[i]) {
          this.peaks[i] = this.heights[i];
          this.holds[i] = .12;
        } else {
          const fallTime = Math.max(0, seconds - this.holds[i]);
          this.holds[i] = Math.max(0, this.holds[i] - seconds);
          this.peaks[i] = Math.max(this.heights[i], this.peaks[i] - fallTime * .72);
        }
      }
    }

    paint() {
      if (!this.ctx || !this.width) return;
      const ctx = this.ctx, w = this.width, h = this.height;
      const floor = h * .84, top = 3, usable = floor - top;
      const step = w / this.count, bar = Math.max(1, step - 2);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = this.gradients[this.mode - 1];
      ctx.globalAlpha = .035 + this.bassGlow * .15;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff09';
      for (let row = 0; row < 4; row++) ctx.fillRect(0, top + usable * row / 4, w, .5);
      for (let i = 0; i < this.count; i++) {
        const x = i * step + 1;
        const level = this.heights[i] * usable;
        ctx.fillStyle = '#a9bad608';
        ctx.fillRect(x, top, bar, usable);
        ctx.fillStyle = this.gradients[this.mode - 1];
        ctx.globalAlpha = .11;
        if (level > .5) ctx.fillRect(x - 1, floor - level, bar + 2, level);
        ctx.globalAlpha = 1;
        if (level > .5) ctx.fillRect(x, floor - level, bar, level);
        ctx.globalAlpha = .22;
        ctx.fillRect(x, floor + 3, bar, Math.min(h - floor - 3, level * .18));
        ctx.globalAlpha = 1;
        if (this.peaks[i] > .02) {
          ctx.fillStyle = this.mode === 1 ? '#ffe9bd' : '#f2dbff';
          ctx.fillRect(x, floor - this.peaks[i] * usable, bar, 1.5);
        }
      }
      // Fine segment gaps preserve the character of an LED hi-fi display.
      if (this.mode === 1) {
        ctx.fillStyle = '#132033';
        const segments = Math.min(18, Math.max(4, Math.floor(usable / 4)));
        for (let row = 1; row < segments; row++) ctx.fillRect(0, floor - usable * row / segments, w, 1);
      }
      ctx.fillStyle = '#afc9e833';
      ctx.fillRect(0, floor + 1, w, .5);
    }
  }
  return Spectrum;
});
