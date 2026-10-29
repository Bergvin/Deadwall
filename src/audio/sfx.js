// Procedural sound effects with WebAudio: every sound is synthesised from oscillators and
// filtered noise, so no audio files are needed. The context is created on the first user
// gesture (browser autoplay rules). Each sound has a minimum repeat interval so a big
// horde never turns into a wall of noise.

/** name -> minimum seconds between plays */
const THROTTLE = {
  bow: 0.05, crossbow: 0.08, magic: 0.06, melee: 0.06, wallHit: 0.07, gateHit: 0.15,
  death: 0.05, gold: 0.06, thorns: 0.12, poison: 0.2, ui: 0.03, build: 0.04, deny: 0.15,
  repair: 0.1, alarm: 1.5, explosion: 0.08, fire: 0.08, arcane: 0.15,
  bonk: 0.2, refill: 0.08, slip: 0.12, leak: 0.1, empty: 0.6,
};

export class Sfx {
  constructor({ volume = 0.7, muted = false } = {}) {
    this.volume = volume;
    this.muted = muted;
    this.ctx = null;
    this.last = {};
    const unlock = () => this.#init();
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
  }

  #init() {
    if (this.ctx) return;
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.#applyVolume();
    // One second of white noise, reused by every noisy sound.
    const n = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, n, n);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.#startAmbience();
  }

  #applyVolume() {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.6;
  }

  setVolume(v) { this.volume = Math.min(1, Math.max(0, v)); this.#applyVolume(); }
  setMuted(m) { this.muted = !!m; this.#applyVolume(); }

  // --- building blocks -----------------------------------------------------
  #env(gain, t, attack, decay, peak) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** Oscillator with a pitch sweep and an attack/decay envelope. */
  #tone(type, f0, f1, dur, peak = 0.3, delay = 0, attack = 0.005) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.#env(g, t, attack, dur, peak);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  /** Filtered noise burst; the filter frequency sweeps from f0 to f1. */
  #noise(filter, f0, f1, dur, peak = 0.3, delay = 0, attack = 0.003, q = 1) {
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    this.#env(g, t, attack, dur, peak);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + dur + 0.05);
  }

  #startAmbience() {
    // Low, slowly swelling wind under everything.
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = c.createGain();
    g.gain.value = 0.05;
    const lfo = c.createOscillator(), lfoGain = c.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    lfo.start();
  }

  // --- sounds --------------------------------------------------------------
  /** Plays a named sound if audio is running and its throttle allows. */
  play(name, intensity = 1) {
    if (!this.ctx || this.muted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime;
    if (now - (this.last[name] ?? -1) < (THROTTLE[name] ?? 0)) return;
    this.last[name] = now;
    const k = Math.min(1.5, intensity);
    const fn = this.recipes[name];
    if (fn) fn.call(this, k);
  }

  recipes = {
    bow(k) { this.#noise('bandpass', 2600, 900, 0.08, 0.12 * k, 0, 0.002, 2); this.#tone('triangle', 700, 260, 0.09, 0.05 * k); },
    crossbow(k) { this.#noise('lowpass', 1400, 200, 0.14, 0.25 * k); this.#tone('square', 160, 70, 0.12, 0.08 * k); },
    magic(k) { this.#tone('sine', 420, 1300, 0.22, 0.09 * k, 0, 0.02); this.#tone('triangle', 840, 2000, 0.18, 0.04 * k, 0.02, 0.02); },
    fire(k) { this.#noise('lowpass', 2200, 90, 0.7, 0.35 * k, 0, 0.01); this.#tone('sine', 90, 40, 0.5, 0.25 * k); },
    explosion(k) { this.#noise('lowpass', 1600, 60, 0.9, 0.45 * k, 0, 0.005); this.#tone('sine', 70, 30, 0.7, 0.35 * k); },
    frost(k) { this.#noise('highpass', 5000, 2500, 0.5, 0.12 * k, 0, 0.03); this.#tone('sine', 1800, 2600, 0.4, 0.04 * k, 0, 0.05); },
    arcane(k) { this.#tone('sawtooth', 220, 880, 0.3, 0.06 * k, 0, 0.01); this.#noise('bandpass', 1500, 4000, 0.3, 0.1 * k, 0, 0.01, 3); },
    holy(k) { [523, 659, 784].forEach((f, i) => this.#tone('sine', f, f, 0.6, 0.06 * k, i * 0.05, 0.03)); },
    poison(k) { this.#noise('bandpass', 600, 300, 0.35, 0.12 * k, 0, 0.02, 4); },
    melee(k) { this.#noise('highpass', 3000, 1500, 0.05, 0.15 * k); this.#tone('triangle', 900, 700, 0.12, 0.05 * k); this.#tone('sine', 1350, 1200, 0.1, 0.03 * k); },
    bash(k) { this.#noise('lowpass', 900, 150, 0.25, 0.35 * k); this.#tone('sine', 120, 60, 0.2, 0.25 * k); },
    wallHit(k) { this.#tone('sine', 95, 50, 0.12, 0.16 * k); this.#noise('lowpass', 500, 150, 0.08, 0.1 * k); },
    gateHit(k) { this.#tone('sine', 70, 40, 0.25, 0.3 * k); this.#noise('lowpass', 700, 120, 0.2, 0.2 * k); },
    wallDestroy(k) { this.#noise('lowpass', 900, 40, 1.2, 0.55 * k, 0, 0.01); this.#noise('highpass', 2500, 800, 0.15, 0.2 * k); this.#tone('sine', 55, 30, 0.9, 0.3 * k); },
    build(k) { this.#tone('square', 320, 300, 0.05, 0.06 * k); this.#tone('square', 230, 220, 0.06, 0.06 * k, 0.07); },
    repair(k) { [440, 554, 659].forEach((f, i) => this.#tone('triangle', f, f, 0.15, 0.07 * k, i * 0.07)); },
    gold(k) { this.#tone('sine', 1560, 1560, 0.08, 0.035 * k); this.#tone('sine', 2340, 2340, 0.1, 0.025 * k, 0.03); },
    death(k) { this.#noise('lowpass', 700, 120, 0.18, 0.08 * k); },
    thorns(k) { this.#noise('highpass', 4000, 2000, 0.05, 0.05 * k); },
    levelUp(k) { [523, 659, 784, 1047].forEach((f, i) => this.#tone('triangle', f, f, 0.22, 0.09 * k, i * 0.08)); },
    waveStart(k) {
      this.#tone('sawtooth', 110, 104, 1.4, 0.12 * k, 0, 0.25);
      this.#tone('sawtooth', 165, 156, 1.4, 0.08 * k, 0.05, 0.25);
      this.#noise('lowpass', 300, 120, 1.2, 0.08 * k, 0, 0.3);
    },
    waveCleared(k) { [392, 523, 659].forEach((f, i) => this.#tone('triangle', f, f, 0.5, 0.08 * k, i * 0.12, 0.02)); },
    boss(k) {
      this.#tone('sawtooth', 55, 42, 1.8, 0.22 * k, 0, 0.3);
      this.#tone('sawtooth', 82, 61, 1.8, 0.12 * k, 0.1, 0.3);
      this.#noise('lowpass', 400, 80, 1.6, 0.18 * k, 0, 0.2);
    },
    alarm(k) { [0, 0.25].forEach((d) => this.#tone('square', 660, 640, 0.15, 0.06 * k, d)); },
    gameOver(k) {
      [220, 261, 311].forEach((f, i) => this.#tone('sawtooth', f, f * 0.5, 2.4, 0.08 * k, i * 0.04, 0.05));
      this.#noise('lowpass', 600, 50, 2.5, 0.2 * k, 0, 0.1);
    },
    ui(k) { this.#tone('sine', 900, 700, 0.04, 0.04 * k); },
    deny(k) { this.#tone('square', 180, 140, 0.12, 0.05 * k); },
    // Silly runner sounds.
    bonk(k) { this.#tone('sine', 900, 180, 0.18, 0.18 * k); this.#noise('bandpass', 1200, 600, 0.06, 0.15 * k, 0, 0.002, 3); this.#tone('triangle', 1400, 1500, 0.35, 0.04 * k, 0.12, 0.01); },
    refill(k) { this.#tone('triangle', 300, 720, 0.12, 0.07 * k); this.#noise('lowpass', 900, 300, 0.08, 0.08 * k, 0.05); },
    spell(k) { [659, 880, 1175, 1568].forEach((f, i) => this.#tone('triangle', f, f * 1.01, 0.16, 0.06 * k, i * 0.05)); },
    slip(k) { this.#tone('sine', 1400, 300, 0.4, 0.07 * k, 0, 0.01); },
    leak(k) { this.#tone('sine', 80, 40, 0.35, 0.3 * k); this.#noise('lowpass', 800, 100, 0.3, 0.25 * k); },
    empty(k) { this.#tone('square', 300, 300, 0.06, 0.04 * k); this.#tone('square', 220, 220, 0.08, 0.04 * k, 0.09); },
  };
}
