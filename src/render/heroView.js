// Deployed heroes as animated skinned models standing on their wall, plus an invisible
// hit box per hero for picking. Animation roles per model come from config/assets.js.
import * as THREE from 'three';
import { MODELS } from '../config/assets.js';

/** Height of the wall walkway the heroes stand on. */
const WALKWAY_Y = 1.18;

export class HeroView {
  /** id -> { root, mixer, actions, hitbox, base } */
  #nodes = new Map();

  constructor(scene, assets, heroes, events, heroTypes) {
    this.assets = assets;
    this.heroes = heroes;
    this.heroTypes = heroTypes;
    this.group = new THREE.Group();
    this.group.name = 'heroes';
    scene.add(this.group);
    this.hitMat = new THREE.MeshBasicMaterial({ visible: false });
    this.hitGeom = new THREE.CylinderGeometry(0.3, 0.3, 1, 8);
    this.hitGeom.translate(0, 0.5, 0);
    events.on('heroAttack', ({ hero }) => this.#playOnce(hero.id, 'attack', hero.stats.attackInterval * 0.9));
    events.on('abilityUsed', ({ hero }) => this.#playOnce(hero.id, 'cast', 0.9));
    events.on('heroDismissed', (h) => this.#drop(h.id));
  }

  get pickables() {
    return [...this.#nodes.values()].map((n) => n.hitbox);
  }

  #create(hero) {
    const model = this.heroTypes[hero.type].model;
    const root = this.assets.instance(model);
    const mixer = new THREE.AnimationMixer(root);
    const clips = this.assets.clips(model);
    const actions = {};
    for (const [role, name] of Object.entries(MODELS[model].anims ?? {})) {
      const clip = clips.find((c) => c.name === name);
      if (!clip) continue;
      actions[role] = mixer.clipAction(clip);
      if (role === 'attack' || role === 'cast') {
        actions[role].setLoop(THREE.LoopOnce, 1);
        actions[role].clampWhenFinished = false;
      }
    }
    actions.idle?.play();
    if (hero.type === 'crossbowman') this.#equipCrossbow(root);
    const hitbox = new THREE.Mesh(this.hitGeom, this.hitMat);
    hitbox.userData.heroId = hero.id;
    root.add(hitbox);
    this.group.add(root);
    const node = { root, mixer, actions, hitbox, base: 'idle' };
    this.#nodes.set(hero.id, node);
    return node;
  }

  /**
   * The Rogue model carries a dagger; swap it for a small crossbow attached to the right
   * hand bone. Built in world units and scaled back by the bone's world scale.
   */
  #equipCrossbow(root) {
    // The crossbow goes where the dagger was: the dagger's parent is the hand bone
    // (GLTFLoader strips the dot from its glTF name, "Weapon.R" -> "WeaponR").
    let bone = null;
    root.traverse((o) => {
      if (o.name === 'Rogue_Dagger') { o.visible = false; bone = o.parent; }
    });
    if (!bone) return;
    this.crossbowParts ??= {
      wood: new THREE.MeshLambertMaterial({ color: 0x5a3a20 }),
      iron: new THREE.MeshLambertMaterial({ color: 0x3a3a40 }),
      stock: new THREE.BoxGeometry(0.035, 0.035, 0.26),
      bow: new THREE.BoxGeometry(0.24, 0.02, 0.025),
      bolt: new THREE.BoxGeometry(0.012, 0.012, 0.2),
    };
    const p = this.crossbowParts;
    const bow = new THREE.Group();
    const stock = new THREE.Mesh(p.stock, p.wood);
    const limbs = new THREE.Mesh(p.bow, p.iron);
    limbs.position.z = 0.12;
    const bolt = new THREE.Mesh(p.bolt, p.iron);
    bolt.position.set(0, 0.025, 0.06);
    bow.add(stock, limbs, bolt);
    root.updateMatrixWorld(true);
    const s = new THREE.Vector3();
    bone.getWorldScale(s);
    bow.scale.setScalar(1 / s.x);
    bone.add(bow);
  }

  #setBase(node, key) {
    if (!node.actions[key]) key = 'idle';
    if (node.base === key) return;
    node.actions[node.base]?.fadeOut(0.2);
    node.actions[key]?.reset().fadeIn(0.2).play();
    node.base = key;
  }

  /** Plays a one-shot clip, sped up to fit inside `maxSeconds` if needed. */
  #playOnce(id, role, maxSeconds) {
    const a = this.#nodes.get(id)?.actions[role];
    if (!a) return;
    a.timeScale = Math.max(1, a.getClip().duration / Math.max(0.2, maxSeconds));
    a.reset().setEffectiveWeight(1).play();
  }

  /** Syncs nodes with hero state and advances animations by `dt` (scaled game time). */
  update(dt, walls) {
    for (const h of this.heroes.all()) {
      const w = h.wallId ? walls.get(h.wallId) : null;
      let node = this.#nodes.get(h.id);
      if (!w) { if (node) node.root.visible = false; continue; }
      node ??= this.#create(h);
      node.root.visible = true;
      // Spread multiple heroes on one wall across the cell.
      const slot = w.heroes.indexOf(h.id), n = w.heroes.length;
      const off = n > 1 ? (slot / (n - 1) - 0.5) * 0.5 : 0;
      node.root.position.set(w.x + 0.5 + off, WALKWAY_Y, w.y + 0.5);
      node.root.rotation.y = h.facing;
      this.#setBase(node, h.moving > 0 ? 'walk' : h.targetId ? 'ready' : 'idle');
      node.mixer.update(dt);
    }
  }

  /** World position of a hero model (for effects), or null. */
  positionOf(id) {
    const n = this.#nodes.get(id);
    return n?.root.visible ? n.root.position : null;
  }

  dispose() {
    for (const id of [...this.#nodes.keys()]) this.#drop(id);
    this.group.parent?.remove(this.group);
  }

  #drop(id) {
    const node = this.#nodes.get(id);
    if (!node) return;
    node.mixer.stopAllAction();
    this.group.remove(node.root);
    this.#nodes.delete(id);
  }
}
