// Camera-facing health bars for many units, drawn as two instanced quads (back + fill).
import * as THREE from 'three';

const W = 0.7, H = 0.08;

export class HealthBars {
  constructor(scene, max = 2000) {
    const geom = new THREE.PlaneGeometry(1, 1);
    const mk = (opacity) => {
      const m = new THREE.InstancedMesh(geom, new THREE.MeshBasicMaterial({
        transparent: true, opacity, depthTest: false, depthWrite: false, fog: false,
      }), max);
      m.frustumCulled = false;
      m.renderOrder = 20;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    };
    this.back = mk(0.75);
    this.fill = mk(1);
    this.back.renderOrder = 20;
    this.fill.renderOrder = 21;
    this.max = max;
    this.n = 0;
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._c = new THREE.Color();
    this.back.setColorAt(0, new THREE.Color(0x1a1412)); // allocate instanceColor
    this.fill.setColorAt(0, new THREE.Color(0xffffff));
  }

  begin(camera) {
    this.n = 0;
    this.q = camera.quaternion;
    this._right.set(1, 0, 0).applyQuaternion(this.q);
  }

  /** Adds a bar above world point (x, y, z). ratio in [0, 1]. */
  add(x, y, z, ratio, color, width = W) {
    if (this.n >= this.max) return;
    const i = this.n++;
    ratio = Math.max(0, Math.min(1, ratio));
    this._p.set(x, y, z);
    this._m.compose(this._p, this.q, this._s.set(width + 0.04, H + 0.04, 1));
    this.back.setMatrixAt(i, this._m);
    this.back.setColorAt(i, this._c.set(0x1a1412));
    // Left-align the fill by shifting its centre along the camera's right vector.
    this._p.addScaledVector(this._right, -(1 - ratio) * width / 2);
    this._m.compose(this._p, this.q, this._s.set(Math.max(0.001, width * ratio), H, 1));
    this.fill.setMatrixAt(i, this._m);
    this.fill.setColorAt(i, this._c.set(color));
  }

  end() {
    for (const m of [this.back, this.fill]) {
      m.count = this.n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

/** Green -> yellow -> red by health ratio. */
export function healthColor(ratio) {
  if (ratio > 0.6) return 0x5fbf5a;
  if (ratio > 0.3) return 0xe8b64c;
  return 0xd0453a;
}
