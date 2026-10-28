// Draws all zombies and bosses with one baked instanced horde per model (see bakedHorde.js).
// Types sharing a model differ by scale and tint; elites glow; status effects tint.
import * as THREE from 'three';
import { createBakedHorde } from './bakedHorde.js';
import { ZSTATE } from '../core/zombies.js';
import { MODELS } from '../config/assets.js';

/** Walk cycle playback speed per cell/second of movement, so feet roughly match ground speed. */
const WALK_ANIM_RATE = 1.6;
/** Status tints (multiplied with the type tint and texture). */
const STATUS = {
  slow: new THREE.Color(0.55, 0.8, 1.35),
  stun: new THREE.Color(1.3, 1.3, 0.7),
  poison: new THREE.Color(0.6, 1.3, 0.5),
  fire: new THREE.Color(1.5, 0.75, 0.45),
  empowered: new THREE.Color(1.35, 0.7, 1.2),
};
const ELITE_TINT = new THREE.Color(1.45, 0.75, 0.6);

export class ZombieView {
  /**
   * @param {import('three').Scene} scene
   * @param {import('./assets.js').AssetLibrary} assets
   * @param {Record<string, {model:string, tint?:number[]}>} types
   */
  constructor(scene, assets, types, maxPerModel = 1200) {
    this.hordes = new Map(); // model name -> {horde, anims}
    this.types = types;
    this.typeTint = {};
    for (const [key, t] of Object.entries(types)) {
      this.typeTint[key] = t.tint ? new THREE.Color(...t.tint) : new THREE.Color(1, 1, 1);
      if (this.hordes.has(t.model)) continue;
      const anims = MODELS[t.model].zanims;
      const clips = Object.values(anims).map((n) => assets.clips(t.model).find((c) => c.name === n)).filter(Boolean);
      const horde = createBakedHorde(assets.proto(t.model), clips, t.boss ? 8 : maxPerModel, { castShadow: true });
      scene.add(horde.mesh);
      this.hordes.set(t.model, { horde, anims, count: 0 });
    }
    this._c = new THREE.Color();
  }

  #tint(z, time) {
    const c = this._c.copy(this.typeTint[z.type]);
    if (z.elite) c.multiply(ELITE_TINT);
    if (time < z.stunUntil) c.multiply(STATUS.stun);
    else if (z.dots.length) c.multiply(z.dots.some((d) => d.type === 'fire') ? STATUS.fire : STATUS.poison);
    else if (time < z.slowUntil) c.multiply(STATUS.slow);
    else if (time < z.empoweredUntil) c.multiply(STATUS.empowered);
    return c;
  }

  /** Writes every zombie (alive or dying) into its horde for this frame. */
  sync(zombies, time = 0) {
    for (const h of this.hordes.values()) h.count = 0;
    for (const z of zombies) {
      const h = this.hordes.get(this.types[z.type].model);
      if (h.count >= h.horde.capacity) continue;
      const i = h.count++;
      const a = h.anims;
      if (z.state === ZSTATE.DEAD) {
        h.horde.set(i, z.x, z.air ?? 0, z.z, z.facing, a.death, z.deadTime, false, this.typeTint[z.type], z.scale);
      } else if (z.state === ZSTATE.MOVE) {
        h.horde.set(i, z.x, z.air ?? 0, z.z, z.facing, a.move, z.animTime * z.speed * WALK_ANIM_RATE, true, this.#tint(z, time), z.scale);
      } else {
        h.horde.set(i, z.x, z.air ?? 0, z.z, z.facing, a.attack, z.animTime, true, this.#tint(z, time), z.scale);
      }
    }
    for (const h of this.hordes.values()) h.horde.commit(h.count);
  }

  clear() {
    for (const h of this.hordes.values()) h.horde.commit(0);
  }
}
