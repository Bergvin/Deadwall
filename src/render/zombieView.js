// Draws all zombies with one baked instanced horde per model (see bakedHorde.js).
import * as THREE from 'three';
import { createBakedHorde } from './bakedHorde.js';
import { ZSTATE } from '../core/zombies.js';

const CLIPS = ['Walk', 'Punch', 'Death', 'Run'];
/** Walk cycle playback speed per cell/second of movement, so feet roughly match ground speed. */
const WALK_ANIM_RATE = 1.6;
/** Status tints (multiplied with the texture). */
const TINT = {
  none: new THREE.Color(1, 1, 1),
  slow: new THREE.Color(0.55, 0.8, 1.35),
  stun: new THREE.Color(1.3, 1.3, 0.7),
  poison: new THREE.Color(0.6, 1.3, 0.5),
  fire: new THREE.Color(1.5, 0.75, 0.45),
};

function tintOf(z, time) {
  if (time < z.stunUntil) return TINT.stun;
  if (z.dots.length) return z.dots.some((d) => d.type === 'fire') ? TINT.fire : TINT.poison;
  if (time < z.slowUntil) return TINT.slow;
  return TINT.none;
}

export class ZombieView {
  /**
   * @param {import('three').Scene} scene
   * @param {import('./assets.js').AssetLibrary} assets
   * @param {Record<string, {model:string}>} types
   */
  constructor(scene, assets, types, maxPerModel = 1500) {
    this.hordes = new Map(); // model name -> horde
    this.typeModel = {};
    for (const [key, t] of Object.entries(types)) {
      this.typeModel[key] = t.model;
      if (this.hordes.has(t.model)) continue;
      const clips = CLIPS.map((n) => assets.clips(t.model).find((c) => c.name === n)).filter(Boolean);
      const horde = createBakedHorde(assets.proto(t.model), clips, maxPerModel, { castShadow: true, meshName: 'Zombie' });
      scene.add(horde.mesh);
      this.hordes.set(t.model, horde);
    }
    this.counts = new Map();
  }

  /** Writes every zombie (alive or dying) into its horde for this frame. */
  sync(zombies, time = 0) {
    for (const k of this.hordes.keys()) this.counts.set(k, 0);
    for (const z of zombies) {
      const model = this.typeModel[z.type];
      const horde = this.hordes.get(model);
      const i = this.counts.get(model);
      if (i >= horde.mesh.instanceMatrix.count) continue;
      this.counts.set(model, i + 1);
      if (z.state === ZSTATE.DEAD) {
        horde.set(i, z.x, 0, z.z, z.facing, 'Death', z.deadTime, false, TINT.none);
      } else if (z.state === ZSTATE.MOVE) {
        horde.set(i, z.x, 0, z.z, z.facing, 'Walk', z.animTime * z.speed * WALK_ANIM_RATE, true, tintOf(z, time));
      } else {
        horde.set(i, z.x, 0, z.z, z.facing, 'Punch', z.animTime, true, tintOf(z, time));
      }
    }
    for (const [model, horde] of this.hordes) horde.commit(this.counts.get(model));
  }

  clear() {
    for (const horde of this.hordes.values()) horde.commit(0);
  }
}
