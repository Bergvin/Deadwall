// Orthographic isometric-style camera with keyboard/drag panning and cursor-anchored zoom.
import * as THREE from 'three';

export class CameraController {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {typeof import('../config/game.js').CAMERA} cfg
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds  target clamp (world)
   */
  constructor(canvas, cfg, bounds, target) {
    this.canvas = canvas;
    this.cfg = cfg;
    this.bounds = bounds;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
    this.target = target.clone();
    this.viewHeight = cfg.zoom[1];
    this.pitchDeg = cfg.pitchDeg;
    this.yawDeg = cfg.yawDeg;
    this.keys = new Set();
    this.#bind();
    this.update(0);
  }

  #bind() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
    }, { passive: false });
  }

  /** World units per screen pixel (vertical, at the target plane). */
  get unitsPerPixel() {
    return this.viewHeight / this.canvas.clientHeight;
  }

  /** Point on the ground plane (y = 0) under a client-space pixel, or null. */
  groundPoint(clientX, clientY, out = new THREE.Vector3()) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), out);
  }

  /** Zoom by `factor`, keeping the ground point under the cursor fixed. */
  zoomAt(factor, clientX, clientY) {
    const before = this.groundPoint(clientX, clientY);
    const [min, , max] = this.cfg.zoom;
    this.viewHeight = THREE.MathUtils.clamp(this.viewHeight * factor, min, max);
    this.update(0);
    const after = this.groundPoint(clientX, clientY);
    if (before && after) {
      this.target.x += before.x - after.x;
      this.target.z += before.z - after.z;
      this.update(0);
    }
  }

  /** Pan by a screen-space pixel delta (drag). */
  panPixels(dx, dy) {
    const k = this.unitsPerPixel;
    const yaw = THREE.MathUtils.degToRad(this.yawDeg);
    const pitch = THREE.MathUtils.degToRad(this.pitchDeg);
    // Screen-up maps to ground-forward stretched by 1/sin(pitch) under the tilted camera.
    const fx = -dx * k, fz = -dy * k / Math.sin(pitch);
    this.target.x += fx * Math.cos(yaw) + fz * Math.sin(yaw);
    this.target.z += -fx * Math.sin(yaw) + fz * Math.cos(yaw);
    this.update(0);
  }

  update(dt) {
    // Keyboard panning (WASD / arrows), scaled with zoom so speed feels constant on screen.
    let mx = 0, mz = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz += 1;
    if (mx || mz) {
      const speed = this.cfg.panSpeed * (this.viewHeight / this.cfg.zoom[1]) * dt;
      this.target.x += mx * speed;
      this.target.z += mz * speed;
    }
    const b = this.bounds;
    this.target.x = THREE.MathUtils.clamp(this.target.x, b.minX, b.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, b.minZ, b.maxZ);

    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const h = this.viewHeight / 2;
    Object.assign(this.camera, { left: -h * aspect, right: h * aspect, top: h, bottom: -h });
    const yaw = THREE.MathUtils.degToRad(this.yawDeg);
    const pitch = THREE.MathUtils.degToRad(Math.min(this.pitchDeg, 89.9));
    const d = this.cfg.distance;
    this.camera.position.set(
      this.target.x + d * Math.cos(pitch) * Math.sin(yaw),
      d * Math.sin(pitch),
      this.target.z + d * Math.cos(pitch) * Math.cos(yaw),
    );
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }
}
