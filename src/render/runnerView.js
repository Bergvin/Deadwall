// The runner(s): the Monk model made silly. A huge wobbling head, bright clothes and a
// wobbly tower of ammo crates (one per crate he carries) with a floppy hat on top.
// Runs frantically, crouches to fill towers, gets knocked silly (stars) by zombies.
// The crates are stacked on his head, so the player can count them from above.
import * as THREE from 'three';
import { MODELS } from '../config/assets.js';

const TINT = new THREE.Color(1.1, 1, 0.95);

export class RunnerView {
  /** unit id -> node */
  #nodes = new Map();

  constructor(scene, assets, runner, events, cfg) {
    this.assets = assets;
    this.runner = runner;
    this.cfg = cfg;
    this.group = new THREE.Group();
    this.group.name = 'runners';
    scene.add(this.group);
    this.time = 0;
    this.crateGeom = new THREE.BoxGeometry(0.3, 0.18, 0.24);
    this.crateMat = new THREE.MeshLambertMaterial({ color: 0x9a6a38 });
    this.strapMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1a });
    this.bandGeom = new THREE.BoxGeometry(0.31, 0.04, 0.25);
    this.hatMat = new THREE.MeshLambertMaterial({ color: 0xd8402a });
    this.pomMat = new THREE.MeshLambertMaterial({ color: 0xfff0c0 });
    this.starMat = new THREE.MeshBasicMaterial({ color: 0xffe060 });
    this.starGeom = new THREE.OctahedronGeometry(0.06, 0);
    this.hitGeom = new THREE.CylinderGeometry(0.4, 0.4, 1.6, 8);
    this.hitGeom.translate(0, 0.7, 0);
    this.hitMat = new THREE.MeshBasicMaterial({ visible: false });
    events.on('spellCast', () => this.#playOnce(this.runner.main.id, 'cast', 0.6));
    events.on('runnerBonked', ({ runner }) => this.#playOnce(runner.id, 'bonked', 0.7));
  }

  get pickables() {
    return [...this.#nodes.values()].map((n) => n.hitbox);
  }

  #create(u) {
    const root = this.assets.instance('quartermaster');
    root.scale.multiplyScalar(this.cfg.modelScale);
    // Slightly brighter, sillier colours.
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.color?.multiply(TINT);
    });
    const mixer = new THREE.AnimationMixer(root);
    const clips = this.assets.clips('quartermaster');
    const actions = {};
    for (const [role, name] of Object.entries(MODELS.quartermaster.anims)) {
      const clip = clips.find((c) => c.name === name);
      if (!clip) continue;
      actions[role] = mixer.clipAction(clip);
      if (role === 'cast' || role === 'bonked') {
        actions[role].setLoop(THREE.LoopOnce, 1);
        actions[role].clampWhenFinished = false;
      }
    }
    actions.idle?.play();
    // A huge head...
    let head = null;
    root.traverse((o) => { if (o.isBone && o.name === 'Head') head = o; });
    if (head) head.scale.setScalar(this.cfg.headScale);
    // ...with a floppy hat and a wobbly tower of ammo crates balanced on top. These live in
    // world units in their own group that follows the head (the model itself is scaled).
    const deco = new THREE.Group();
    const hat = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 10), this.hatMat);
    cone.position.y = 0.14;
    cone.rotation.z = 0.4;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), this.pomMat);
    pom.position.set(-0.12, 0.28, 0);
    hat.add(cone, pom);
    deco.add(hat);
    const pack = new THREE.Group();
    deco.add(pack);
    const stars = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const st = new THREE.Mesh(this.starGeom, this.starMat);
      st.position.set(Math.cos(i * Math.PI * 0.4) * 0.3, 0, Math.sin(i * Math.PI * 0.4) * 0.3);
      stars.add(st);
    }
    stars.visible = false;
    deco.add(stars);
    this.group.add(deco);
    const hitbox = new THREE.Mesh(this.hitGeom, this.hitMat);
    hitbox.userData.runnerId = u.id;
    this.group.add(hitbox);
    this.group.add(root);
    const node = { root, mixer, actions, base: 'idle', pack, hat, crates: -1, stars, hitbox, head, deco };
    this.#nodes.set(u.id, node);
    return node;
  }

  #setBase(node, key) {
    if (!node.actions[key]) key = 'idle';
    if (node.base === key) return;
    node.actions[node.base]?.fadeOut(0.15);
    node.actions[key]?.reset().fadeIn(0.15).play();
    node.base = key;
  }

  #playOnce(id, role, maxSeconds) {
    const a = this.#nodes.get(id)?.actions[role];
    if (!a) return;
    a.timeScale = Math.max(1, a.getClip().duration / Math.max(0.2, maxSeconds));
    a.reset().setEffectiveWeight(1).play();
  }

  #stackCrates(node, n) {
    if (node.crates === n) return;
    node.crates = n;
    node.pack.clear();
    const shown = Math.min(n, 8);
    for (let i = 0; i < shown; i++) {
      const c = new THREE.Mesh(this.crateGeom, this.crateMat);
      // A wobbly, badly packed tower of crates.
      c.position.set((i % 2 ? 0.03 : -0.03), 0.09 + i * 0.18, 0);
      c.rotation.y = (i % 3 - 1) * 0.25;
      c.castShadow = true;
      const band = new THREE.Mesh(this.bandGeom, this.strapMat);
      band.position.copy(c.position);
      band.rotation.y = c.rotation.y;
      node.pack.add(c, band);
    }
    // The hat sits on top of the stack.
    node.hat.position.y = shown * 0.18;
  }

  /** @param {number} dt scaled game time */
  update(dt) {
    this.time += dt;
    for (const u of this.runner.units) {
      const node = this.#nodes.get(u.id) ?? this.#create(u);
      node.root.position.set(u.x, 0, u.z);
      node.root.rotation.y = u.facing;
      node.hitbox.position.set(u.x, 0, u.z);
      this.#stackCrates(node, u.crates);
      const state = u.state === 'bonked' ? 'bonked' : u.moving ? 'run' : (u.state === 'refill' || u.state === 'reload') ? 'work' : 'idle';
      if (state !== 'bonked') this.#setBase(node, state === 'work' ? 'work' : state === 'run' ? 'run' : 'idle');
      if (node.actions.run) node.actions.run.timeScale = 1.3;
      node.mixer.update(dt);
      const run = state === 'run';
      if (node.head) {
        node.head.scale.setScalar(this.cfg.headScale * (1 + Math.sin(this.time * (run ? 18 : 4)) * 0.03));
        node.root.updateMatrixWorld(true);
        node.head.getWorldPosition(node.deco.position);
      } else {
        node.deco.position.set(u.x, 1, u.z);
      }
      // The crates sit on top of the big head and sway as he runs.
      node.deco.position.y += 0.32;
      node.deco.rotation.y = u.facing;
      node.pack.rotation.z = Math.sin(this.time * (run ? 14 : 3)) * (run ? 0.1 : 0.03);
      node.pack.rotation.x = Math.sin(this.time * (run ? 9 : 2)) * (run ? 0.06 : 0.02);
      node.hat.rotation.z = node.pack.rotation.z * 1.5;
      node.stars.visible = state === 'bonked';
      node.stars.position.y = 0.3 + node.hat.position.y;
      node.stars.rotation.y += dt * 6;
    }
  }

  /** World position of a runner unit (for effects). */
  positionOf(id) {
    return this.#nodes.get(id)?.root.position ?? null;
  }

  dispose() {
    for (const n of this.#nodes.values()) { n.mixer.stopAllAction(); this.group.remove(n.root, n.deco, n.hitbox); }
    this.#nodes.clear();
    this.group.parent?.remove(this.group);
  }
}
