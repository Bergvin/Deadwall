// Active wall effects: spiked walls wound zombies attacking them; arcane walls slow nearby
// zombies and pulse magic damage on a timer.
import { ZSTATE } from './zombies.js';

/** Seconds between thorn damage ticks. */
const THORN_TICK = 0.5;

export class WallEffectSystem {
  /** @param {{walls, zombies, events}} deps */
  constructor({ walls, zombies, events }) {
    Object.assign(this, { walls, zombies, events });
    this.thornTimer = THORN_TICK;
  }

  step(dt) {
    this.thornTimer -= dt;
    const thornTick = this.thornTimer <= 0;
    if (thornTick) this.thornTimer += THORN_TICK;

    if (thornTick) {
      for (const z of this.zombies.list) {
        if (!z.alive || z.state !== ZSTATE.ATTACK_WALL) continue;
        const w = this.walls.get(z.targetWallId);
        if (!w?.thorns) continue;
        this.zombies.damage(z, w.thorns * THORN_TICK, 0, { type: 'physical', dot: true });
        this.events.emit('thornsHit', { zombie: z, wall: w });
      }
    }

    for (const w of this.walls.all()) {
      const a = w.arcane;
      if (!a) continue;
      const cx = w.x + 0.5, cz = w.y + 0.5;
      // Continuous slow inside the aura (refreshed every step, so it ends when they leave).
      for (const z of this.zombies.inRange(cx, cz, a.radius)) this.zombies.applySlow(z, a.slow, 0.15);
      w.pulseTimer -= dt;
      if (w.pulseTimer <= 0) {
        w.pulseTimer += a.pulseInterval;
        const hit = [...this.zombies.inRange(cx, cz, a.radius)];
        for (const z of hit) this.zombies.damage(z, a.pulseDamage, 0, { type: 'magic' });
        if (hit.length) this.events.emit('impactFx', { x: cx, z: cz, radius: a.radius, fx: 'arcane' });
      }
    }
  }
}
