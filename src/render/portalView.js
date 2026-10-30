// Portals where the dead come out: one at the start of every road. Two Kenney stone
// pillars hold a swirling, glowing gate that faces down the road. A road that opens in a
// later wave keeps its portal dormant (dim, closed) until then; it tears open when its first
// wave starts. Every zombie that comes through makes its portal flare.
import * as THREE from 'three';
import { pointAt } from '../core/paths.js';

const COLOR = { swirl: 0xc0281e, core: 0xff7a3a, light: 0xd02818 };

/** Canvas texture with spiral arms fading outwards (drawn once, shared by every portal). */
function swirlTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2) / (size / 2), dy = (y - size / 2) / (size / 2);
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const arms = 0.5 + 0.5 * Math.sin(a * 3 + r * 9);
      const fade = Math.max(0, 1 - r) ** 0.7;
      const v = Math.min(1, (0.35 + 0.65 * arms) * fade + Math.max(0, 0.35 - r) * 1.6);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(v * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class PortalView {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./assets.js').AssetLibrary} assets
   * @param {import('../core/simulation.js').Simulation} sim
   * @param {{portalS:number, portal:{width:number, height:number}}} rules MAP_RULES
   */
  constructor(scene, assets, sim, rules) {
    this.scene = scene;
    this.sim = sim;
    this.time = 0;
    this.texture = swirlTexture();
    this.root = new THREE.Group();
    this.root.name = 'portals';
    scene.add(this.root);
    const { width, height } = rules.portal;
    this.portals = sim.paths.map((path) => {
      const p = pointAt(path, rules.portalS);
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      // The gate's face looks down the road (local +z = road direction).
      g.rotation.y = Math.atan2(p.dx, p.dz);
      for (const side of [-1, 1]) {
        const pillar = assets.instance('wallPillar');
        // The pillar is 1.31 tall: stretch it a little above the gate.
        pillar.scale.set(0.45, 1.75, 0.45);
        pillar.position.set(side * (width / 2 + 0.2), 0, 0);
        g.add(pillar);
      }
      const mat = (color, opacity) => new THREE.MeshBasicMaterial({
        map: this.texture, color, transparent: true, opacity, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      // Outer swirl and a smaller, faster core turning the other way.
      const outer = new THREE.Mesh(new THREE.CircleGeometry(0.5, 40), mat(COLOR.swirl, 0.95));
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.5, 40), mat(COLOR.core, 0.8));
      const disc = new THREE.Group();
      disc.add(outer, inner);
      disc.position.y = height / 2 + 0.05;
      g.add(disc);
      const light = new THREE.PointLight(COLOR.light, 0, 6, 1.6);
      light.position.set(0, height / 2, 0.4);
      g.add(light);
      this.root.add(g);
      return { path, group: g, disc, outer, inner, light, open: 0, flare: 0, phase: Math.random() * 10, width, height };
    });
    this.unsub = sim.events.on('zombieSpawned', (z) => {
      const portal = this.portals.find((p) => p.path.id === z.pathId);
      if (portal) portal.flare = Math.min(1.5, portal.flare + (z.boss ? 1.5 : 0.5));
    });
  }

  /** @param {number} dt real seconds */
  update(dt) {
    this.time += dt;
    const t = this.time;
    // A road's portal is open from the wave it is first used (`from`); the next wave's new
    // roads already start to stir during the preparation before it.
    const waves = this.sim.waves;
    const n = Math.max(1, waves.wave);
    for (const p of this.portals) {
      const target = n >= p.path.from ? 1 : waves.nextWave >= p.path.from ? 0.3 : 0.08;
      p.open += (target - p.open) * Math.min(1, dt * 2.5);
      p.flare = Math.max(0, p.flare - dt * 2.5);
      const pulse = 1 + 0.05 * Math.sin(t * 3 + p.phase) + p.flare * 0.12;
      const sx = p.width * p.open * pulse, sy = p.height * p.open * pulse;
      p.disc.scale.set(sx, sy, 1);
      p.disc.visible = p.open > 0.02;
      p.outer.rotation.z = t * 1.6 + p.phase;
      p.inner.rotation.z = -t * 3.1 + p.phase;
      p.inner.scale.setScalar(0.55 + 0.1 * Math.sin(t * 5 + p.phase) + p.flare * 0.15);
      p.light.intensity = (3 + 2 * Math.sin(t * 4 + p.phase) + p.flare * 6) * p.open;
    }
  }

  dispose() {
    this.unsub?.();
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'CircleGeometry') { o.geometry.dispose(); o.material.dispose(); }
    });
    this.texture.dispose();
  }
}
