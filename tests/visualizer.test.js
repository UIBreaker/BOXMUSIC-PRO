const { test } = require('node:test');
const assert = require('node:assert/strict');
const Spectrum = require('../public/js/visualizer');

function fixture() {
  const frames = new Map();
  const events = {};
  let serial = 0, layouts = 0, gradients = 0;
  const ctx = {
    setTransform() {}, clearRect() {}, fillRect() {},
    createLinearGradient() { gradients++; return { addColorStop() {} }; }
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx,
    getBoundingClientRect() { layouts++; return { width: 320, height: 44 }; } };
  const motion = { matches: false, addEventListener: (name, cb) => { events.motion = cb; } };
  const env = {
    document: { hidden: false, addEventListener: (name, cb) => { events[name] = cb; } },
    devicePixelRatio: 4, matchMedia: () => motion, addEventListener() {},
    ResizeObserver: class { constructor(cb) { events.resize = cb; } observe() {} },
    requestAnimationFrame(cb) { frames.set(++serial, cb); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); }
  };
  const player = { isPlaying: true };
  const spectrum = new Spectrum(canvas, player, env);
  return { spectrum, canvas, player, motion, env, frames, events,
    counts: () => ({ layouts, gradients }),
    tick(time) { const [id, cb] = frames.entries().next().value; frames.delete(id); cb(time); }
  };
}

test('visualizer schedules only while open, playing, visible and motion is allowed', () => {
  const f = fixture();
  assert.equal(f.frames.size, 0);
  f.spectrum.setVisible(true);
  f.spectrum.sync();
  assert.equal(f.frames.size, 1, 'state updates must not duplicate loops');
  f.tick(100);
  assert.equal(f.frames.size, 1);
  f.spectrum.setVisible(false);
  assert.equal(f.frames.size, 0);
  f.spectrum.setVisible(true);
  f.env.document.hidden = true;
  f.events.visibilitychange();
  assert.equal(f.frames.size, 0);
  f.env.document.hidden = false;
  f.events.visibilitychange();
  assert.equal(f.frames.size, 1);
  f.player.isPlaying = false;
  f.spectrum.sync();
  assert.equal(f.frames.size, 0);
  f.player.isPlaying = true;
  f.motion.matches = true;
  f.events.motion();
  assert.equal(f.frames.size, 0);
  f.motion.matches = false;
  f.events.motion();
  assert.equal(f.frames.size, 1);
});

test('frames reuse audio buffers and gradients without reading layout; retina density is bounded', () => {
  const f = fixture();
  f.player.audioCtx = { state: 'running' };
  f.player.analyser = { frequencyBinCount: 128, getByteFrequencyData(data) { data.fill(128); } };
  f.spectrum.setVisible(true);
  f.tick(0);
  const frequencies = f.spectrum.frequencies;
  const targets = f.spectrum.targets;
  for (let i = 1; i <= 120; i++) f.tick(i * 1000 / 120);
  assert.equal(f.spectrum.frequencies, frequencies);
  assert.equal(f.spectrum.targets, targets);
  assert.deepEqual(f.counts(), { layouts: 1, gradients: 2 });
  assert.equal(f.canvas.width, 640);
  assert.equal(f.canvas.height, 88);
  f.spectrum.setMode(2);
  assert.equal(f.frames.size, 1);
});

test('smoothing takes the same time at 60 and 120 Hz and keeps silent samples silent', () => {
  const a = fixture().spectrum, b = fixture().spectrum;
  a.targets.fill(.8); b.targets.fill(.8);
  for (let i = 0; i < 30; i++) a.advance(1 / 60);
  for (let i = 0; i < 60; i++) b.advance(1 / 120);
  assert.ok(Math.abs(a.heights[0] - b.heights[0]) < .000001);
  a.player.audioCtx = { state: 'running' };
  a.player.analyser = { frequencyBinCount: 128, getByteFrequencyData: data => data.fill(0) };
  a.sample(100);
  assert.ok(a.targets.every(x => x === 0));
});

function audioFixture() {
  const f = fixture();
  const audio = new Uint8Array(1024);
  f.player.audioCtx = { state: 'running', sampleRate: 48000 };
  f.player.analyser = { frequencyBinCount: audio.length, getByteFrequencyData: data => data.set(audio) };
  return { ...f, audio, step(seconds = 1 / 60) { f.spectrum.sample(0); f.spectrum.advance(seconds); } };
}

test('a real bass transient lifts low columns and light, then releases between beats', () => {
  const f = audioFixture();
  for (let i = 2; i <= 6; i++) f.audio[i] = 210; // 47–141 Hz kick
  for (let i = 0; i < 4; i++) f.step();
  assert.ok(f.spectrum.bassPulse > .8);
  assert.ok(Math.max(...f.spectrum.heights.slice(0, 12)) > .85);
  assert.ok(f.spectrum.bassGlow > .65);
  assert.ok(f.spectrum.heights.slice(12).every(x => x === 0), 'bass must not invent treble');
  f.audio.fill(0);
  for (let i = 0; i < 30; i++) f.step();
  assert.ok(f.spectrum.bassPulse < .01);
  assert.ok(f.spectrum.bassGlow < .05);
  assert.ok(Math.max(...f.spectrum.heights) < .1);
});

test('treble and silent audio do not trigger a bass pulse, and bands include energy between centers', () => {
  const f = audioFixture();
  f.audio[270] = 230; // ~6.3 kHz, between sparse logarithmic centers
  for (let i = 0; i < 5; i++) f.step();
  assert.equal(f.spectrum.bassPulse, 0);
  assert.equal(f.spectrum.bassGlow, 0);
  assert.ok(Math.max(...f.spectrum.heights.slice(12)) > .4);
  assert.ok(f.spectrum.heights.slice(0, 12).every(x => x === 0));
  f.audio.fill(0);
  f.spectrum.sample(1000);
  assert.ok(f.spectrum.targets.every(x => x === 0));
});

test('bass pulse and release envelopes remain consistent across phone refresh rates', () => {
  const run = hz => {
    const f = audioFixture();
    for (let i = 0; i < hz; i++) {
      const phase = i / hz;
      f.audio.fill(0);
      if (phase < .1 || (phase >= .5 && phase < .6)) f.audio.fill(200, 2, 7);
      f.step(1 / hz);
    }
    return f.spectrum;
  };
  const a = run(60), b = run(90), c = run(120);
  for (const spectrum of [b, c]) {
    assert.ok(Math.abs(a.bassGlow - spectrum.bassGlow) < .01);
    assert.ok(Math.abs(a.heights[3] - spectrum.heights[3]) < .02);
  }
});
