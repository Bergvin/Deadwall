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

    /** model:valid -> pooled ghost objects */
    this.ghosts = {};

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

  /** Highlights a cell, or a size x size block whose top-left is (x, y). */
  setHover(cell) {
    this.hover.visible = !!cell;
    if (!cell) return;
    const s = cell.size ?? 1;
    this.hover.position.set(cell.x + s / 2, 0.03, cell.y + s / 2);
    this.hover.scale.set(s, s, 1);
  }

  /** Selection box around a cell, or around a size x size block (the champion's 2x2). */
  setSelection(cell) {
    this.selection.visible = !!cell;
    if (!cell) return;
    const s = cell.size ?? 1;
    this.selection.position.set(cell.x + s / 2, 0.725, cell.y + s / 2);
    this.selection.scale.set(s, 1, s);
  }

  /**
   * Shows placement ghosts; pass [] to hide them all. Ghost objects are pooled per
   * model and validity, so dragging a long line does not allocate every frame.
   * @param {{cell:{x:number,y:number}, model:string, rot:number, scaleY?:number, valid:boolean}[]} items
   */
  setGhosts(items) {
    const used = {};
    for (const { cell, model, rot, scaleY = 1, valid } of items) {
      const key = `${model}:${valid}`;
      const pool = (this.ghosts[key] ??= []);
      const i = (used[key] = (used[key] ?? 0) + 1) - 1;
      if (!pool[i]) {
        pool[i] = this.#makeGhost(model, valid ? COLORS.valid : COLORS.invalid);
        this.root.add(pool[i]);
      }
      const g = pool[i];
      g.visible = true;
      g.position.set(cell.x + 0.5, 0, cell.y + 0.5);
      g.rotation.y = rot;
      g.scale.y = scaleY;
    }
    for (const [key, pool] of Object.entries(this.ghosts)) {
      for (let i = used[key] ?? 0; i < pool.length; i++) pool[i].visible = false;
    }
  }

  /** Hero-slot markers on wall tops while deploying. @param {{x,y,free:boolean}[]} items */
  setHeroSlots(items) {
    this.slots ??= [];
    items.forEach((it, i) => {
      if (!this.slots[i]) {
        const m = new THREE.Mesh(
          new THREE.RingGeometry(0.22, 0.32, 20),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthTest: false }),
        );
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 12;
        this.root.add(m);
        this.slots[i] = m;
      }
      const m = this.slots[i];
      m.visible = true;
      m.material.color.set(it.free ? COLORS.valid : COLORS.invalid);
      m.position.set(it.x + 0.5, 1.22, it.y + 0.5);
    });
    for (let i = items.length; i < this.slots.length; i++) this.slots[i].visible = false;
  }

  /**
   * Ability targeting preview: a ring showing the hero's reach and a disc for the effect
   * area at the cursor (green = valid, red = invalid). Pass null to hide.
   * @param {{reachCenter:{x,z}, reach:number, at?:{x,z}, radius?:number, valid:boolean}|null} p
   */
  setAbilityPreview(p) {
    if (!this.abilityReach) {
      const ring = new THREE.RingGeometry(0.97, 1, 64);
      ring.rotateX(-Math.PI / 2);
      this.abilityReach = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({
        color: 0xf0e6c8, transparent: true, opacity: 0.55, depthTest: false,
      }));
      const disc = new THREE.CircleGeometry(1, 48);
      disc.rotateX(-Math.PI / 2);
      this.abilityArea = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.28, depthTest: false, depthWrite: false,
      }));
      this.abilityReach.renderOrder = this.abilityArea.renderOrder = 13;
      this.root.add(this.abilityReach, this.abilityArea);
    }
    this.abilityReach.visible = !!p;
    this.abilityArea.visible = !!p?.at;
    if (!p) return;
    this.abilityReach.position.set(p.reachCenter.x, 0.07, p.reachCenter.z);
    this.abilityReach.scale.setScalar(p.reach);
    if (p.at) {
      const r = Math.max(0.35, p.radius ?? 0.35);
      this.abilityArea.position.set(p.at.x, 0.08, p.at.z);
      this.abilityArea.scale.set(r, 1, r);
      this.abilityArea.material.color.set(p.valid ? COLORS.valid : COLORS.invalid);
    }
  }

  /** Hides every transient marker (used when a run ends). */
  reset() {
    this.setAbilityPreview(null);
    this.setGhosts([]);
    this.setHeroSlots([]);
    this.setHover(null);
    this.setSelection(null);
    this.setGridVisible(false);
    this.setPath(null);
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
