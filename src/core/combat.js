// Turns impacts into damage and effects. Every hit (tower shots, commander abilities,
// spells) goes through applyPayload, so mitigation, crits and status effects behave the
// same everywhere. Payload fields (all optional except damage/type):
//   damage, type, armorPen, radius (area around the impact point), critChance, critMult,
//   bossMult (vs elites and bosses), burn {dps, duration}, bleed {dps (fraction of the
//   hit), duration}, slow {factor, duration}, freezeChance + freezeTime, stun (+ stunAll), knock
//   (shove back down the road), lift (throw up), shred {amount, duration},
//   napalm {radius, duration, dps}, poison {dps, duration} (ignores armor and resist, stops
//   regeneration), tags (e.g. ['sharp']: Ironclads are immune), fx (impact effect name).
// Immune victims (Ghosts vs physical, Ironclads vs sharp) take nothing and no effects.
export class CombatSystem {
  /** @param {{zombies, zones, events, rng}} deps */
  constructor({ zombies, zones, events, rng }) {
    Object.assign(this, { zombies, zones, events, rng });
  }

  /** Projectile arrival (see ProjectileSystem). */
  impact(p, target, x, z) {
    this.applyPayload(p.ownerId, p.payload, target, x, z);
  }

  applyPayload(sourceId, pl, target, x, z) {
    const victims = pl.radius > 0 ? [...this.zombies.inRange(x, z, pl.radius)] : [];
    if (target?.alive && !victims.includes(target)) victims.push(target);
    for (const v of victims) this.#hit(sourceId, pl, v, v === target);
    if (pl.napalm) {
      this.zones.add({
        x, z, radius: pl.napalm.radius, duration: pl.napalm.duration, dps: pl.napalm.dps,
        type: 'fire', ownerId: sourceId, kind: 'fire',
      });
    }
    if (pl.fx) this.events.emit('impactFx', { x, z, radius: pl.radius ?? 0, fx: pl.fx });
    return victims.length;
  }

  #hit(sourceId, pl, v, direct) {
    const zs = this.zombies;
    if (zs.isImmune(v, pl.type, pl.tags)) {
      if (direct) this.events.emit('zombieImmune', { zombie: v, sourceId });
      return;
    }
    let dmg = pl.damage ?? 0;
    const crit = pl.critChance > 0 && this.rng.next() < pl.critChance;
    if (crit) dmg *= pl.critMult ?? 2;
    if (pl.bossMult && (v.boss || v.elite)) dmg *= pl.bossMult;
    if (dmg > 0) zs.damage(v, dmg, sourceId, { type: pl.type, armorPen: pl.armorPen ?? 0, crit, tags: pl.tags });
    if (!v.alive) return;
    if (pl.poison) zs.addDot(v, { ...pl.poison, ownerId: sourceId, type: 'poison' });
    if (pl.shred) zs.applyShred(v, pl.shred.amount, pl.shred.duration);
    if (pl.burn) zs.addDot(v, { ...pl.burn, ownerId: sourceId, type: 'fire' });
    if (pl.bleed) zs.addDot(v, { dps: dmg * pl.bleed.dps, duration: pl.bleed.duration, ownerId: sourceId, type: 'true' });
    if (pl.slow) {
      zs.applySlow(v, pl.slow.factor, pl.slow.duration);
      if (pl.freezeChance && this.rng.next() < pl.freezeChance) {
        zs.applyStun(v, pl.freezeTime ?? 1.5);
        this.events.emit('zombieFrozen', { zombie: v });
      }
    }
    // A stun lands on the direct target only, unless the payload stuns everything it hits.
    if (pl.stun && (direct || pl.stunAll)) zs.applyStun(v, pl.stun);
    if (pl.knock || pl.lift) zs.push(v, pl.knock ?? 0, pl.lift ?? 0);
    if (!direct && pl.splashFx) this.events.emit('impactFx', { x: v.x, z: v.z, radius: 0, fx: pl.splashFx });
  }
}
