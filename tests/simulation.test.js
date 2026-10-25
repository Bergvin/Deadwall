import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/core/simulation.js';
import { PHASE } from '../src/core/waves.js';
import { ZSTATE } from '../src/core/zombies.js';
import { MAP, ZOMBIES, HEROES, WAVES, WAVE_TABLE, ELITE } from '../src/config/game.js';
import { waveComposition } from '../src/core/waves.js';
import { sanitize, loadSave, writeSave, recordRun } from '../src/core/save.js';

const DT = 1 / 60;
const gate = { x: MAP.gateX, y: MAP.castleWallRow };

test('a lone walker walks to the gate and damages it', () => {
  const sim = new Simulation({ seed: 1 });
  const z = sim.zombies.spawn('walker', MAP.gateX + 0.5, 1);
  sim.run(60);
  assert.equal(z.state, ZSTATE.ATTACK_GATE);
  assert.ok(sim.fortress.hp < sim.fortress.maxHp);
  assert.equal(Math.floor(z.z), gate.y - 1, 'stands just north of the gate');
});

test('intact walls block: a closed line is attacked, not walked through', () => {
  const sim = new Simulation({ seed: 2 });
  sim.economy.earn(10000);
  for (let x = 0; x < MAP.width; x++) sim.walls.build('stone', x, 10);
  const z = sim.zombies.spawn('walker', 10.5, 1);
  let maxZ = 0;
  for (let t = 0; t < 30; t += DT) { sim.step(DT); maxZ = Math.max(maxZ, z.z); }
  assert.ok(maxZ < 10, `never enters the wall row (max z ${maxZ.toFixed(2)})`);
  assert.equal(z.state, ZSTATE.ATTACK_WALL);
  const hit = sim.walls.get(z.targetWallId);
  assert.ok(hit && hit.hp < hit.maxHp, 'the targeted wall takes damage');
});

test('a destroyed wall becomes an opening the horde passes through', () => {
  const sim = new Simulation({ seed: 3 });
  sim.economy.earn(10000);
  for (let x = 0; x < MAP.width; x++) sim.walls.build('stone', x, 10);
  const z = sim.zombies.spawn('walker', 10.5, 1);
  sim.run(25);
  const wallId = z.targetWallId;
  const wall = sim.walls.get(wallId);
  const { x: bx, y: by } = wall;
  sim.walls.damage(wallId, wall.hp); // finish it off
  assert.equal(sim.grid.wallAt(bx, by), 0);
  assert.equal(sim.walls.breachCount, 1);
  sim.run(40);
  assert.ok(z.z > 11, 'walked through the breach');
  assert.ok([ZSTATE.MOVE, ZSTATE.ATTACK_GATE].includes(z.state));
  // Rebuilding the cell clears the breach.
  sim.zombies.clear();
  sim.zombies.step(DT);
  assert.ok(sim.walls.build('stone', bx, by));
  assert.equal(sim.walls.breachCount, 0);
});

test('cannot build on a cell occupied by a zombie', () => {
  const sim = new Simulation({ seed: 4 });
  const z = sim.zombies.spawn('walker', 12.5, 8.5);
  sim.zombies.step(DT);
  const c = { x: Math.floor(z.x), y: Math.floor(z.z) };
  assert.equal(sim.walls.canBuild('stone', c.x, c.y).reason, 'enemy_present');
});

test('kills grant gold and XP exactly once', () => {
  const sim = new Simulation({ seed: 5 });
  const hero = sim.heroes.recruit('archer');
  const z = sim.zombies.spawn('walker', 5.5, 5.5);
  const gold = sim.economy.gold;
  sim.zombies.damage(z, 1000, hero.id);
  sim.zombies.damage(z, 1000, hero.id);
  sim.heroes.awardKillXp(z); // a second award attempt must not be triggered by the system
  assert.equal(sim.economy.gold, gold + ZOMBIES.walker.reward);
  assert.equal(sim.stats.kills, 1);
  assert.equal(z.alive, false);
});

test('archer on a wall shoots walkers; projectiles hit once each', () => {
  const sim = new Simulation({ seed: 6 });
  const wall = sim.walls.build('stone', 15, 14);
  const hero = sim.heroes.recruit('archer');
  assert.ok(sim.heroes.deploy(hero.id, wall.id));
  const z = sim.zombies.spawn('walker', 15.5, 10.5, 3); // 180 hp
  let hits = 0;
  const impact = sim.combat.impact.bind(sim.combat);
  sim.combat.impact = (...args) => { hits++; impact(...args); };
  const dealt = [];
  sim.events.on('zombieDamaged', ({ amount }) => dealt.push(amount));
  sim.run(20);
  assert.equal(z.alive, false, 'the archer killed it');
  assert.equal(hits, dealt.length, 'one damage event per projectile hit');
  assert.ok(hero.xp > 0);
  assert.equal(sim.projectiles.list.length, 0, 'in-flight arrows resolved');
});

test('dead enemies stop attacking and are cleaned up', () => {
  const sim = new Simulation({ seed: 7 });
  const z = sim.zombies.spawn('walker', MAP.gateX + 0.5, 19.5);
  sim.run(5);
  const hp = sim.fortress.hp;
  sim.zombies.damage(z, 9999);
  sim.run(5);
  assert.equal(sim.fortress.hp, hp);
  assert.equal(sim.zombies.list.length, 0);
});

