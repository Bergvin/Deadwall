import { Game } from './game/game.js';

const game = new Game();
await game.init(document.getElementById('app'));

/** Debug hooks for automated checks (see CLAUDE.md: test with code, not screenshots). */
window.debug = {
  game,
  build: (x, y, type = 'stone') => game.walls.build(type, x, y),
  buildLine(x0, y0, x1, y1, type = 'stone') {
    const out = [];
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push(game.walls.build(type, x, y));
    }
    return out.filter(Boolean).length;
  },
  sellAt: (x, y) => game.walls.sell(game.grid.wallAt(x, y)),
  addGold: (n) => game.economy.earn(n, 'debug'),
  state() {
    const p = game.computeZombiePath();
    return {
      gold: game.economy.gold,
      walls: game.walls.count,
      mode: game.input.mode,
      selected: game.input.selectedWallId,
      pathLength: p?.length ?? null,
      pathWalls: p ? p.filter(({ x, y }) => game.grid.wallAt(x, y)).length : null,
    };
  },
  /** Client-space pixel of a cell center on the ground (for simulated clicks). */
  screenOf(x, y, height = 0) {
    const v = { x: x + 0.5, y: height, z: y + 0.5 };
    const p = new game.cam.camera.position.constructor(v.x, v.y, v.z).project(game.cam.camera);
    const r = game.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  },
  cellAt: (cx, cy) => game.input.cellAt(cx, cy),
};
