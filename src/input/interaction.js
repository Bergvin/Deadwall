// Mouse/keyboard interaction with the battlefield: hover, selection, wall placement
// (click or drag to paint), right-drag panning and cancel. Listeners for presses are on
// the canvas only, so clicks on HUD elements never reach the battlefield.
import * as THREE from 'three';
import { pieceFor } from '../render/wallView.js';

const REJECT_TEXT = {
  insufficient_gold: 'Not enough gold',
  not_buildable: 'Cannot build there',
  occupied: 'Cell is occupied',
  out_of_bounds: 'Outside the battlefield',
};

export class Interaction {
  constructor({ canvas, cam, walls, wallView, overlay, hud, events, cameraCfg }) {
    Object.assign(this, { canvas, cam, walls, wallView, overlay, hud, events, cameraCfg });
    this.mode = { kind: 'select' };
    this.selectedWallId = 0;
    this.hoverCell = null;
    this.painting = null; // { last: cell, rejectedGold: bool }
    this.drag = null; // { x, y, moved, button }
    this.raycaster = new THREE.Raycaster();
    this.#bind();
    events.on('wallRemoved', ({ wall }) => {
      if (wall.id === this.selectedWallId) this.select(0);
    });
    events.on('goldChanged', () => this.#refreshHover());
  }

  #bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.#onDown(e));
    addEventListener('pointermove', (e) => this.#onMove(e));
    addEventListener('pointerup', (e) => this.#onUp(e));
    c.addEventListener('pointerleave', () => { this.hoverCell = null; this.#refreshHover(); });
    addEventListener('keydown', (e) => this.#onKey(e));
  }

  // --- modes -----------------------------------------------------------
  enterBuild(wallType) {
    this.select(0);
    this.mode = { kind: 'build', wallType };
    this.overlay.setGridVisible(true);
    this.hud.setMode(this.mode);
    this.#refreshHover();
  }

  cancel() {
    if (this.mode.kind === 'build') {
      this.mode = { kind: 'select' };
      this.overlay.setGridVisible(false);
      this.overlay.setGhost(null, null);
      this.hud.setMode(this.mode);
      this.#refreshHover();
    } else {
      this.select(0);
    }
  }

  select(wallId) {
    this.selectedWallId = wallId;
    const w = this.walls.get(wallId);
    this.overlay.setSelection(w ? { x: w.x, y: w.y } : null);
    this.hud.showWall(w);
  }

  // --- picking ---------------------------------------------------------
  cellAt(clientX, clientY) {
    const p = this.cam.groundPoint(clientX, clientY);
    if (!p) return null;
    const cell = { x: Math.floor(p.x), y: Math.floor(p.z) };
    return this.walls.grid.inBounds(cell.x, cell.y) ? cell : null;
  }

  /** Wall under the cursor, using the 3D meshes so clicking a wall's top selects it. */
  wallAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.cam.camera);
    const hit = this.raycaster.intersectObjects(this.wallView.pickables, true)[0];
    for (let o = hit?.object; o; o = o.parent) {
      if (o.userData.wallId) return this.walls.get(o.userData.wallId);
    }
    return null;
  }

  // --- pointer ---------------------------------------------------------
  #onDown(e) {
    if (e.button === 1 || e.button === 2) {
      this.drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
      return;
    }
    if (e.button !== 0) return;
    if (this.mode.kind === 'build') {
      const cell = this.cellAt(e.clientX, e.clientY);
      this.painting = { last: cell, rejectedGold: false };
      if (cell) this.#tryBuild(cell, true);
    } else {
      const w = this.wallAt(e.clientX, e.clientY);
      this.select(w ? w.id : 0);
    }
  }

  #onMove(e) {
    if (this.drag) {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) >= this.cameraCfg.dragThresholdPx) this.drag.moved = true;
      if (this.drag.moved) {
        this.cam.panPixels(dx, dy);
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
      }
    }
    if (e.target !== this.canvas) {
      if (this.hoverCell) { this.hoverCell = null; this.#refreshHover(); }
      return;
    }
    const cell = this.cellAt(e.clientX, e.clientY);
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (this.painting && cell) {
      // Fill every cell between the previous and current cell so fast drags leave no gaps.
      for (const c of lineCells(this.painting.last ?? cell, cell)) this.#tryBuild(c, false);
      this.painting.last = cell;
    }
    if (cell?.x !== this.hoverCell?.x || cell?.y !== this.hoverCell?.y || this.mode.kind === 'select') {
      this.hoverCell = cell;
      this.#refreshHover();
    }
  }

  #onUp(e) {
    if (e.button === 0) this.painting = null;
    if (this.drag && e.button === this.drag.button) {
      if (!this.drag.moved && this.drag.button === 2) this.cancel();
      this.drag = null;
    }
  }

  #onKey(e) {
    if (e.repeat || e.target instanceof HTMLInputElement) return;
    if (e.code === 'KeyB' || e.code === 'Digit1') this.enterBuild('stone');
    else if (e.code === 'Escape') this.cancel();
    else if ((e.code === 'Delete' || e.code === 'Backspace') && this.selectedWallId) {
      this.walls.sell(this.selectedWallId);
    }
  }

  #tryBuild(cell, isClick) {
    const type = this.mode.wallType;
    const check = this.walls.canBuild(type, cell.x, cell.y);
    if (check.ok) {
      this.walls.build(type, cell.x, cell.y);
      return;
    }
    // Clicks explain every failure; drags only mention running out of gold, once.
    if (isClick || (check.reason === 'insufficient_gold' && !this.painting?.rejectedGold)) {
      this.hud.toast(REJECT_TEXT[check.reason] ?? 'Cannot build');
      if (check.reason === 'insufficient_gold' && this.painting) this.painting.rejectedGold = true;
    }
  }

  #refreshHover() {
    const cell = this.hoverCell;
    if (this.mode.kind === 'build') {
      this.overlay.setHover(null);
      if (!cell) { this.overlay.setGhost(null, null); return; }
      const valid = this.walls.canBuild(this.mode.wallType, cell.x, cell.y).ok;
      // Preview the piece this cell would get given its current neighbours.
      const [model, rot] = pieceFor(this.walls.connectionMask(cell.x, cell.y));
      this.overlay.setGhost(model, cell, valid, rot);
      this.canvas.style.cursor = valid ? 'crosshair' : 'not-allowed';
    } else {
      const p = this.lastPointer;
      const w = cell && p ? this.wallAt(p.x, p.y) : null;
      this.overlay.setHover(w ? { x: w.x, y: w.y } : cell);
      this.canvas.style.cursor = w ? 'pointer' : 'default';
    }
  }
}

/**
 * Grid cells on the line from a to b, inclusive. 4-connected (never steps diagonally),
 * so a painted wall line is always orthogonally joined and has no diagonal gaps.
 */
export function lineCells(a, b) {
  const out = [{ x: a.x, y: a.y }];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
  let ix = 0, iy = 0;
  while (ix < dx || iy < dy) {
    // Step along the axis whose next crossing comes first.
    if ((0.5 + ix) / dx < (0.5 + iy) / dy) { x += sx; ix++; }
    else { y += sy; iy++; }
    out.push({ x, y });
  }
  return out;
}
