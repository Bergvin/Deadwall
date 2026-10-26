// Elemental towers drawn on their walls: a small hexagonal stone tower on the walkway, a
// glowing element orb above it and one element-coloured ring per upgrade level. The orb
// pulses when the tower fires. Each tower root carries userData.towerId for picking.
import * as THREE from 'three';

/** Height of the wall walkway the towers stand on. */
const WALKWAY_Y = 1.18;
/** Scale of the Kenney hexagon pieces (authored at one cell wide) on top of a wall. */
const PIECE_SCALE = 0.58;
/** Height of tower-hexagon-base.glb in its own units. */
const BASE_HEIGHT = 1.31;

export class TowerView {
  /** id -> { root, orb, halo, pulse } */
  #nodes = new Map();

  constructor(scene, assets, towers, events, types) {
    this.assets = assets;
    this.towers = towers;
    this.types = types;
    this.group = new THREE.Group();
    this.group.name = 'towers';
    scene.add(this.group);
    this.orbGeom = new THREE.IcosahedronGeometry(0.16, 1);
    this.haloGeom = new THREE.SphereGeometry(0.3, 12, 8);
    this.ringGeom = new THREE.TorusGeometry(0.33, 0.03, 6, 24);
    this.ringGeom.rotateX(Math.PI / 2);
    this.mats = {};
    this.time = 0;
    events.on('towerBuilt', (t) => this.#create(t));
    events.on('towerUpgraded', (t) => { this.#drop(t.id); this.#create(t); });
    events.on('towerRemoved', ({ tower }) => this.#drop(tower.id));
    events.on('towerAttack', ({ tower }) => {
      const n = this.#nodes.get(tower.id);
      if (n) n.pulse = 1;
    });
  }

  get pickables() {
    return this.group.children;
  }

  #mat(type) {
    if (!this.mats[type]) {
      const color = this.types[type].color;
      this.mats[type] = {
        orb: new THREE.MeshBasicMaterial({ color }),
        halo: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }),
        ring: new THREE.MeshBasicMaterial({ color }),
      };
    }
    return this.mats[type];
  }

  #create(t) {
    const m = this.#mat(t.type);
    const root = new THREE.Group();
    root.position.set(t.x, WALKWAY_Y, t.z);
    root.userData.towerId = t.id;
    const base = this.assets.instance('towerHexBase');
    base.scale.setScalar(PIECE_SCALE);
    const top = this.assets.instance('towerHexTop');
    top.scale.setScalar(PIECE_SCALE);
    top.position.y = BASE_HEIGHT * PIECE_SCALE; // battlements stacked on the base
    root.add(base, top);
    const h = 1.15; // orb height above the walkway
    const orb = new THREE.Mesh(this.orbGeom, m.orb);
    orb.position.y = h;
    const halo = new THREE.Mesh(this.haloGeom, m.halo);
    halo.position.y = h;
    root.add(orb, halo);
    for (let i = 0; i < t.level; i++) {
      const ring = new THREE.Mesh(this.ringGeom, m.ring);
      ring.position.y = 0.55 + i * 0.12;
      root.add(ring);
    }
    root.traverse((o) => { if (o.isMesh) o.userData.towerId = t.id; });
    this.group.add(root);
    this.#nodes.set(t.id, { root, orb, halo, pulse: 0, phase: Math.random() * 6 });
  }

  #drop(id) {
    const n = this.#nodes.get(id);
    if (!n) return;
    this.group.remove(n.root);
    this.#nodes.delete(id);
  }

  update(dt) {
    this.time += dt;
    for (const n of this.#nodes.values()) {
      n.pulse = Math.max(0, n.pulse - dt * 4);
      const bob = Math.sin(this.time * 2.2 + n.phase) * 0.05;
      n.orb.position.y = n.halo.position.y = 1.15 + bob;
      n.orb.rotation.y += dt * 1.5;
      n.halo.scale.setScalar(1 + n.pulse * 0.8);
      n.halo.material.opacity = 0.22 + n.pulse * 0.35;
    }
  }

  dispose() {
    for (const id of [...this.#nodes.keys()]) this.#drop(id);
    this.group.parent?.remove(this.group);
  }
}
