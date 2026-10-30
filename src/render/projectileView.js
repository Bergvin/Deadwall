// Projectiles drawn with one instanced mesh per visual style, oriented along travel.
import * as THREE from 'three';

/** kind -> style. Shafts are cylinders along +z; orbs are glowing spheres. */
const STYLES = {
  shaft: { geom: () => cyl(0.015, 0.5), color: 0xe8d8b0 },
  pierce: { geom: () => cyl(0.03, 0.8), color: 0xfff2a0 },
  bolt: { geom: () => cyl(0.03, 0.45), color: 0x5a4a3a },
  apbolt: { geom: () => cyl(0.04, 0.55), color: 0x9fe8ff },
  orb: { geom: () => new THREE.SphereGeometry(0.09, 10, 8), color: 0x7aa8ff },
  fireball: { geom: () => new THREE.SphereGeometry(0.2, 12, 10), color: 0xff7a20 },
  flask: { geom: () => new THREE.SphereGeometry(0.08, 8, 6), color: 0x7cff5a },
  bomb: { geom: () => new THREE.SphereGeometry(0.12, 8, 6), color: 0xff9a40 },
  firebolt: { geom: () => new THREE.SphereGeometry(0.11, 10, 8), color: 0xff6a20 },
  boulder: { geom: () => new THREE.DodecahedronGeometry(0.15), color: 0x8a6a48 },
  gust: { geom: () => cyl(0.025, 0.6), color: 0xd8fff0 },
  waterbolt: { geom: () => new THREE.SphereGeometry(0.1, 10, 8), color: 0x4aa8ff },
  roller: { geom: () => new THREE.DodecahedronGeometry(0.32, 1), color: 0x9a8a70 },
  shard: { geom: () => cyl(0.02, 0.28), color: 0xd8f0ff },
  lightbolt: { geom: () => new THREE.SphereGeometry(0.07, 8, 6), color: 0xffe38a },
  arcane: { geom: () => new THREE.OctahedronGeometry(0.11, 0), color: 0xc08aff },
  ballista: { geom: () => cyl(0.05, 1.1), color: 0x6a5038 },
};
const KIND_STYLE = {
  arrow: 'shaft', piercing: 'pierce', bolt: 'bolt', apbolt: 'apbolt',
  orb: 'orb', fireball: 'fireball', flask: 'flask', bomb: 'bomb',
  firebolt: 'firebolt', boulder: 'boulder', gust: 'gust', waterbolt: 'waterbolt',
  roller: 'roller', shard: 'shard', lightbolt: 'lightbolt', arcane: 'arcane', ballista: 'ballista',
};

function cyl(r, len) {
  const g = new THREE.CylinderGeometry(r, r, len, 5);
  g.rotateX(Math.PI / 2);
  return g;
}

export class ProjectileView {
  constructor(scene, maxPerStyle = 400) {
    this.meshes = {};
    for (const [key, st] of Object.entries(STYLES)) {
      const m = new THREE.InstancedMesh(st.geom(), new THREE.MeshBasicMaterial({ color: st.color }), maxPerStyle);
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      this.meshes[key] = m;
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._d = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._fwd = new THREE.Vector3(0, 0, 1);
    this.counts = {};
  }

  sync(projectiles) {
    for (const k of Object.keys(this.meshes)) this.counts[k] = 0;
    for (const p of projectiles) {
      const style = KIND_STYLE[p.kind] ?? 'shaft';
      const mesh = this.meshes[style];
      const i = this.counts[style];
      if (i >= mesh.instanceMatrix.count) continue;
      this.counts[style] = i + 1;
      this._d.set(p.dx, p.dy, p.dz);
      if (this._d.lengthSq() < 1e-6) this._d.set(0, 0, 1);
      this._q.setFromUnitVectors(this._fwd, this._d.normalize());
      this._m.compose(this._p.set(p.x, p.y, p.z), this._q, this._one);
      mesh.setMatrixAt(i, this._m);
    }
    for (const [k, mesh] of Object.entries(this.meshes)) {
      mesh.count = this.counts[k];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
