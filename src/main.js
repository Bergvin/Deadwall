import { Game } from './game/game.js';
import { addXp, addArtifact, rollArtifactOffer } from './core/commander.js';
import { writeSave } from './core/save.js';

const game = new Game();
await game.init(document.getElementById('app'));

const sim = () => game.session?.sim;

/** Debug hooks for automated checks (see CLAUDE.md: test with code, not screenshots). */
window.debug = {
  game,
  sim,
  newGame: (seed) => game.newGame(seed),
  build: (x, y, type = 'stone') => sim().walls.build(type, x, y),
  buildLine(x0, y0, x1, y1, type = 'stone') {
    let n = 0;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (sim().walls.build(type, x, y)) n++;
    }
    return n;
  },
  sellAt: (x, y) => sim().walls.sell(sim().grid.wallAt(x, y)),
  addGold: (n) => sim().economy.earn(n, 'debug'),
  spawn: (type, x, y, n = 1) => { for (let i = 0; i < n; i++) sim().zombies.spawn(type, x + 0.5, y + 0.5); },
  /** Recruits a hero and deploys it on the wall at (x, y). */
  hero(type, x, y) {
    const h = sim().heroes.recruit(type);
    if (h && x !== undefined) sim().heroes.deploy(h.id, sim().grid.wallAt(x, y));
    return h;
  },
  damageWall: (x, y, n) => sim().walls.damage(sim().grid.wallAt(x, y), n),
  damageGate: (n) => sim().fortress.damage(n),
  /** Advance the simulation instantly by `seconds` (ignores pause). */
  fastForward(seconds) { sim().run(seconds); },
  state() {
    const s = sim();
    if (!s) return { state: game.state };
    return {
      state: game.state,
      paused: game.loop.paused,
      speed: game.loop.speed,
      gold: s.economy.gold,
      wave: s.waves.wave,
      phase: s.waves.phase,
      remaining: s.waves.remaining,
      zombies: s.zombies.list.length,
      alive: s.zombies.aliveCount,
      projectiles: s.projectiles.list.length,
      walls: s.walls.count,
      breaches: s.walls.breachCount,
      heroes: s.heroes.count,
      deployed: s.heroes.deployedCount,
      gate: s.fortress.hp,
      over: s.over,
      kills: s.stats.kills,
      mode: game.session.input.mode,
    };
  },
  /** Client-space pixel of a cell centre (for simulated clicks). */
  screenOf(x, y, height = 0) {
    const cam = game.cam.camera;
    const p = new cam.position.constructor(x + 0.5, height, y + 0.5).project(cam);
    const r = game.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  },
  cellAt: (cx, cy) => game.session?.input.cellAt(cx, cy),
  /** The persistent commander record. */
  commander: () => game.save.commander,
  /** Gives commander XP (levels up and saves). */
  commanderXp(n) { const l = addXp(game.save.commander, n); writeSave(game.save); return l; },
  /** Adds an artifact to the stash (merging like a real pick): debug.giveArtifact('bloodstone', 'legendary'). */
  giveArtifact(id, rarity = 'common') { const r = addArtifact(game.save.commander, { id, rarity }); writeSave(game.save); return r; },
  /** Rolls a run-end artifact offer as if a run had reached `wave`. */
  artifactOffer(wave = 10) { game.save.commander.artifactOffer = rollArtifactOffer(wave, Math.random); writeSave(game.save); return game.save.commander.artifactOffer; },
};
