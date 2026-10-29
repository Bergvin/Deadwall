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
  /** Starts a run on a map: debug.newGame(seed, 'hollow'). */
  newGame: (seed, mapId) => game.newGame(seed, mapId),
  tower: (type, x, y) => sim().towers.build(type, x, y),
  upgrade: (id, spec) => sim().towers.upgrade(id, spec),
  addGold: (n) => sim().economy.earn(n, 'debug'),
  /** Spawns zombies on a road: debug.spawn('brute', 0, 3). */
  spawn: (type, road = 0, n = 1) => { for (let i = 0; i < n; i++) sim().zombies.spawn(type, road, sim().waves.hpMultiplier); },
  damageHouse: (n) => sim().house.damage(n),
  /** Advance the simulation instantly by `seconds` (ignores pause). */
  fastForward(seconds) { sim().run(seconds); },
  /** Runner: XP (level-ups give perk picks), a perk or spell by id, a cast. */
  runnerXp(n) { sim().runner.addXp(n); return sim().runner.level; },
  grant: (id) => sim().runner.grant(id),
  cast: (id) => sim().runner.cast(id),
  order: (towerId) => sim().runner.orderRefill(towerId),
  state() {
    const s = sim();
    if (!s) return { state: game.state };
    const r = s.runner;
    return {
      state: game.state,
      map: s.map.id,
      paused: game.loop.paused,
      speed: game.loop.speed,
      gold: s.economy.gold,
      wave: s.waves.wave,
      phase: s.waves.phase,
      remaining: s.waves.remaining,
      zombies: s.zombies.list.length,
      alive: s.zombies.aliveCount,
      projectiles: s.projectiles.list.length,
      towers: s.towers.count,
      slots: s.towers.slots,
      house: s.house.hp,
      over: s.over,
      kills: s.stats.kills,
      runner: { state: r.main.state, crates: r.main.crates, level: r.level, picks: r.pendingPicks, x: r.main.x, z: r.main.z },
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
  /** Marks a map's best wave (unlocks the next map at wave 10). */
  setBest(mapId, wave) { game.save.maps[mapId] = { bestWave: wave, highScore: 0 }; writeSave(game.save); },
};
