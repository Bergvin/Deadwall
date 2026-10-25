// Mouse/keyboard interaction with the battlefield: hover, selection (walls and heroes),
// wall placement, hero deployment, right-drag panning and cancel. Press listeners are on
// the canvas only, so clicks on HUD elements never reach the battlefield. All listeners are
// tied to an AbortSignal so a finished run removes them.
//
// Wall placement: press marks the start cell, dragging previews a straight line (locked
// to the dominant axis), releasing builds it. Nothing is built until release, so hand
// wobble during the drag cannot leave stray walls or corners behind.
import * as THREE from 'three';
import { pieceFor } from '../render/wallView.js';
import { DIR } from '../core/walls.js';

export const REJECT_TEXT = {
  insufficient_gold: 'Not enough gold',
  not_buildable: 'Cannot build there',
  occupied: 'Cell is occupied',
  out_of_bounds: 'Outside the battlefield',
  enemy_present: 'Enemies are in the way',
  wall_full: 'That wall has no free hero slot',
  already_there: 'The hero is already there',
  no_wall: 'Pick a wall',
};

export class Interaction {
  /**
   * @param {{canvas, cam, sim, wallView, heroView, overlay, hud, cameraCfg, signal}} deps
   */
  constructor({ canvas, cam, sim, wallView, heroView, overlay, hud, cameraCfg, signal }) {
    Object.assign(this, { canvas, cam, sim, wallView, heroView, overlay, hud, cameraCfg });
    this.walls = sim.walls;
    this.heroes = sim.heroes;
    this.mode = { kind: 'select' };
    this.selection = null; // { kind: 'wall' | 'hero', id }
    this.hoverCell = null;
    this.placing = null;
    this.drag = null;
    this.raycaster = new THREE.Raycaster();
    this.#bind(signal);
    const ev = sim.events;
    ev.on('wallRemoved', ({ wall }) => {
      if (this.selection?.kind === 'wall' && this.selection.id === wall.id) this.select(null);
      this.#refreshHover();
    });
    ev.on('heroDismissed', (h) => {
      if (this.selection?.kind === 'hero' && this.selection.id === h.id) this.select(null);
      if (this.mode.kind === 'deploy' && this.mode.heroId === h.id) this.cancel();
    });
    ev.on('goldChanged', () => this.#refreshHover());
    ev.on('wallAdded', () => this.#refreshHover());
    ev.on('heroDeployed', () => this.#refreshHover());
  }

  #bind(signal) {
    const c = this.canvas;
    const o = { signal };
    c.addEventListener('contextmenu', (e) => e.preventDefault(), o);
    c.addEventListener('pointerdown', (e) => this.#onDown(e), o);
    addEventListener('pointermove', (e) => this.#onMove(e), o);
    addEventListener('pointerup', (e) => this.#onUp(e), o);
    c.addEventListener('pointerleave', () => { this.hoverCell = null; this.#refreshHover(); }, o);
    addEventListener('keydown', (e) => this.#onKey(e), o);
  }

  // --- modes -----------------------------------------------------------
  #setMode(mode) {
    this.mode = mode;
    this.placing = null;
    this.overlay.setGridVisible(mode.kind === 'build');
    this.hud.setMode(mode);
    this.#refreshHover();
  }

  enterBuild(wallType) {
    this.select(null);
    this.#setMode({ kind: 'build', wallType });
  }

  /** Waits for a click on a wall to place (or move) the hero. */
  enterDeploy(heroId) {
    if (!this.heroes.get(heroId)) return;
    this.#setMode({ kind: 'deploy', heroId });
  }

  cancel() {
    if (this.placing) {
      this.placing = null;
      this.#refreshHover();
    } else if (this.mode.kind !== 'select') {
      this.#setMode({ kind: 'select' });
    } else {
      this.select(null);
    }
  }

  select(sel) {
    this.selection = sel;
    const w = sel?.kind === 'wall' ? this.walls.get(sel.id) : null;
    const h = sel?.kind === 'hero' ? this.heroes.get(sel.id) : null;
    const hw = h?.wallId ? this.walls.get(h.wallId) : null;
    const at = w ?? hw;
    this.overlay.setSelection(at ? { x: at.x, y: at.y } : null);
    this.hud.showSelection(sel);
  }

  // --- picking ---------------------------------------------------------
  cellAt(clientX, clientY) {
    const p = this.cam.groundPoint(clientX, clientY);
    if (!p) return null;
    const cell = { x: Math.floor(p.x), y: Math.floor(p.z) };
    return this.walls.grid.inBounds(cell.x, cell.y) ? cell : null;
  }

  #ray(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.cam.camera);
    return this.raycaster;
  }

  /** Wall under the cursor, using the 3D meshes so clicking a wall's top selects it. */
  wallAt(clientX, clientY) {
    // Pieces added since the last frame have stale world matrices; refresh before picking.
    this.wallView.group.updateMatrixWorld();
    const hit = this.#ray(clientX, clientY).intersectObjects(this.wallView.pickables, true)[0];
    for (let o = hit?.object; o; o = o.parent) {
      if (o.userData.wallId) return this.walls.get(o.userData.wallId);
    }
    return null;
  }

  heroAt(clientX, clientY) {
    this.heroView.group.updateMatrixWorld();
    const hit = this.#ray(clientX, clientY).intersectObjects(this.heroView.pickables, false)[0];
    return hit ? this.heroes.get(hit.object.userData.heroId) : null;
  }

  // --- placement planning ----------------------------------------------
  plan() {
    if (this.mode.kind !== 'build') return [];
    const start = this.placing?.anchor ?? this.hoverCell;
    if (!start) return [];
    const end = this.placing ? axisLock(start, this.placing.end) : start;
    const cost = this.walls.costOf(this.mode.wallType);
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
    for (const p of plan) if (p.valid) this.walls.build(this.mode.wallType, p.cell.x, p.cell.y);
    const firstFail = plan.find((p) => !p.valid);
    if (firstFail && (plan.length === 1 || firstFail.reason === 'insufficient_gold')) {
      this.hud.toast(REJECT_TEXT[firstFail.reason] ?? 'Cannot build');
    }
    this.#refreshHover();
  }

  #deployAt(clientX, clientY) {
    const cell = this.cellAt(clientX, clientY);
    const w = this.wallAt(clientX, clientY) ?? (cell ? this.walls.at(cell.x, cell.y) : null);
    const check = w ? this.heroes.canDeploy(this.mode.heroId, w.id) : { ok: false, reason: 'no_wall' };
    if (!check.ok) { this.hud.toast(REJECT_TEXT[check.reason] ?? 'Cannot deploy there'); return; }
    const heroId = this.mode.heroId;
    this.heroes.deploy(heroId, w.id);
    this.#setMode({ kind: 'select' });
    this.select({ kind: 'hero', id: heroId });
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
    } else if (this.mode.kind === 'deploy') {
      this.#deployAt(e.clientX, e.clientY);
    } else {
      const h = this.heroAt(e.clientX, e.clientY);
      if (h) { this.select({ kind: 'hero', id: h.id }); return; }
      const w = this.wallAt(e.clientX, e.clientY);
      this.select(w ? { kind: 'wall', id: w.id } : null);
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
    if (cell?.x !== this.hoverCell?.x || cell?.y !== this.hoverCell?.y || this.mode.kind !== 'build') {
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
    if (e.repeat || e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey) return;
    const sel = this.selection;
    switch (e.code) {
      case 'KeyB': case 'Digit1': this.enterBuild('stone'); break;
      case 'Escape': this.cancel(); break;
      case 'Delete': case 'Backspace':
        if (sel?.kind === 'wall') this.walls.sell(sel.id);
        break;
      case 'KeyR':
        if (sel?.kind === 'wall' && !this.walls.repair(sel.id) && this.walls.repairCost(sel.id)) this.hud.toast('Not enough gold');
        break;
      case 'KeyM':
        if (sel?.kind === 'hero') this.enterDeploy(sel.id);
        break;
      default: return;
    }
    e.preventDefault();
  }

  #refreshHover() {
    const cell = this.hoverCell;
    this.overlay.setHeroSlots(this.mode.kind === 'deploy' ? this.#slotMarkers() : []);
    if (this.mode.kind === 'build') {
      this.overlay.setHover(null);
      const plan = this.plan();
      // Pick each ghost's piece as if the planned walls already existed.
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
        ? { count: ok, cost: ok * this.walls.costOf(this.mode.wallType), blocked: plan.length - ok }
        : null);
      this.canvas.style.cursor = plan.length && plan.every((p) => !p.valid) ? 'not-allowed' : 'crosshair';
      return;
    }
    this.overlay.setGhosts([]);
    this.hud.setPlan(null);
    const p = this.lastPointer;
    if (this.mode.kind === 'deploy') {
      const w = p ? this.wallAt(p.x, p.y) : null;
      this.overlay.setHover(w ? { x: w.x, y: w.y } : null);
      const ok = w && this.heroes.canDeploy(this.mode.heroId, w.id).ok;
      this.canvas.style.cursor = w ? (ok ? 'copy' : 'not-allowed') : 'default';
      return;
    }
    const h = cell && p ? this.heroAt(p.x, p.y) : null;
    const w = !h && cell && p ? this.wallAt(p.x, p.y) : null;
    const hw = h?.wallId ? this.walls.get(h.wallId) : null;
    const at = w ?? hw;
    this.overlay.setHover(at ? { x: at.x, y: at.y } : cell);
    this.canvas.style.cursor = at ? 'pointer' : 'default';
  }

  /** Markers on every wall while deploying: green = free slot, red = full. */
  #slotMarkers() {
    const out = [];
    for (const w of this.walls.all()) {
      out.push({ x: w.x, y: w.y, free: w.heroes.length < w.heroCapacity && !w.heroes.includes(this.mode.heroId) });
    }
    return out;
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
