// The Commander's automatic abilities (from skills and artifacts) during a run. Each ability
// fires on its own timer while a wave is being fought; War Tithe pays out on wave clear.
// Damage scales with the ability's power and (partly) the wave's enemy HP multiplier, and
// goes through CombatSystem.applyPayload like every other hit (owner 0 = the Commander).
import { ABILITIES, ABILITY_HP_SCALING } from '../config/commander.js';

/** Seconds before retrying an ability that found nothing to do. */
const RETRY = 1;
/** How many candidate centres the pack search samples. */
const PACK_SAMPLES = 60;

export class CommanderAbilitySystem {
  /** @param {{powers: Record<string, number>, zombies, towers, house, economy, waves, combat, events, size, defs?}} deps */
  constructor({ powers, zombies, towers, house, economy, waves, combat, events, size = { width: 30, height: 24 }, defs = ABILITIES }) {
    Object.assign(this, { zombies, towers, house, economy, waves, combat, events, size, defs });
    this.list = Object.entries(powers)
      .filter(([id, p]) => defs[id] && p > 0)
      // The first activation comes halfway into a wave, then on the full interval.
      .map(([id, power]) => ({ id, power, def: defs[id], timer: (defs[id].interval ?? 0) / 2 }));
    this.uses = 0;
    events.on('waveStarted', () => { for (const a of this.list) a.timer = (a.def.interval ?? 0) / 2; });
    events.on('waveCleared', ({ wave }) => {
      for (const a of this.list) {
        if (!a.def.onWaveClear) continue;
        const gold = Math.round(a.def.goldPerWave * a.power * wave);
        this.economy.earn(gold, `ability:${a.id}`);
        this.#announce(a, this.house.x, this.house.z, `+${gold}`);
      }
    });
  }

  step(dt) {
    if (this.waves.phase !== 'active') return;
    for (const a of this.list) {
      if (a.def.onWaveClear) continue;
      a.timer -= dt;
      if (a.timer > 0) continue;
      a.timer = this.#fire(a) ? a.def.interval : RETRY;
    }
  }

  #alive() {
    return this.zombies.list.filter((z) => z.alive);
  }

  /** Centre of the densest group within `radius` (sampled). */
  #pack(alive, radius) {
    let best = null, bestN = -1;
    const step = Math.max(1, Math.floor(alive.length / PACK_SAMPLES));
    for (let i = 0; i < alive.length; i += step) {
      const c = alive[i];
      let n = 0;
      for (const o of alive) if ((o.x - c.x) ** 2 + (o.z - c.z) ** 2 <= radius * radius) n++;
      if (n > bestN) { bestN = n; best = c; }
    }
    return best;
  }

  #announce(a, x, z, extra = '') {
    this.uses++;
    this.events.emit('commanderAbility', { id: a.id, name: a.def.name, icon: a.def.icon, x, z, extra });
  }

  /** Runs one activation. Returns false when there was nothing to act on. */
  #fire(a) {
    const d = a.def, p = a.power, hp = this.waves.hpMultiplier ** ABILITY_HP_SCALING;
    const scaled = (dot) => dot && { dps: dot.dps * p * hp, duration: dot.duration };
    const alive = this.#alive();
    switch (d.target) {
      case 'pack': {
        const c = alive.length && this.#pack(alive, d.radius);
        if (!c) return false;
        const x = c.x, z = c.z;
        this.combat.applyPayload(0, {
          damage: (d.damage ?? 0) * p * hp, type: d.type, radius: d.radius,
          burn: scaled(d.burn), poison: scaled(d.poison), fx: d.fx,
        }, null, x, z);
        this.#announce(a, x, z);
        return true;
      }
      case 'several': {
        if (!alive.length) return false;
        const targets = alive.sort((q, r) => this.zombies.threatDistance(q) - this.zombies.threatDistance(r))
          .slice(0, d.targets + Math.floor(p));
        for (const t of targets) {
          this.combat.applyPayload(0, { damage: d.damage * p * hp, type: d.type, fx: `${d.fx}-small` }, t, t.x, t.z);
        }
        this.#announce(a, targets[0].x, targets[0].z);
        return true;
      }
      case 'toughest': {
        if (!alive.length) return false;
        const t = alive.reduce((m, z) => (z.hp > m.hp ? z : m));
        const x = t.x, z = t.z;
        this.combat.applyPayload(0, { damage: d.damage * p * hp, type: d.type, radius: 0.6, fx: d.fx }, null, x, z);
        this.#announce(a, x, z);
        return true;
      }
      case 'all': {
        if (!alive.length) return false;
        for (const z of alive) {
          if (d.damage) this.zombies.damage(z, d.damage * p * hp, 0, { type: d.type, dot: true });
          if (!z.alive) continue;
          if (d.slow) this.zombies.applySlow(z, d.slow, d.slowDuration * Math.sqrt(p));
          if (d.stun) this.zombies.applyStun(z, Math.min(4, d.stun * Math.sqrt(p)));
        }
        const cx = this.size.width / 2, cz = this.size.height / 2;
        this.events.emit('impactFx', { x: cx, z: cz, radius: 9, fx: d.fx });
        this.#announce(a, cx, cz);
        return true;
      }
      case 'towers': {
        const low = [...this.towers.all()].filter((t) => t.ammo < t.stats.maxAmmo);
        if (!low.length) return false;
        for (const t of low) this.towers.refill(t.id, t.stats.maxAmmo * d.ammoPct * p);
        this.#announce(a, low[0].cx, low[0].cz);
        return true;
      }
      case 'house': {
        const h = this.house;
        if (h.destroyed || h.hp >= h.maxHp) return false;
        h.heal(h.maxHp * d.healPct * p);
        this.#announce(a, h.x, h.z);
        return true;
      }
      default:
        return false;
    }
  }
}
