// Mouse/keyboard interaction with the battlefield: hover, selection, wall placement,
// right-drag panning and cancel. Listeners for presses are on the canvas only, so clicks
// on HUD elements never reach the battlefield.
//
// Wall placement: press marks the start cell, dragging previews a straight line (locked
// to the dominant axis), releasing builds it. Nothing is built until release, so hand
// wobble during the drag cannot leave stray walls or corners behind.
import * as THREE from 'three';
import { pieceFor } from '../render/wallView.js';
import { DIR } from '../core/walls.js';

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
    this.placing = null; // { anchor: cell, end: cell } while the left button is held in build mode
    this.drag = null; // { x, y, moved, button } for right/middle-drag panning
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
    this.placing = null;
    this.overlay.setGridVisible(true);
    this.hud.setMode(this.mode);
    this.#refreshHover();
  }

  cancel() {
    if (this.placing) {
      this.placing = null; // abort the current line, stay in build mode
    } else if (this.mode.kind === 'build') {
      this.mode = { kind: 'select' };
      this.overlay.setGridVisible(false);
      this.hud.setMode(this.mode);
    } else {
      this.select(0);
    }
    this.#refreshHover();
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

  // --- placement planning ----------------------------------------------
  /**
   * Cells the current placement would build, each with validity. Gold is checked
   * cumulatively, so cells beyond what the player can afford show as invalid.
   */
  plan() {
    if (this.mode.kind !== 'build') return [];
    const start = this.placing?.anchor ?? this.hoverCell;
    if (!start) return [];
    const end = this.placing ? axisLock(start, this.placing.end) : start;
    const cost = this.walls.types[this.mode.wallType].cost;
    let gold = this.walls.economy.gold;
    return lineCells(start, end).map((cell) => {
      const check = this.walls.canBuild(this.mode.wallType, cell.x, cell.y);
      let reason = check.ok ? null : check.reason;
      if (!reason && gold < cost) reason = 'insufficient_gold';
      if (!reason) gold -= cost;
      return { cell, valid: !reason, reason };
    });
  }

  #commitPlacement() {
    const plan = this.plan();
    this.placing = null;
    let built = 0;
    for (const p of plan) if (p.valid && this.walls.build(this.mode.wallType, p.cell.x, p.cell.y)) built++;
    const firstFail = plan.find((p) => !p.valid);
    // A single click explains its failure; a line only reports running out of gold.
    if (firstFail && (plan.length === 1 || firstFail.reason === 'insufficient_gold')) {
      this.hud.toast(REJECT_TEXT[firstFail.reason] ?? 'Cannot build');
    }
    this.#refreshHover();
    return built;
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
      if (!cell) return;
      this.placing = { anchor: cell, end: cell };
      this.#refreshHover();
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
    if (this.placing && cell) this.placing.end = cell;
    if (cell?.x !== this.hoverCell?.x || cell?.y !== this.hoverCell?.y || this.mode.kind === 'select') {
      this.hoverCell = cell;
      this.#refreshHover();
    }
  }

  #onUp(e) {
    if (e.button === 0 && this.placing) this.#commitPlacement();
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

  #refreshHover() {
    const cell = this.hoverCell;
    if (this.mode.kind === 'build') {
      this.overlay.setHover(null);
      const plan = this.plan();
      // Pick each ghost's piece as if the planned walls already existed, so the preview
      // shows the corners and straights the line will really get.
      const planned = new Set(plan.map((p) => `${p.cell.x},${p.cell.y}`));
      const g = this.walls.grid;
      const has = (x, y) => g.wallAt(x, y) || planned.has(`${x},${y}`);
      this.overlay.setGhosts(plan.map(({ cell: c, valid }) => {
        const mask = (has(c.x, c.y - 1) ? DIR.N : 0) | (has(c.x + 1, c.y) ? DIR.E : 0)
          | (has(c.x, c.y + 1) ? DIR.S : 0) | (has(c.x - 1, c.y) ? DIR.W : 0);
        const [model, rot, scaleY] = pieceFor(mask);
        return { cell: c, model, rot, scaleY, valid };
      }));
      const ok = plan.filter((p) => p.valid).length;
      this.hud.setPlan(this.placing && plan.length > 1
        ? { count: ok, cost: ok * this.walls.types[this.mode.wallType].cost, blocked: plan.length - ok }
        : null);
      this.canvas.style.cursor = plan.length && plan.every((p) => !p.valid) ? 'not-allowed' : 'crosshair';
    } else {
      this.overlay.setGhosts([]);
      this.hud.setPlan(null);
      const p = this.lastPointer;
      const w = cell && p ? this.wallAt(p.x, p.y) : null;
      this.overlay.setHover(w ? { x: w.x, y: w.y } : cell);
      this.canvas.style.cursor = w ? 'pointer' : 'default';
    }
  }
}

/** Projects `cell` onto the horizontal or vertical line through `anchor`, whichever is closer. */
export function axisLock(anchor, cell) {
  return Math.abs(cell.x - anchor.x) >= Math.abs(cell.y - anchor.y)
    ? { x: cell.x, y: anchor.y }
    : { x: anchor.x, y: cell.y };
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
