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
  cooldown: 'Ability is recharging',
  locked: 'Ability not unlocked yet',
  out_of_range: 'Out of range',
  no_target: 'No valid target',
  not_deployed: 'Deploy the hero on a wall first',
  moving: 'The hero is still moving',
  tier_taken: 'Already chose a talent in that tier',
  level_too_low: 'Hero level too low',
  fallen: 'That hero has fallen; revive them between waves',
  max_level: 'Already at maximum level',
  needs_block: 'The champion needs a free 2x2 block of walls (no towers on it)',
  has_tower: 'That wall already has a tower',
  hero_there: 'The champion stands there',
  hero_limit: 'You can only have one champion',
  wave_active: 'Only possible between waves',
};

export class Interaction {
  /**
   * @param {{canvas, cam, sim, wallView, heroView, overlay, hud, cameraCfg, signal}} deps
   */
  constructor({ canvas, cam, sim, wallView, heroView, towerView, overlay, hud, cameraCfg, signal }) {
    Object.assign(this, { canvas, cam, sim, wallView, heroView, towerView, overlay, hud, cameraCfg });
    this.towers = sim.towers;
    this.walls = sim.walls;
    this.heroes = sim.heroes;
    this.combat = sim.combat;
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
    this.overlay.setAbilityPreview(null);
    this.hud.setMode(mode);
    this.#refreshHover();
  }

  enterBuild(wallType) {
    this.select(null);
    this.#setMode({ kind: 'build', wallType });
  }

  /** Waits for a click on a wall to place (or move) the hero. */
  /** Waits for clicks on walls to build towers of `towerType` (stays active until cancelled). */
  enterTowerBuild(towerType) {
    this.select(null);
    this.#setMode({ kind: 'tower', towerType });
  }

  enterDeploy(heroId) {
    if (!this.heroes.get(heroId)) return;
    this.#setMode({ kind: 'deploy', heroId });
  }

  /**
   * Activates a hero ability. Abilities without a target fire at once; others enter a
   * targeting mode with a reach/area preview until the player clicks or cancels.
   */
  useAbility(heroId, abilityId) {
    const h = this.heroes.get(heroId);
    const a = h && this.combat.abilityConfig(h, abilityId);
    if (!a) return;
    if (a.target === 'none') {
      const res = this.combat.use(heroId, abilityId);
      if (!res.ok) this.hud.toast(REJECT_TEXT[res.reason] ?? 'Cannot use that now');
      return;
    }
    const pre = this.combat.canUse(heroId, abilityId, null);
    if (!pre.ok && pre.reason !== 'no_target') { this.hud.toast(REJECT_TEXT[pre.reason] ?? 'Cannot use that now'); return; }
    this.#setMode({ kind: 'ability', heroId, abilityId });
  }

