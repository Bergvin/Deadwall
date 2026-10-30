// Mouse/keyboard interaction with the battlefield: hover, selection (towers, the runner,
// the house), tower placement with a ghost and range preview, right-drag panning, cancel
// and hotkeys. Press listeners are on the canvas only, so clicks on HUD elements never
// reach the battlefield. All listeners are tied to an AbortSignal so a finished run
// removes them.
import * as THREE from 'three';

export const REJECT_TEXT = {
  insufficient_gold: 'Not enough gold',
  blocked: 'Towers go on free ground beside the road',
  too_close: 'Towers need a free cell between them',
  upgrading: 'Wait until the runner has built the current upgrade',
  no_slots: 'No free tower slot (more open as you survive longer)',
  max_level: 'Already at maximum level',
  choose_spec: 'Choose a specialisation first',
  not_ready: 'Not ready yet',
  unknown_type: 'Unknown tower',
};

/** Hotkeys for tower types (in TOWERS order) and spells (in the order he learned them). */
export const TOWER_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
export const SPELL_KEYS = ['KeyQ', 'KeyE', 'KeyF', 'KeyG', 'KeyT', 'KeyY', 'KeyH'];
export const keyLabel = (code) => code.replace('Digit', '').replace('Key', '');

export class Interaction {
  /** @param {{canvas, cam, sim, towerView, runnerView, overlay, hud, cameraCfg, signal, settings}} deps */
  constructor({ canvas, cam, sim, towerView, runnerView, overlay, hud, cameraCfg, signal, settings }) {
    Object.assign(this, { canvas, cam, sim, towerView, runnerView, overlay, hud, cameraCfg, settings });
    this.towers = sim.towers;
    this.runner = sim.runner;
    this.mode = { kind: 'select' };
    this.selection = null; // { kind: 'tower' | 'runner' | 'house', id }
    this.hoverCell = null;
    this.drag = null;
    this.raycaster = new THREE.Raycaster();
    this.#bind(signal);
    const ev = sim.events;
    ev.on('towerRemoved', ({ tower }) => {
      if (this.selection?.kind === 'tower' && this.selection.id === tower.id) this.select(null);
      this.#refreshHover();
    });
    for (const t of ['goldChanged', 'towerBuilt', 'towerUpgraded']) ev.on(t, () => this.#refreshHover());
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
    this.overlay.setGridVisible(mode.kind === 'tower');
    this.hud.setMode(mode);
    this.#refreshHover();
  }

  /** Waits for clicks on free ground to build towers of `towerType` (until cancelled). */
  enterTowerBuild(towerType) {
    this.select(null);
    this.#setMode({ kind: 'tower', towerType });
  }

  cancel() {
    if (this.mode.kind !== 'select') this.#setMode({ kind: 'select' });
    else this.select(null);
  }

  select(sel) {
    this.selection = sel;
    const t = sel?.kind === 'tower' ? this.towers.get(sel.id) : null;
    this.overlay.setSelection(t ? { x: t.x, y: t.y } : null);
    this.hud.showSelection(sel);
    this.#refreshHover();
  }

  /** Casts the runner's n-th known spell. */
  castSlot(n) {
    const id = Object.keys(this.runner.spells)[n];
    if (!id) return;
    if (!this.runner.cast(id)) this.hud.toast(this.runner.time < this.runner.main.bonkUntil ? 'He is seeing stars!' : 'Not ready yet');
  }

  /** Sends the runner to the selected tower with a crate. */
  orderSelected() {
    const sel = this.selection;
    if (sel?.kind === 'tower') this.runner.orderRefill(sel.id);
  }

  // --- picking ---------------------------------------------------------
  cellAt(clientX, clientY) {
    const p = this.cam.groundPoint(clientX, clientY);
    if (!p) return null;
    const cell = { x: Math.floor(p.x), y: Math.floor(p.z) };
    return this.sim.grid.inBounds(cell.x, cell.y) ? cell : null;
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

  towerAt(clientX, clientY) {
    this.towerView.group.updateMatrixWorld();
    const hit = this.#ray(clientX, clientY).intersectObjects(this.towerView.pickables, true)[0];
    if (hit) return this.towers.get(hit.object.userData.towerId);
    const c = this.cellAt(clientX, clientY);
    return c ? this.towers.get(this.sim.grid.towerAt(c.x, c.y)) : null;
  }

  runnerAt(clientX, clientY) {
    this.runnerView.group.updateMatrixWorld();
    const hit = this.#ray(clientX, clientY).intersectObjects(this.runnerView.pickables, false)[0];
    return hit ? this.runner.units.find((u) => u.id === hit.object.userData.runnerId) : null;
  }

  #isHouse(cell) {
    return !!cell && this.sim.house.cells.some((c) => c.x === cell.x && c.y === cell.y);
  }

  #buildAt(clientX, clientY) {
    const cell = this.cellAt(clientX, clientY);
    const check = cell ? this.towers.canBuild(this.mode.towerType, cell.x, cell.y) : { ok: false, reason: 'blocked' };
    if (!check.ok) { this.hud.toast(REJECT_TEXT[check.reason] ?? 'Cannot build there'); return; }
    const t = this.towers.build(this.mode.towerType, cell.x, cell.y);
    // One tower per click; out of slots or gold ends building.
    if (t && (this.towers.count >= this.towers.slots || !this.towers.economy.canAfford(this.towers.costOf(this.mode.towerType)))) {
      this.#setMode({ kind: 'select' });
      this.select({ kind: 'tower', id: t.id });
    }
    this.#refreshHover();
  }

