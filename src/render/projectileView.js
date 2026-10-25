// Arrows and bolts as one instanced mesh oriented along their direction of travel.
import * as THREE from 'three';

export class ProjectileView {
  constructor(scene, max = 600) {
    const geom = new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4);
    geom.rotateX(Math.PI / 2); // length along +z
    this.mesh = new THREE.InstancedMesh(geom, new THREE.MeshBasicMaterial({ color: 0xe8d8b0 }), max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._d = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._fwd = new THREE.Vector3(0, 0, 1);
  }

  sync(projectiles) {
    let i = 0;
    for (const p of projectiles) {
      if (i >= this.mesh.instanceMatrix.count) break;
      this._d.set(p.dx, p.dy, p.dz);
      this._q.setFromUnitVectors(this._fwd, this._d);
      this._m.compose(this._p.set(p.x, p.y, p.z), this._q, this._one);
      this.mesh.setMatrixAt(i++, this._m);
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