  /** Target object for the current ability mode at a cursor position. */
  #abilityTarget(clientX, clientY) {
    const { heroId, abilityId } = this.mode;
    const h = this.heroes.get(heroId);
    const a = this.combat.abilityConfig(h, abilityId);
    const p = this.cam.groundPoint(clientX, clientY);
    if (!p) return null;
    if (a.target === 'point') return { x: p.x, z: p.z };
    if (a.target === 'enemy') {
      let best = null, bd = 1.2;
      for (const z of this.sim.zombies.list) {
        if (!z.alive) continue;
        const d = Math.hypot(z.x - p.x, z.z - p.z);
        if (d < bd) { bd = d; best = z; }
      }
      return best ? { zombieId: best.id, x: best.x, z: best.z } : { x: p.x, z: p.z };
    }
    if (a.target === 'wall') {
      const w = this.wallAt(clientX, clientY) ?? this.walls.at(Math.floor(p.x), Math.floor(p.z));
      return w ? { wallId: w.id, x: w.x + 0.5, z: w.y + 0.5 } : { x: p.x, z: p.z };
    }
    return null;
  }

  #abilityAt(clientX, clientY) {
    const { heroId, abilityId } = this.mode;
    const target = this.#abilityTarget(clientX, clientY);
    const res = this.combat.use(heroId, abilityId, target);
    if (!res.ok) { this.hud.toast(REJECT_TEXT[res.reason] ?? 'Cannot use that there'); return; }
    this.#setMode({ kind: 'select' });
    this.select({ kind: 'hero', id: heroId });
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
    // Selecting a different hero ends targeting for the previous one.
    if (this.mode.kind === 'ability' && !(sel?.kind === 'hero' && sel.id === this.mode.heroId)) this.#setMode({ kind: 'select' });
    this.selection = sel;
    const w = sel?.kind === 'wall' ? this.walls.get(sel.id) : null;
    const h = sel?.kind === 'hero' ? this.heroes.get(sel.id) : null;
    const t = sel?.kind === 'tower' ? this.towers.get(sel.id) : null;
    const tw = t ? this.walls.get(t.wallId) : null;
    const hb = h?.block ? { x: h.block.x, y: h.block.y, size: 2 } : null;
    const at = w ?? tw ?? hb ?? (sel?.kind === 'gate' ? this.sim.fortress.gate : null);
    this.overlay.setSelection(at ? { x: at.x, y: at.y, size: at.size ?? 1 } : null);
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

  towerAt(clientX, clientY) {
    this.towerView.group.updateMatrixWorld();
    const hit = this.#ray(clientX, clientY).intersectObjects(this.towerView.pickables, true)[0];
    return hit ? this.towers.get(hit.object.userData.towerId) : null;
  }

  #towerAt(clientX, clientY) {
    const cell = this.cellAt(clientX, clientY);
    const w = this.wallAt(clientX, clientY) ?? (cell ? this.walls.at(cell.x, cell.y) : null);
    const check = w ? this.towers.canBuild(this.mode.towerType, w.id) : { ok: false, reason: 'no_wall' };
    if (!check.ok) { this.hud.toast(REJECT_TEXT[check.reason] ?? 'Cannot build a tower there'); return; }
    this.towers.build(this.mode.towerType, w.id);
    this.#refreshHover();
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
    } else if (this.mode.kind === 'tower') {
      this.#towerAt(e.clientX, e.clientY);
    } else if (this.mode.kind === 'ability') {
      this.#abilityAt(e.clientX, e.clientY);
    } else {
      const h = this.heroAt(e.clientX, e.clientY);
      if (h) { this.select({ kind: 'hero', id: h.id }); return; }
      const t = this.towerAt(e.clientX, e.clientY);
      if (t) { this.select({ kind: 'tower', id: t.id }); return; }
      const w = this.wallAt(e.clientX, e.clientY);
      if (w) { this.select(w.towerId ? { kind: 'tower', id: w.towerId } : { kind: 'wall', id: w.id }); return; }
      const c = this.cellAt(e.clientX, e.clientY);
      const gate = this.sim.fortress.gate;
      // The gate (and the wall cells beside it) select the fortress gate.
      this.select(c && c.y === gate.y && Math.abs(c.x - gate.x) <= 1 ? { kind: 'gate' } : null);
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
      case 'Digit2': this.enterBuild('reinforced'); break;
      case 'Digit3': this.enterBuild('spiked'); break;
      case 'Digit4': this.enterBuild('arcane'); break;
      case 'Digit5': this.enterTowerBuild('fire'); break;
      case 'Digit6': this.enterTowerBuild('earth'); break;
      case 'Digit7': this.enterTowerBuild('wind'); break;
      case 'Digit8': this.enterTowerBuild('water'); break;
      case 'KeyU': {
        const sys = sel?.kind === 'wall' ? this.walls : sel?.kind === 'tower' ? this.towers : null;
        if (sys) {
          const r = sys.canUpgrade(sel.id);
          if (r.ok) sys.upgrade(sel.id); else this.hud.toast(REJECT_TEXT[r.reason] ?? 'Cannot upgrade');
        }
        break;
      }
      case 'Escape': this.cancel(); break;
      case 'Delete': case 'Backspace':
        if (sel?.kind === 'wall') this.walls.sell(sel.id);
        if (sel?.kind === 'tower') this.towers.sell(sel.id);
        break;
      case 'KeyR':
        if (sel?.kind === 'wall' && !this.walls.repair(sel.id) && this.walls.repairCost(sel.id)) this.hud.toast('Not enough gold');
        if (sel?.kind === 'gate' && !this.sim.fortress.repair() && this.sim.fortress.repairCost()) this.hud.toast('Not enough gold');
        break;
      case 'KeyM':
        if (sel?.kind === 'hero') this.enterDeploy(sel.id);
        break;
      case 'KeyQ': case 'KeyE': case 'KeyF': {
        if (sel?.kind !== 'hero') return;
        const h = this.heroes.get(sel.id);
        const ids = Object.keys(this.sim.config.HEROES[h.type].abilities);
        const id = ids[{ KeyQ: 0, KeyE: 1, KeyF: 2 }[e.code]];
        if (id) this.useAbility(h.id, id);
        break;
      }
      default: return;
    }
    e.preventDefault();
  }

  #refreshHover() {
    const cell = this.hoverCell;
    this.overlay.setHeroSlots(this.mode.kind === 'deploy' || this.mode.kind === 'tower' ? this.#slotMarkers() : []);
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
    if (this.mode.kind === 'ability') {
      const h = this.heroes.get(this.mode.heroId);
      const pos = h && this.heroes.positionOf(h);
      if (!pos) { this.#setMode({ kind: 'select' }); return; }
      const target = p ? this.#abilityTarget(p.x, p.y) : null;
      const valid = !!target && this.combat.canUse(h.id, this.mode.abilityId, target).ok;
      this.overlay.setHover(null);
      this.overlay.setAbilityPreview({
        reachCenter: pos, reach: this.combat.abilityReach(h, this.mode.abilityId),
        at: target ? { x: target.x, z: target.z } : null,
        radius: this.combat.abilityRadius(h, this.mode.abilityId), valid,
      });
      this.canvas.style.cursor = valid ? 'crosshair' : 'not-allowed';
      return;
    }
    if (this.mode.kind === 'deploy') {
      const w = p ? this.wallAt(p.x, p.y) : null;
      const block = w ? this.heroes.canDeploy(this.mode.heroId, w.id).block : null;
      // Show the whole 2x2 block the champion would take.
      this.overlay.setSelection(block ? { x: block.x, y: block.y, size: 2 } : null);
      this.overlay.setHover(w ? { x: w.x, y: w.y } : null);
      this.canvas.style.cursor = w ? (block ? 'copy' : 'not-allowed') : 'default';
      return;
    }
    if (this.mode.kind === 'tower') {
      const w = p ? this.wallAt(p.x, p.y) : null;
      this.overlay.setHover(w ? { x: w.x, y: w.y } : null);
      const ok = w && this.towers.canBuild(this.mode.towerType, w.id).ok;
      this.canvas.style.cursor = w ? (ok ? 'copy' : 'not-allowed') : 'default';
      return;
    }
    const h = cell && p ? this.heroAt(p.x, p.y) : null;
    const w = !h && cell && p ? this.wallAt(p.x, p.y) : null;
    const at = w ?? (h?.block ? { x: h.block.x, y: h.block.y, size: 2 } : null);
    this.overlay.setHover(at ? { x: at.x, y: at.y, size: at.size } : cell);
    this.canvas.style.cursor = at ? 'pointer' : 'default';
  }

  /**
   * Markers on every wall: when placing a tower, green = free for a tower; when placing the
   * champion, green = part of at least one free 2x2 block.
   */
  #slotMarkers() {
    const out = [];
    for (const w of this.walls.all()) {
      const free = this.mode.kind === 'tower'
        ? !w.towerId && !w.heroes.length
        : this.heroes.blocksAt(this.mode.heroId, w.id).length > 0;
      out.push({ x: w.x, y: w.y, free });
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
