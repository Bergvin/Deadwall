// Fixed-timestep simulation clock. Rendering runs every animation frame; the simulation
// advances in fixed steps scaled by game speed, so pause and speed changes affect every
// timer the same way (cooldowns, movement, countdowns).
export class GameLoop {
  constructor({ step = 1 / 60, maxStepsPerFrame = 8, onStep, onFrame }) {
    this.step = step;
    this.maxStepsPerFrame = maxStepsPerFrame;
    this.onStep = onStep;
    this.onFrame = onFrame;
    this.speed = 1;
    this.paused = false;
    this.simTime = 0;
    this.accumulator = 0;
    this.lastNow = 0;
    this.running = false;
  }

  start() {
    this.running = true;
    this.lastNow = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const realDt = Math.min((now - this.lastNow) / 1000, 0.25);
      this.lastNow = now;
      this.advance(realDt);
      this.onFrame?.(realDt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
  }

  /** Advances simulation by real seconds (exposed for tests and benchmarks). */
  advance(realDt) {
    if (this.paused) return;
    this.accumulator += realDt * this.speed;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxStepsPerFrame * this.speed) {
      this.onStep?.(this.step);
      this.simTime += this.step;
      this.accumulator -= this.step;
      steps++;
    }
    // Drop backlog after a long stall instead of fast-forwarding through it.
    if (this.accumulator > this.step * 4) this.accumulator = 0;
  }
}
