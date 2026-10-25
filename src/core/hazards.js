// Dangers to heroes: Plague Carriers poison heroes near them, and leave toxic puddles where
// they strike a wall or die. Puddles hurt heroes standing within their radius.

export class HazardSystem {
  #nextId = 1;

  /** @param {{zombies, heroes, events, types}} deps */
  constructor({ zombies, heroes, events, types }) {
    Object.assign(this, { zombies, heroes, events, types });
    /** Toxic puddles: {id, x, z, radius, dps, until, age, duration}. */
    this.puddles = [];
    this.time = 0;
    events.on('zombieAttack', ({ zombie, gate, x, y }) => {
      const p = this.types[zombie.type].plague;
      if (!p || gate) return;
      // One puddle per carrier per wall spot: refresh instead of stacking.
      const cx = x + 0.5, cz = y + 0.5;
      const existing = this.puddles.find((d) => d.ownerId === zombie.id && d.x === cx && d.z === cz);
      if (existing) {
        existing.until = this.time + p.puddleDuration;
        existing.duration = existing.age + p.puddleDuration; // keeps the visual fade in step
      }
      else this.#add(cx, cz, p.puddleRadius, p.puddleDps, p.puddleDuration, zombie.id);
    });
    events.on('zombieKilled', ({ zombie }) => {
      const p = this.types[zombie.type].plague;
      if (p) this.#add(zombie.x, zombie.z, p.puddleRadius, p.puddleDps, p.deathPuddleDuration, 0);
    });
  }

  #add(x, z, radius, dps, duration, ownerId) {
    const d = { id: this.#nextId++, x, z, radius, dps, duration, until: this.time + duration, age: 0, ownerId, kind: 'plague' };
    this.puddles.push(d);
    this.events.emit('puddleCreated', d);
  }

  step(dt) {
    this.time += dt;
    const heroes = [...this.heroes.active()];
    if (heroes.length) {
      const pos = heroes.map((h) => this.heroes.positionOf(h));
      // Carrier auras.
      for (const z of this.zombies.list) {
        const p = z.alive && this.types[z.type].plague;
        if (!p) continue;
        heroes.forEach((h, i) => {
          if (Math.hypot(pos[i].x - z.x, pos[i].z - z.z) <= p.auraRadius) this.heroes.damageHero(h, p.auraDps * dt, z);
        });
      }
      // Puddles.
      for (const d of this.puddles) {
        heroes.forEach((h, i) => {
          if (Math.hypot(pos[i].x - d.x, pos[i].z - d.z) <= d.radius) this.heroes.damageHero(h, d.dps * dt, d);
        });
      }
    }
    let w = 0;
    for (const d of this.puddles) {
      d.age += dt;
      if (this.time < d.until) this.puddles[w++] = d;
    }
    this.puddles.length = w;
  }
}
