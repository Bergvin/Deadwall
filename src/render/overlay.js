// Tactical overlays: build grid, hover/selection markers, placement ghost and path preview.
import * as THREE from 'three';
import { TERRAIN } from '../core/grid.js';

const COLORS = {
  grid: 0x8a8070,
  hover: 0xf0e6c8,
  valid: 0x4cd964,
  invalid: 0xff4a3d,
  selected: 0xffc23d,
  path: 0xd23c3c,
};

export class Overlay {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../core/grid.js').Grid} grid
   * @param {import('./assets.js').AssetLibrary} assets
   */
  constructor(scene, grid, assets) {
    this.grid = grid;
    this.assets = assets;
    this.root = new THREE.Group();
    this.root.name = 'overlay';
    scene.add(this.root);

    this.gridLines = this.#makeGridLines();
    this.gridLines.visible = false;
    this.root.add(this.gridLines);

    this.hover = this.#makeCellQuad(COLORS.hover, 0.18);
    this.selection = this.#makeCellBox(COLORS.selected);
    this.root.add(this.hover, this.selection);
    this.hover.visible = this.selection.visible = false;

    this.ghosts = { valid: null, invalid: null };
    this.ghost = null;

    const pathGeom = new THREE.BufferGeometry();
    pathGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 1024), 3));
    this.path = new THREE.Line(pathGeom, new THREE.LineDashedMaterial({
      color: COLORS.path, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.9, depthTest: false,
    }));
    this.path.renderOrder = 10;
    this.path.visible = false;
    this.root.add(this.path);
  }

  /** Grid lines over buildable cells only. */
  #makeGridLines() {
    const pts = [];
    const g = this.grid;
    const open = (x, y) => g.inBounds(x, y) && g.terrainAt(x, y) === TERRAIN.OPEN;
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        if (!open(x, y)) continue;
        // Top and left edge of every open cell, plus right/bottom where the neighbour is closed.
        pts.push(x, y, x + 1, y, x, y, x, y + 1);
        if (!open(x + 1, y)) pts.push(x + 1, y, x + 1, y + 1);
        if (!open(x, y + 1)) pts.push(x, y + 1, x + 1, y + 1);
      }
    }
    const arr = new Float32Array((pts.length / 2) * 3);
    for (let i = 0, j = 0; i < pts.length; i += 2, j += 3) {
      arr[j] = pts[i]; arr[j + 1] = 0.02; arr[j + 2] = pts[i + 1];
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return new THREE.LineSegments(geom, new THREE.LineBasicMaterial({
      color: COLORS.grid, transparent: true, opacity: 0.35,
    }));
  }

  #makeCellQuad(color, opacity) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.96),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 5;
    return m;
  }

  #makeCellBox(color) {
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.45, 1.04)),
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
    );
    box.renderOrder = 11;
    return box;
  }

  /** Translucent single-colour copy of a model for placement previews. */
  #makeGhost(modelName, color) {
    const g = this.assets.instance(modelName);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
    g.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; } });
    g.renderOrder = 6;
    return g;
  }

  setGridVisible(v) {
    this.gridLines.visible = v;
  }

  setHover(cell) {
    this.hover.visible = !!cell;
    if (cell) this.hover.position.set(cell.x + 0.5, 0.03, cell.y + 0.5);
  }

  setSelection(cell) {
    this.selection.visible = !!cell;
    if (cell) this.selection.position.set(cell.x + 0.5, 0.725, cell.y + 0.5);
  }

  /** Shows the placement ghost at `cell` (or hides it when cell is null). */
  setGhost(modelName, cell, valid, rotY = 0) {
    if (!cell) {
      if (this.ghost) this.ghost.visible = false;
      return;
    }
    const key = `${modelName}:${valid}`;
    if (!this.ghosts[key]) {
      this.ghosts[key] = this.#makeGhost(modelName, valid ? COLORS.valid : COLORS.invalid);
      this.root.add(this.ghosts[key]);
    }
    if (this.ghost && this.ghost !== this.ghosts[key]) this.ghost.visible = false;
    this.ghost = this.ghosts[key];
    this.ghost.visible = true;
    this.ghost.position.set(cell.x + 0.5, 0, cell.y + 0.5);
    this.ghost.rotation.y = rotY;
  }

  /** Draws a path of cells as a dashed line (null hides it). */
  setPath(cells) {
    this.path.visible = !!cells;
    if (!cells) return;
    const attr = this.path.geometry.attributes.position;
    const n = Math.min(cells.length, attr.count);
    for (let i = 0; i < n; i++) attr.setXYZ(i, cells[i].x + 0.5, 0.06, cells[i].y + 0.5);
    attr.needsUpdate = true;
    this.path.geometry.setDrawRange(0, n);
    this.path.computeLineDistances();
  }
}
