// Marks breached wall sections: rubble where the wall stood and a pulsing red ring so the
// player sees at a glance where the defence is open. Synced from WallSystem.breachCells().
import * as THREE from 'three';

export class BreachView {
  /** "x,y" -> { rubble, ring } */
  #marks = new Map();

  constructor(scene, assets) {
    this.assets = assets;
    this.root = new THREE.Group();
    this.root.name = 'breaches';
    scene.add(this.root);
    const ring = new THREE.RingGeometry(0.38, 0.5, 32);
    ring.rotateX(-Math.PI / 2);
    this.ringGeom = ring;
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3020, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.time = 0;
  }

  update(dt, cells) {
    this.time += dt;
    const live = new Set();
    for (const c of cells) {
      const key = `${c.x},${c.y}`;
      live.add(key);
      if (this.#marks.has(key)) continue;
      const rubble = this.assets.instance('debris');
      rubble.position.set(c.x + 0.5, 0, c.y + 0.5);
      rubble.rotation.y = ((c.x * 7 + c.y * 13) % 4) * Math.PI / 2;
      const ring = new THREE.Mesh(this.ringGeom, this.ringMat);
      ring.position.set(c.x + 0.5, 0.06, c.y + 0.5);
      ring.renderOrder = 9;
      this.root.add(rubble, ring);
      this.#marks.set(key, { rubble, ring });
    }
    for (const [key, m] of this.#marks) {
      if (live.has(key)) continue;
      this.root.remove(m.rubble, m.ring);
      this.#marks.delete(key);
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
    this.ringMat.opacity = 0.35 + 0.45 * pulse;
    for (const m of this.#marks.values()) m.ring.scale.setScalar(1 + 0.25 * pulse);
  }

  clear() {
    for (const m of this.#marks.values()) this.root.remove(m.rubble, m.ring);
    this.#marks.clear();
  }
}
