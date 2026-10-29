// Atmosphere: procedural ground texture, flickering torches, rising embers, drifting fog
// wisps and a pulsing glow over the zombie spawn. Purely visual; runs on real time.
import * as THREE from 'three';

/**
 * Paints one map's ground: dark earth with mottled patches, moss and stones, worn dirt roads
 * along the zombie paths and dark water in the river cells. The texture spans the whole
 * ground plane (map plus margin) so it needs no tiling.
 * @param {{width:number,height:number}} size
 * @param {{points:{x,z}[]}[]} paths road polylines (world units)
 * @param {{x:number,y:number}[]} water river cells
 * @param {number} margin  extra world units of ground on each side
 */
export function makeGroundTexture(size, paths, water, margin) {
  const W = size.width + margin * 2, H = size.height + margin * 2;
  const ppu = 24; // pixels per world unit
  const cv = document.createElement('canvas');
  cv.width = Math.min(2048, W * ppu);
  cv.height = Math.min(2048, H * ppu);
  const sx = cv.width / W, sy = cv.height / H;
  const X = (x) => (x + margin) * sx, Y = (z) => (z + margin) * sy;
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
  for (let i = 0; i < 420; i++) blob(rnd() * cv.width, rnd() * cv.height, (0.6 + rnd() * 2.6) * sx, 'rgba(18,16,12,A)', 0.35);
  for (let i = 0; i < 260; i++) blob(rnd() * cv.width, rnd() * cv.height, (0.5 + rnd() * 2) * sx, 'rgba(70,62,46,A)', 0.25);
  for (let i = 0; i < 140; i++) blob(rnd() * cv.width, rnd() * cv.height, (0.4 + rnd() * 1.6) * sx, 'rgba(48,62,34,A)', 0.3);

  // Water: dark, slightly blue cells with soft edges.
  for (const c of water) {
    g.fillStyle = 'rgba(18,34,46,0.95)';
    g.fillRect(X(c.x) - 1, Y(c.y) - 1, sx + 2, sy + 2);
  }
  for (const c of water) blob(X(c.x + 0.5), Y(c.y + 0.5), sx * 0.9, 'rgba(60,110,140,A)', 0.18);

  // Roads: a wide dark rim, the packed dirt, then wheel ruts and grit on top.
  const stroke = (width, style) => {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.lineWidth = width * sx;
    g.strokeStyle = style;
    for (const p of paths) {
      g.beginPath();
      p.points.forEach((q, i) => (i ? g.lineTo(X(q.x), Y(q.z)) : g.moveTo(X(q.x), Y(q.z))));
      g.stroke();
    }
  };
  stroke(2.3, 'rgba(30,24,18,0.55)');
  stroke(1.8, 'rgba(92,74,52,0.85)');
  stroke(1.2, 'rgba(110,90,64,0.55)');
  stroke(0.12, 'rgba(60,46,32,0.6)');
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
   * @param {{width:number,height:number}} map
   * @param {{x:number,z:number}[]} spawns road starts (a red glow where the dead come from)
   */
  constructor(scene, world, map, spawns = []) {
    this.scene = scene;
    this.objects = [];
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
    this.objects.push(this.emberPoints);

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
      this.objects.push(m);
      this.wisps.push({ m, vx: 0.15 + Math.random() * 0.25, w: map.width });
    }

    // Blood-red glow where each road enters the map.
    this.glows = [];
    for (const sp of spawns) {
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 5),
        new THREE.MeshBasicMaterial({ color: 0xa0201a, map: disc, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(Math.min(map.width - 0.5, Math.max(0.5, sp.x)), 0.04, Math.min(map.height - 0.5, Math.max(0.5, sp.z)));
      scene.add(glow);
      this.objects.push(glow);
      this.glows.push(glow);
    }
  }

  dispose() {
    for (const o of this.objects) this.scene.remove(o);
    this.objects.length = 0;
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
    for (const gl of this.glows) gl.material.opacity = 0.32 + 0.1 * Math.sin(t * 1.3);
  }
}