test('hero capacity, no duplicates, reposition delay and unseat on destruction', () => {
  const sim = new Simulation({ seed: 8 });
  sim.economy.earn(1000);
  const a = sim.walls.build('stone', 10, 12);
  const b = sim.walls.build('stone', 11, 12);
  const h1 = sim.heroes.recruit('archer');
  const h2 = sim.heroes.recruit('archer');
  assert.ok(sim.heroes.deploy(h1.id, a.id));
  assert.equal(sim.heroes.canDeploy(h2.id, a.id).reason, 'wall_full');
  assert.equal(sim.heroes.deploy(h1.id, a.id), false, 'already there');
  assert.ok(sim.heroes.deploy(h1.id, b.id));
  assert.deepEqual(a.heroes, []);
  assert.deepEqual(b.heroes, [h1.id], 'hero exists on exactly one wall');
  assert.ok(h1.moving > 0, 'repositioning takes time');
  sim.walls.destroy(b.id);
  assert.equal(h1.wallId, 0, 'back to reserve');
  assert.equal(sim.heroes.count, 2);
});

test('recruit/dismiss cannot generate gold', () => {
  const sim = new Simulation({ seed: 9 });
  const start = sim.economy.gold;
  for (let i = 0; i < 5; i++) {
    const h = sim.heroes.recruit('archer');
    if (h) sim.heroes.dismiss(h.id);
  }
  assert.ok(sim.economy.gold < start);
  assert.equal(sim.heroes.recruit('archer') && true, true);
  sim.economy.trySpend(sim.economy.gold);
  assert.equal(sim.heroes.recruit('archer'), null, 'cannot recruit without gold');
});

test('waves: early start never duplicates; clearing pays a bonus and returns to prep', () => {
  const sim = new Simulation({ seed: 10 });
  assert.equal(sim.waves.phase, PHASE.PREP);
  assert.ok(sim.waves.startNext());
  assert.equal(sim.waves.startNext(), false, 'second start ignored while active');
  const expected = waveComposition(1, WAVE_TABLE, ELITE).groups.reduce((a, g) => a + g.count, 0);
  assert.equal(sim.waves.remaining, expected);
  let spawned = 0;
  sim.events.on('zombieSpawned', () => spawned++);
  // Kill everything as it spawns.
  sim.events.on('zombieSpawned', (z) => sim.zombies.damage(z, 9999));
  const gold = sim.economy.gold;
  sim.run(30);
  assert.equal(spawned, expected);
  assert.equal(sim.waves.phase, PHASE.PREP);
  assert.equal(sim.waves.wave, 1);
  assert.equal(sim.economy.gold, gold + expected * ZOMBIES.walker.reward + WAVES.clearBonusBase + WAVES.clearBonusPerWave);
});

test('undefended fortress falls and the game ends exactly once', () => {
  const sim = new Simulation({ seed: 11 });
  let overs = 0;
  sim.events.on('gameOver', () => overs++);
  sim.waves.startNext();
  sim.run(60 * 15);
  assert.equal(sim.over, true);
  assert.equal(overs, 1);
  assert.equal(sim.fortress.hp, 0);
  const t = sim.time;
  sim.run(5);
  assert.equal(sim.time, t, 'simulation frozen after game over');
});

test('same seed + same actions = same outcome (deterministic)', () => {
  const play = () => {
    const sim = new Simulation({ seed: 42 });
    const w = sim.walls.build('stone', 15, 15);
    sim.heroes.deploy(sim.heroes.recruit('archer').id, w.id);
    sim.waves.startNext();
    sim.run(40);
    return [sim.economy.gold, sim.stats.kills, sim.fortress.hp, sim.zombies.list.length];
  };
  assert.deepEqual(play(), play());
});

test('combat surcharge applies to building during a wave', () => {
  const sim = new Simulation({ seed: 12 });
  const base = sim.walls.costOf('stone');
  sim.waves.startNext();
  assert.ok(sim.walls.costOf('stone') > base);
});

test('repair restores to max for the quoted price and never exceeds it', () => {
  const sim = new Simulation({ seed: 13 });
  const w = sim.walls.build('stone', 8, 8);
  sim.walls.damage(w.id, 150);
  const cost = sim.walls.repairCost(w.id);
  const gold = sim.economy.gold;
  assert.ok(sim.walls.repair(w.id));
  assert.equal(w.hp, w.maxHp);
  assert.equal(sim.economy.gold, gold - cost);
  assert.equal(sim.walls.repair(w.id), false, 'nothing to repair');
});

test('save data is validated and corrupt saves fall back to defaults', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  mem.set('deadwall.save', '{not json');
  assert.equal(loadSave(storage).bestWave, 0);
  assert.equal(sanitize({ version: 1, bestWave: -5, highScore: 'x' }).highScore, 0);
  const { save, newBestWave } = recordRun(loadSave(storage), { wave: 7, score: 900, kills: 40 });
  assert.ok(newBestWave);
  writeSave(save, storage);
  assert.equal(loadSave(storage).bestWave, 7);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadSave(throwing).bestWave, 0);
  assert.equal(writeSave(save, throwing), false);
});
