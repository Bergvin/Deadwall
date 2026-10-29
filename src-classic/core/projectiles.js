// Projectiles in flight. Three flight modes:
// - homing: follows a zombie; on arrival impacts it (if still alive) at its position.
// - point: flies to a fixed ground point (thrown flasks, fireballs) and impacts there.
// - line: flies straight for a set length, hitting each zombie it passes once, up to maxHits.
// The system only moves projectiles and reports impacts; what an impact does is decided by
// the owner via the payload (see combat.js), so damage is applied exactly once per impact.

/** Distance (cells) at which a projectile counts as arriving. */
const HIT_RADIUS = 0.25;
/** Aim point height on a zombie (world units). */
const AIM_HEIGHT = 0.5;

export class ProjectileSystem {
  #nextId = 1;

  /** @param {{zombies, onImpact: (p, zombie|null, x:number, z:number) => void}} deps */
  constructor({ zombies, onImpact }) {
    this.zombies = zombies;
    this.onImpact = onImpact;
    this.list = [];
  }

  /**
   * @param {{ownerId:number, kind:string, from:{x,y,z}, speed:number, payload:object,
   *          target?:object, point?:{x,z}, line?:{dx,dz,length,width,maxHits}, arc?:number}} p
   */
  fire(p) {
    const tx = p.target ? p.target.x : p.point ? p.point.x : p.from.x + p.line.dx * p.line.length;
    const tz = p.target ? p.target.z : p.point ? p.point.z : p.from.z + p.line.dz * p.line.length;
    const proj = {
      id: this.#nextId++,
      ownerId: p.ownerId,
      kind: p.kind,
      mode: p.line ? 'line' : p.target ? 'homing' : 'point',
      x: p.from.x, y: p.from.y, z: p.from.z,
      sy: p.from.y,
      target: p.target ?? null,
      tx, tz,
      speed: p.speed,
      payload: p.payload,
      line: p.line ?? null,
      hit: p.line ? new Set() : null,
      travelled: 0,
      total: Math.max(0.01, Math.hypot(tx - p.from.x, tz - p.from.z)),
      arc: p.arc ?? 0,
      dx: 0, dy: 0, dz: 1,
    };
    this.list.push(proj);
    return proj;
  }

  step(dt) {
    let write = 0;
    for (const p of this.list) {
      const keep = p.mode === 'line' ? this.#stepLine(p, dt) : this.#stepToTarget(p, dt);
      if (keep) this.list[write++] = p;
    }
    this.list.length = write;
  }

  #stepToTarget(p, dt) {
    if (p.mode === 'homing' && p.target.alive) { p.tx = p.target.x; p.tz = p.target.z; }
    const ex = p.tx - p.x, ez = p.tz - p.z;
    const flat = Math.hypot(ex, ez);
    const stepLen = p.speed * dt;
    // Height follows a straight line to the aim point plus an optional arc.
    const progress = Math.min(1, (p.travelled + stepLen) / Math.max(p.total, p.travelled + flat));
    const baseY = p.sy + (AIM_HEIGHT - p.sy) * progress;
    const y = baseY + p.arc * 4 * progress * (1 - progress);
    if (flat <= Math.max(stepLen, HIT_RADIUS)) {
      const target = p.mode === 'homing' && p.target.alive ? p.target : null;
      // A homing shot whose target already died simply fizzles.
      if (p.mode === 'point' || target) this.onImpact(p, target, p.tx, p.tz);
      return false;
    }
    p.dx = ex / flat; p.dz = ez / flat;
    p.dy = (y - p.y) / stepLen;
    const n = Math.hypot(p.dx, p.dy, p.dz);
    p.dx /= n; p.dy /= n; p.dz /= n;
    p.x += (ex / flat) * stepLen;
    p.z += (ez / flat) * stepLen;
    p.y = y;
    p.travelled += stepLen;
    return true;
  }

  #stepLine(p, dt) {
    const L = p.line;
    const stepLen = p.speed * dt;
    p.dx = L.dx; p.dz = L.dz; p.dy = 0;
    p.x += L.dx * stepLen;
    p.z += L.dz * stepLen;
    // Shafts sink toward aim height; a ball that starts on the ground keeps rolling there.
    p.y = p.sy < AIM_HEIGHT ? p.sy : Math.max(AIM_HEIGHT, p.y - 0.8 * dt);
    p.travelled += stepLen;
    for (const z of this.zombies.inRange(p.x, p.z, L.width)) {
      if (p.hit.has(z.id)) continue;
      p.hit.add(z.id);
      this.onImpact(p, z, z.x, z.z);
      if (p.hit.size >= L.maxHits) return false;
    }
    return p.travelled < L.length;
  }

  clear() {
    this.list.length = 0;
  }
}