  // --- pointer ---------------------------------------------------------
  #onDown(e) {
    if (e.button === 1 || e.button === 2) {
      this.drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
      return;
    }
    if (e.button !== 0) return;
    if (this.mode.kind === 'tower') { this.#buildAt(e.clientX, e.clientY); return; }
    const u = this.runnerAt(e.clientX, e.clientY);
    if (u) { this.select({ kind: 'runner', id: u.id }); return; }
    const t = this.towerAt(e.clientX, e.clientY);
    if (t) {
      // Double-click a tower: send the runner to it.
      const now = performance.now();
      if (this.lastTowerClick?.id === t.id && now - this.lastTowerClick.at < 350) this.runner.orderRefill(t.id);
      this.lastTowerClick = { id: t.id, at: now };
      this.select({ kind: 'tower', id: t.id });
      return;
    }
    const c = this.cellAt(e.clientX, e.clientY);
    this.select(this.#isHouse(c) ? { kind: 'house' } : null);
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
    if (cell?.x !== this.hoverCell?.x || cell?.y !== this.hoverCell?.y) {
      this.hoverCell = cell;
      this.#refreshHover();
    }
  }

  #onUp(e) {
    if (this.drag && e.button === this.drag.button) {
      if (!this.drag.moved && this.drag.button === 2) this.cancel();
      this.drag = null;
    }
  }

  #onKey(e) {
    if (e.repeat || e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey) return;
    const sel = this.selection;
    const ti = TOWER_KEYS.indexOf(e.code);
    const si = SPELL_KEYS.indexOf(e.code);
    if (ti >= 0) {
      const type = Object.keys(this.sim.config.TOWERS)[ti];
      if (type) this.enterTowerBuild(type);
    } else if (si >= 0) {
      this.castSlot(si);
    } else {
      switch (e.code) {
        case 'KeyU': {
          if (sel?.kind !== 'tower') return;
          if (this.towers.needsSpec(sel.id)) { this.hud.toast('Pick a specialisation in the tower panel'); break; }
          const r = this.towers.canUpgrade(sel.id);
          if (r.ok) this.towers.upgrade(sel.id); else this.hud.toast(REJECT_TEXT[r.reason] ?? 'Cannot upgrade');
          break;
        }
        case 'KeyR': this.orderSelected(); break;
        case 'Escape': this.cancel(); break;
        case 'Delete': case 'Backspace':
          if (sel?.kind === 'tower') this.hud.confirmSell(sel.id);
          break;
        default: return;
      }
    }
    e.preventDefault();
  }

  #refreshHover() {
    const cell = this.hoverCell;
    const sel = this.selection;
    const selTower = sel?.kind === 'tower' ? this.towers.get(sel.id) : null;
    if (this.mode.kind === 'tower') {
      const type = this.sim.config.TOWERS[this.mode.towerType];
      const valid = !!cell && this.towers.canBuild(this.mode.towerType, cell.x, cell.y).ok;
      this.overlay.setHover(null);
      this.overlay.setGhosts(cell ? [{ cell, model: 'towerHexBase', rot: 0, valid }] : []);
      this.overlay.setRing('range', cell ? { x: cell.x + 0.5, z: cell.y + 0.5, radius: type.range, color: valid ? 0x8fe08a : 0xff6a5a } : null);
      this.canvas.style.cursor = cell ? (valid ? 'copy' : 'not-allowed') : 'default';
      return;
    }
    this.overlay.setGhosts([]);
    this.overlay.setRing('range', selTower ? { x: selTower.cx, z: selTower.cz, radius: this.towers.rangeOf(selTower) } : null);
    const p = this.lastPointer;
    const overTower = cell && p ? this.towerAt(p.x, p.y) : null;
    this.overlay.setHover(overTower ? { x: overTower.x, y: overTower.y } : null);
    this.canvas.style.cursor = overTower || this.#isHouse(cell) ? 'pointer' : 'default';
  }

  /** Per-frame overlay upkeep (the runner moves, buffs change ranges). */
  tick() {
    const sel = this.selection;
    const t = sel?.kind === 'tower' ? this.towers.get(sel.id) : null;
    if (this.mode.kind !== 'tower') this.overlay.setRing('range', t ? { x: t.cx, z: t.cz, radius: this.towers.rangeOf(t) } : null);
    // The spell reach follows the runner while he or a spell button is in focus.
    const u = this.runner.main;
    const show = sel?.kind === 'runner' || this.hud.spellHover;
    this.overlay.setRing('spell', show ? { x: u.x, z: u.z, radius: this.runner.spellRadius, color: 0x7cff9a, opacity: 0.6 } : null);
  }
}
