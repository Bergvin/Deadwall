// Spell and ability visuals: expanding rings, ground zones (napalm, plague clouds, banana
// peels) and a glowing ring under buffed towers. Pooled meshes, updated each frame.
import * as THREE from 'three';

export const FX_COLORS = {
  fire: 0xff7a20, frost: 0x8fd8ff, arcane: 0xb57aff, poison: 0x7cff5a, explosion: 0xffa040,
  bash: 0xf0e6d0, rally: 0xffc23d, holy: 0xffe08a, bolt: 0xc8b8a0, hit: 0xc8b8a0, level: 0xffd23d,
  plague: 0x5aa020, earth: 0xa07848, wind: 0xd8fff0, water: 0x4aa8ff,
  banana: 0xffe040, gale: 0xd8fff0, boulder: 0xa07848, arrow: 0xd8c8a0, roller: 0xb8a888, spell: 0x7cff9a,
  alchemist: 0x7cff5a, tesla: 0x9fe8ff, watchtower: 0xffe38a, ballista: 0xc8a070,
};

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'fx';
    scene.add(this.root);
    this.ringGeom = new THREE.RingGeometry(0.85, 1, 48);
    this.ringGeom.rotateX(-Math.PI / 2);
    this.discGeom = new THREE.CircleGeometry(1, 40);
    this.discGeom.rotateX(-Math.PI / 2);
    this.rings = []; // {mesh, age, life, radius}
    this.ringPool = [];
    this.zoneMeshes = new Map(); // zone id -> mesh
    this.buffMeshes = [];
  }

  #ringMesh() {
    const m = this.ringPool.pop() ?? new THREE.Mesh(this.ringGeom, new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    this.root.add(m);
    return m;
  }

  /** Expanding ring at ground level. */
  ring(x, z, radius, color, life = 0.5, y = 0.08) {
    const mesh = this.#ringMesh();
    mesh.material.color.set(color);
    mesh.position.set(x, y, z);
    this.rings.push({ mesh, age: 0, life, radius });
  }

  update(dt, time, zones, towers) {
    // Rings grow from 20% to full radius and fade out.
    let w = 0;
    for (const r of this.rings) {
      r.age += dt;
      if (r.age >= r.life) { this.root.remove(r.mesh); this.ringPool.push(r.mesh); continue; }
      const k = r.age / r.life;
      const s = r.radius * (0.2 + 0.8 * Math.sqrt(k));
      r.mesh.scale.set(s, 1, s);
      r.mesh.material.opacity = 1 - k;
      this.rings[w++] = r;
    }
    this.rings.length = w;

    // Zones: one translucent disc per live zone, gently pulsing.
    const live = new Set();
    for (const zn of zones) {
      // Zones and hazard puddles have separate id sequences, so key by kind too.
      const key = zn.kind + zn.id;
      live.add(key);
      let m = this.zoneMeshes.get(key);
      if (!m) {
        m = new THREE.Mesh(this.discGeom, new THREE.MeshBasicMaterial({
          color: FX_COLORS[zn.kind] ?? 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        m.position.set(zn.x, 0.05, zn.z);
        this.root.add(m);
        this.zoneMeshes.set(key, m);
      }
      const fadeIn = Math.min(1, zn.age / 0.3), fadeOut = Math.min(1, (zn.duration - zn.age) / 0.6);
      m.scale.set(zn.radius, 1, zn.radius);
      m.material.opacity = 0.32 * Math.min(fadeIn, fadeOut) * (0.85 + 0.15 * Math.sin(time * 6 + zn.id));
    }
    for (const [id, m] of this.zoneMeshes) {
      if (!live.has(id)) { this.root.remove(m); m.material.dispose(); this.zoneMeshes.delete(id); }
    }

    // Buffed towers: a glowing ring at their foot (colour by strongest buff).
    let i = 0;
    for (const t of towers) {
      const buff = t.buffs.find((b) => b.until > time);
      if (!buff) continue;
      let m = this.buffMeshes[i];
      if (!m) {
        m = new THREE.Mesh(this.ringGeom, new THREE.MeshBasicMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }));
        this.root.add(m);
        this.buffMeshes[i] = m;
      }
      m.visible = true;
      m.material.color.set(buff.freeAmmo ? 0x7fd8ff : buff.damagePct ? 0xff7a40 : buff.critAdd ? 0xffe060 : buff.rangeAdd ? 0xb8a0ff : FX_COLORS.spell);
      m.material.opacity = 0.55 + 0.25 * Math.sin(time * 6);
      m.position.set(t.cx, 0.1, t.cz);
      m.scale.set(0.62, 1, 0.62);
      i++;
    }
    for (; i < this.buffMeshes.length; i++) this.buffMeshes[i].visible = false;
  }

  clear() {
    for (const r of this.rings) { this.root.remove(r.mesh); this.ringPool.push(r.mesh); }
    this.rings.length = 0;
    for (const m of this.zoneMeshes.values()) { this.root.remove(m); m.material.dispose(); }
    this.zoneMeshes.clear();
    for (const m of this.buffMeshes) m.visible = false;
  }
}
