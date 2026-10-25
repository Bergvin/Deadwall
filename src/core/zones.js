// Ground effects that damage zombies inside them on a fixed tick (poison clouds,
// consecration). Each tick damages every zombie in the radius once.
const TICK = 0.5;

export class ZoneSystem {
  #nextId = 1;

  /** @param {{zombies, events}} deps */
  constructor({ zombies, events }) {
    this.zombies = zombies;
    this.events = events;
    this.list = [];
  }

  /** @param {{x,z,radius,duration,dps,type,ownerId,kind}} z */
  add(zone) {
    const z = { id: this.#nextId++, age: 0, timer: 0, ...zone };
    this.list.push(z);
    this.events.emit('zoneCreated', z);
    return z;
  }

  step(dt) {
    let write = 0;
    for (const zone of this.list) {
      zone.age += dt;
      zone.timer -= dt;
      if (zone.timer <= 0) {
        zone.timer += TICK;
        for (const zb of [...this.zombies.inRange(zone.x, zone.z, zone.radius)]) {
          this.zombies.damage(zb, zone.dps * TICK, zone.ownerId, { type: zone.type, dot: true });
          if (zone.slow) this.zombies.applySlow(zb, zone.slow, TICK + 0.1);
        }
      }
      if (zone.age < zone.duration) this.list[write++] = zone;
    }
    this.list.length = write;
  }

  clear() {
    this.list.length = 0;
  }
}
