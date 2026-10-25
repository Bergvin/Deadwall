// Lightweight particle bursts (dust, debris, blood) on one instanced mesh.
import * as THREE from 'three';

export class Effects {
  constructor(scene, max = 1500) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      max,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
    this.parts = [];
    this.max = max;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /**
   * @param {{x:number,y:number,z:number}} at
   * @param {{count?:number, color?:number, size?:number, speed?:number, up?:number, life?:number, spread?:number}} o
   */
  burst(at, { count = 10, color = 0x8a8070, size = 0.08, speed = 1.5, up = 2, life = 0.8, spread = 0.3 } = {}) {
    for (let i = 0; i < count; i++) {
      if (this.parts.length >= this.max) this.parts.shift();
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.parts.push({
        x: at.x + (Math.random() - 0.5) * spread, y: at.y + Math.random() * spread, z: at.z + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * v, vy: up * (0.5 + Math.random() * 0.8), vz: Math.sin(a) * v,
        rx: Math.random() * 6, ry: Math.random() * 6,
        size: size * (0.6 + Math.random() * 0.8), color, life, age: 0,
      });
    }
  }

  update(dt) {
    let i = 0, write = 0;
    for (const p of this.parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      this.parts[write++] = p;
      p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.03) { p.y = 0.03; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.rx += dt * 5; p.ry += dt * 4;
      const k = p.size * (1 - (p.age / p.life) ** 2);
      this._q.setFromEuler(this._e.set(p.rx, p.ry, 0));
      this._m.compose(this._p.set(p.x, p.y, p.z), this._q, this._s.set(k, k, k));
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, this._c.set(p.color));
      i++;
    }
    this.parts.length = write;
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.parts.length = 0;
    this.mesh.count = 0;
  }
}
