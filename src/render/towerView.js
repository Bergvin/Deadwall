// Towers on the ground: a Kenney hexagon tower that grows taller with its level (a middle
// section at levels 4 and 7, a crown of rings at 10), a glowing element orb on top, a
// coloured band for its specialisation and a warning marker when it runs low on ammo or
// is empty. The orb pulses when it fires. Each root carries userData.towerId for picking.
import * as THREE from 'three';

/** Scale of the Kenney hexagon pieces (authored one cell wide) for a ground tower. */
const PIECE_SCALE = 0.86;
const SPEC_COLOR = { a: 0xffc23d, b: 0x7fd8ff };

export class TowerView {
  /** id -> { root, orb, halo, pulse, warn, top } */
  #nodes = new Map();

  constructor(scene, assets, towers, events, types, rules) {
    this.assets = assets;
    this.towers = towers;
    this.types = types;
    this.rules = rules;
    this.group = new THREE.Group();
    this.group.name = 'towers';
    scene.add(this.group);
    const h = (name) => new THREE.Box3().setFromObject(assets.proto(name)).getSize(new THREE.Vector3()).y;
    this.heights = { base: h('towerHexBase'), mid: h('towerHexMid'), top: h('towerHexTop') };
    this.orbGeom = new THREE.IcosahedronGeometry(0.17, 1);
    this.haloGeom = new THREE.SphereGeometry(0.32, 12, 8);
    this.ringGeom = new THREE.TorusGeometry(0.42, 0.025, 6, 28);
    this.ringGeom.rotateX(Math.PI / 2);
    this.bandGeom = new THREE.CylinderGeometry(0.47, 0.47, 0.08, 16, 1, true);
    this.warnGeom = new THREE.OctahedronGeometry(0.13, 0);
    this.warnMats = {
      low: new THREE.MeshBasicMaterial({ color: 0xffc23d }),
      empty: new THREE.MeshBasicMaterial({ color: 0xff3a2a }),
    };
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
        a: new THREE.MeshBasicMaterial({ color: SPEC_COLOR.a, side: THREE.DoubleSide }),
        b: new THREE.MeshBasicMaterial({ color: SPEC_COLOR.b, side: THREE.DoubleSide }),
      };
    }
    return this.mats[type];
  }

  #create(t) {
    const m = this.#mat(t.type);
    const H = this.heights;
    const root = new THREE.Group();
    root.position.set(t.cx, 0, t.cz);
    root.userData.towerId = t.id;
    const add = (name, y) => {
      const o = this.assets.instance(name);
      o.scale.setScalar(PIECE_SCALE);
      o.position.y = y;
      root.add(o);
      return o;
    };
    // Taller with every few levels: base, a middle section at 4 and 7, then the top.
    let y = 0;
    add('towerHexBase', y);
    y += H.base * PIECE_SCALE;
    const mids = (t.level >= 4 ? 1 : 0) + (t.level >= 7 ? 1 : 0);
    for (let i = 0; i < mids; i++) { add('towerHexMid', y); y += H.mid * PIECE_SCALE; }
    add('towerHexTop', y);
    const top = y + H.top * PIECE_SCALE;
    if (t.spec) {
      const band = new THREE.Mesh(this.bandGeom, m[t.spec]);
      band.position.y = y - 0.05;
      root.add(band);
    }
    const orbY = top + 0.35;
    const orb = new THREE.Mesh(this.orbGeom, m.orb);
    orb.position.y = orbY;
    orb.scale.setScalar(1 + (t.level - 1) * 0.06);
    const halo = new THREE.Mesh(this.haloGeom, m.halo);
    halo.position.y = orbY;
    root.add(orb, halo);
    // One small ring per level, floating around the top.
    for (let i = 0; i < t.level; i++) {
      const ring = new THREE.Mesh(this.ringGeom, m.ring);
      ring.position.y = top - 0.12 - i * 0.07;
      ring.scale.setScalar(0.9 + (i % 2) * 0.08);
      root.add(ring);
    }
    const warn = new THREE.Mesh(this.warnGeom, this.warnMats.low);
    warn.position.y = orbY + 0.55;
    warn.visible = false;
    root.add(warn);
    root.traverse((o) => { if (o.isMesh) o.userData.towerId = t.id; });
    this.group.add(root);
    this.#nodes.set(t.id, { root, orb, halo, warn, orbY, pulse: 0, phase: Math.random() * 6 });
  }

  #drop(id) {
    const n = this.#nodes.get(id);
    if (!n) return;
    this.group.remove(n.root);
    this.#nodes.delete(id);
  }

  /** Top of a tower (for floating text and bars). */
  topOf(id) {
    return (this.#nodes.get(id)?.orbY ?? 1.5) + 0.3;
  }

  update(dt) {
    this.time += dt;
    for (const [id, n] of this.#nodes) {
      const t = this.towers.get(id);
      n.pulse = Math.max(0, n.pulse - dt * 4);
      const bob = Math.sin(this.time * 2.2 + n.phase) * 0.05;
      n.orb.position.y = n.halo.position.y = n.orbY + bob;
      n.orb.rotation.y += dt * 1.5;
      n.halo.scale.setScalar(1 + n.pulse * 0.8);
      n.halo.material.opacity = 0.22 + n.pulse * 0.35;
      // Ammo warning: yellow when low, red and blinking when empty.
      const frac = t ? t.ammo / t.stats.maxAmmo : 1;
      const empty = t && t.ammo < 1;
      n.warn.visible = !!t && frac < this.rules.lowAmmo && (!empty || Math.sin(this.time * 10) > -0.2);
      n.warn.material = empty ? this.warnMats.empty : this.warnMats.low;
      n.warn.rotation.y += dt * 3;
      n.warn.position.y = n.orbY + 0.55 + Math.sin(this.time * 4) * 0.06;
      // A jammed tower's orb goes dark.
      n.orb.visible = !(t && this.towers.time < t.jammedUntil) || Math.sin(this.time * 20) > 0;
    }
  }

  dispose() {
    for (const id of [...this.#nodes.keys()]) this.#drop(id);
    this.group.parent?.remove(this.group);
  }
}
