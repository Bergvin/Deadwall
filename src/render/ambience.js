// Atmosphere: procedural ground texture, flickering torches, rising embers, drifting fog
// wisps and a pulsing glow over the zombie spawn. Purely visual; runs on real time.
import * as THREE from 'three';

/**
 * Paints the battlefield ground: dark earth with mottled patches, moss, scattered stones
 * and a worn dirt road from the north toward the gate. The texture spans the whole ground
 * plane (map plus margin) so it needs no tiling.
 * @param {{width:number,height:number,gateX:number,castleWallRow:number}} map
 * @param {number} margin  extra world units of ground on each side
 */
export function makeGroundTexture(map, margin) {
  const W = map.width + margin * 2, H = map.height + margin * 2;
  const ppu = 24; // pixels per world unit
  const cv = document.createElement('canvas');
  cv.width = Math.min(2048, W * ppu);
  cv.height = Math.min(2048, H * ppu);
  const sx = cv.width / W, sy = cv.height / H;
  const g = cv.getContext('2d');
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  g.fillStyle = '#2b2922';
  g.fillRect(0, 0, cv.width, cv.height);
  const blob = (x, y, r, color, alpha) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color.replace('A', alpha));
    grd.addColorStop(1, color.replace('A', 0));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  // Mottled earth and moss.
  for (let i = 0; i < 420; i++) blob(rnd() * cv.width, rnd() * cv.height, (0.6 + rnd() * 2.6) * sx, 'rgba(18,16,12,A)', 0.35);
  for (let i = 0; i < 260; i++) blob(rnd() * cv.width, rnd() * cv.height, (0.5 + rnd() * 2) * sx, 'rgba(70,62,46,A)', 0.25);
  for (let i = 0; i < 140; i++) blob(rnd() * cv.width, rnd() * cv.height, (0.4 + rnd() * 1.6) * sx, 'rgba(48,62,34,A)', 0.3);

  // Dirt road: a wavering band from the north edge to the gate.
  const gx = (map.gateX + 0.5 + margin) * sx;
  const top = margin * sy * 0.4, bottom = (map.castleWallRow + margin) * sy;
  for (let y = top; y < bottom; y += 3) {
    const t = (y - top) / (bottom - top);
    const x = gx + Math.sin(t * 5.2) * 3.2 * sx * (1 - t * 0.8);
    const w = (1.3 + 0.4 * Math.sin(t * 17)) * sx;
    g.fillStyle = 'rgba(78,64,46,0.16)';
    g.fillRect(x - w, y, w * 2, 3);
  }
  // Pebbles and grit.
  for (let i = 0; i < 2600; i++) {
    const v = 40 + Math.floor(rnd() * 50);
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.25 + rnd() * 0.35})`;
    const s = 1 + rnd() * 2.2;
    g.fillRect(rnd() * cv.width, rnd() * cv.height, s, s);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function softDiscTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

export class Ambience {
  /**
   * @param {THREE.Scene} scene
   * @param {{lights: THREE.PointLight[], emitters: {x,y,z}[]}} world
   * @param {{width:number,height:number,spawnRows:number}} map
   */
  constructor(scene, world, map) {
    this.time = 0;
    this.lights = world.lights.map((l) => ({ light: l, base: l.intensity, phase: Math.random() * 100 }));
    const disc = softDiscTexture();

    // Embers rising from braziers and torches.
    this.emitters = world.emitters;
    this.maxEmbers = 160;
    this.embers = [];
    const pos = new Float32Array(this.maxEmbers * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.emberPoints = new THREE.Points(geom, new THREE.PointsMaterial({
      color: 0xff9a40, size: 0.09, map: disc, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.emberPoints.frustumCulled = false;
    scene.add(this.emberPoints);

    // Fog wisps drifting over the battlefield (denser in the north).
    this.wisps = [];
    const fogMat = new THREE.MeshBasicMaterial({
      map: disc, color: 0x9aa0a8, transparent: true, opacity: 0.08, depthWrite: false,
    });
    for (let i = 0; i < 22; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fogMat);
      m.rotation.x = -Math.PI / 2;
      const s = 4 + Math.random() * 6;
      m.scale.set(s, s * 0.6, 1);
      m.position.set(Math.random() * map.width, 0.25 + Math.random() * 0.6, Math.random() * map.height * 0.75);
      m.renderOrder = 2;
      scene.add(m);
      this.wisps.push({ m, vx: 0.15 + Math.random() * 0.25, w: map.width });
    }

    // Blood-red glow over the spawn zone.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(map.width + 4, map.spawnRows + 3),
      new THREE.MeshBasicMaterial({ color: 0xa0201a, map: disc, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(map.width / 2, 0.04, map.spawnRows / 2);
    scene.add(glow);
    this.glow = glow;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    for (const l of this.lights) {
      // Layered sines give an irregular flame flicker.
      const f = 0.82 + 0.1 * Math.sin(t * 9 + l.phase) + 0.08 * Math.sin(t * 23 + l.phase * 3);
      l.light.intensity = l.base * f;
    }
    // Spawn new embers.
    if (this.emitters.length && this.embers.length < this.maxEmbers && Math.random() < dt * 40) {
      const e = this.emitters[Math.floor(Math.random() * this.emitters.length)];
      this.embers.push({
        x: e.x + (Math.random() - 0.5) * 0.3, y: e.y, z: e.z + (Math.random() - 0.5) * 0.3,
        vx: (Math.random() - 0.5) * 0.3, vy: 0.6 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.3,
        life: 1.2 + Math.random() * 1.4, age: 0,
      });
    }
    const pos = this.emberPoints.geometry.attributes.position;
    let w = 0;
    for (const e of this.embers) {
      e.age += dt;
      if (e.age >= e.life) continue;
      e.x += (e.vx + Math.sin(t * 3 + e.life * 10) * 0.2) * dt;
      e.y += e.vy * dt;
      e.z += e.vz * dt;
      pos.setXYZ(w, e.x, e.y, e.z);
      this.embers[w++] = e;
    }
    this.embers.length = w;
    this.emberPoints.geometry.setDrawRange(0, w);
    pos.needsUpdate = true;

    for (const s of this.wisps) {
      s.m.position.x += s.vx * dt;
      if (s.m.position.x > s.w + 6) s.m.position.x = -6;
    }
    this.glow.material.opacity = 0.32 + 0.1 * Math.sin(t * 1.3);
  }
}
