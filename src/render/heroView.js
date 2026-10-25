// Deployed heroes as animated skinned models standing on their wall, plus an invisible
// hit box per hero for picking.
import * as THREE from 'three';

/** Height of the wall walkway the heroes stand on. */
const WALKWAY_Y = 1.18;
const ANIM = { idle: 'Idle', ready: 'Idle_Attacking', shoot: 'Bow_Shoot', walk: 'Walk' };

export class HeroView {
  /** id -> { root, mixer, actions, hitbox, shotAt } */
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
    events.on('heroAttack', ({ hero }) => this.#playShot(hero.id));
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
    for (const [k, name] of Object.entries(ANIM)) {
      const clip = clips.find((c) => c.name === name);
      if (clip) actions[k] = mixer.clipAction(clip);
    }
    if (actions.shoot) {
      actions.shoot.setLoop(THREE.LoopOnce, 1);
      actions.shoot.clampWhenFinished = false;
    }
    actions.idle?.play();
    const hitbox = new THREE.Mesh(this.hitGeom, this.hitMat);
    hitbox.userData.heroId = hero.id;
    root.add(hitbox);
    this.group.add(root);
    const node = { root, mixer, actions, hitbox, base: 'idle' };
    this.#nodes.set(hero.id, node);
    return node;
  }

  #setBase(node, key) {
    if (node.base === key || !node.actions[key]) return;
    node.actions[node.base]?.fadeOut(0.2);
    node.actions[key].reset().fadeIn(0.2).play();
    node.base = key;
  }

  #playShot(id) {
    const node = this.#nodes.get(id);
    const a = node?.actions.shoot;
    if (!a) return;
    // Fit the shot animation inside the attack interval so it never lags behind.
    const hero = this.heroes.get(id);
    a.timeScale = Math.max(1, a.getClip().duration / Math.max(0.2, hero.attackInterval * 0.9));
    a.reset().setEffectiveWeight(1).play();
  }

  #drop(id) {
    const node = this.#nodes.get(id);
    if (!node) return;
    node.mixer.stopAllAction();
    this.group.remove(node.root);
    this.#nodes.delete(id);
  }

  /** Syncs nodes with hero state and advances animations by real frame time. */
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

  dispose() {
    for (const id of [...this.#nodes.keys()]) this.#drop(id);
    this.group.parent?.remove(this.group);
  }
}
