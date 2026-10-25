// Projectiles home in on their target and apply their damage exactly once on arrival.
// If the target dies first, the projectile flies on to the last known position and
// disappears without dealing damage.

/** Distance (cells) at which a projectile counts as hitting its target. */
const HIT_RADIUS = 0.25;
/** Aim point height on a zombie (world units). */
const AIM_HEIGHT = 0.5;

export class ProjectileSystem {
  #nextId = 1;

  constructor({ zombies, events }) {
    this.zombies = zombies;
    this.events = events;
    this.list = [];
  }

  /** @param {{ownerId:number, kind:string, from:{x,y,z}, target:object, speed:number, damage:number, crit?:boolean}} p */
  fire(p) {
    const proj = {
      id: this.#nextId++,
      ownerId: p.ownerId,
      kind: p.kind,
      x: p.from.x, y: p.from.y, z: p.from.z,
      sx: p.from.x, sy: p.from.y, sz: p.from.z,
      target: p.target,
      tx: p.target.x, tz: p.target.z,
      speed: p.speed,
      damage: p.damage,
      crit: !!p.crit,
      done: false,
      // Direction of travel, for rendering.
      dx: 0, dy: 0, dz: 1,
    };
    this.list.push(proj);
    return proj;
  }

  step(dt) {
    let write = 0;
    for (const p of this.list) {
      if (p.target.alive) { p.tx = p.target.x; p.tz = p.target.z; }
      const ex = p.tx - p.x, ey = AIM_HEIGHT - p.y, ez = p.tz - p.z;
      const d = Math.hypot(ex, ey, ez);
      const stepLen = p.speed * dt;
      if (d <= Math.max(stepLen, HIT_RADIUS)) {
        p.done = true;
        if (p.target.alive) {
          this.zombies.damage(p.target, p.damage, p.ownerId, { crit: p.crit });
          this.events.emit('projectileHit', { projectile: p });
        }
        continue;
      }
      p.dx = ex / d; p.dy = ey / d; p.dz = ez / d;
      p.x += p.dx * stepLen;
      p.y += p.dy * stepLen;
      p.z += p.dz * stepLen;
      this.list[write++] = p;
    }
    this.list.length = write;
  }

  clear() {
    this.list.length = 0;
  }
}
