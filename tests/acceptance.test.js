// Acceptance checks from the spec (section 19) that are not already covered elsewhere.
// See docs/acceptance.md for the full checklist and where each item is verified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/core/simulation.js';
import { PHASE } from '../src/core/waves.js';
import { GameLoop } from '../src/core/loop.js';
import { MAP, WAVES, HEROES, TOWERS } from '../src/config/game.js';
import { buildBlock } from './helpers.js';

const rich = (seed = 1) => {
  const sim = new Simulation({ seed });
  sim.economy.earn(100000);
  return sim;
};

test('simultaneous breaches: the horde pours through both openings', () => {
  const sim = rich(21);
  for (let x = 0; x < MAP.width; x++) sim.walls.build('reinforced', x, 12);
  sim.walls.destroy(sim.grid.wallAt(6, 12));
  sim.walls.destroy(sim.grid.wallAt(24, 12));
  assert.equal(sim.walls.breachCount, 2);
  const crossed = new Set();
  sim.events.on('zombieSpawned', () => {});
  for (let i = 0; i < 12; i++) sim.zombies.spawn('walker', i < 6 ? 3.5 + i * 0.3 : 25.5 + (i - 6) * 0.3, 2.5);
  for (let t = 0; t < 40; t += 1 / 30) {
    sim.step(1 / 30);
    for (const z of sim.zombies.list) if (Math.floor(z.z) === 12) crossed.add(Math.floor(z.x));
  }
  assert.ok(crossed.has(6) && crossed.has(24), `crossed at ${[...crossed]}`);
});

test('the prep countdown starts the next wave automatically, exactly once', () => {
  const sim = new Simulation({ seed: 22 });
  let starts = 0;
  sim.events.on('waveStarted', () => starts++);
  sim.run(WAVES.firstPrepTime - 1);
  assert.equal(sim.waves.phase, PHASE.PREP);
  sim.run(2);
  assert.equal(sim.waves.phase, PHASE.ACTIVE);
  assert.equal(starts, 1);
});

test('difficulty rises across real waves: more enemies with more health', () => {
  const sim = rich(23);
  const seen = [];
  // Variants (swarm/chubby) reshape single waves on purpose; the trend is checked on normal waves.
  sim.events.on('waveStarted', ({ wave, count, variant }) => { if (variant === 'normal') seen.push({ wave, count, hp: sim.waves.hpMultiplier }); });
  for (let w = 0; w < 6; w++) {
    sim.waves.startNext();
    for (const z of [...sim.zombies.list]) sim.zombies.damage(z, 1e9);
    sim.events.on('zombieSpawned', (z) => sim.zombies.damage(z, 1e9));
    sim.run(60);
  }
  assert.ok(seen.length >= 3);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i].count >= seen[i - 1].count && seen[i].hp > seen[i - 1].hp, `wave ${seen[i].wave}`);
  }
});

test('the champion is free and unique; tower build/sell cycles always lose gold', () => {
  const sim = rich(24);
  const gold = sim.economy.gold;
  const h = sim.heroes.recruitChampion('archer');
  assert.ok(h && sim.economy.gold === gold, 'free');
  assert.equal(sim.heroes.recruitChampion('mage'), null, 'only one');
  const w = sim.walls.build('stone', 10, 10);
  const start = sim.economy.gold;
  for (let i = 0; i < 8; i++) {
    const t = sim.towers.build('fire', w.id);
    sim.towers.upgrade(t.id);
    sim.towers.sell(t.id);
  }
  assert.ok(sim.economy.gold < start);
});

test('invalid deployments are rejected and never duplicate heroes', () => {
  const sim = rich(25);
  const w = buildBlock(sim, 10, 10);
  const h = sim.heroes.recruitChampion('archer');
  assert.equal(sim.heroes.canDeploy(h.id, 9999).reason, 'no_wall');
  assert.equal(sim.heroes.canDeploy(9999, w.id).reason, 'no_hero');
  sim.towers.build('earth', sim.walls.at(11, 11).id);
  assert.equal(sim.heroes.canDeploy(h.id, w.id).reason, 'needs_block', 'a tower blocks the block');
  sim.towers.sell(sim.walls.at(11, 11).towerId);
  assert.ok(sim.heroes.deploy(h.id, w.id));
  assert.equal(sim.heroes.deploy(h.id, w.id), false);
  const total = [...sim.walls.all()].reduce((n, x) => n + x.heroes.filter((id) => id === h.id).length, 0);
  assert.equal(total, 4);
});

test('game loop: pause freezes simulation time; speed changes keep step size and totals consistent', () => {
  const run = (speed, realSeconds, pauseAt = -1) => {
    let steps = 0;
    const loop = new GameLoop({ onStep: () => steps++ });
    loop.speed = speed;
    for (let t = 0, i = 0; t < realSeconds; t += 1 / 60, i++) {
      loop.paused = i === pauseAt || (pauseAt >= 0 && i > pauseAt && i < pauseAt + 60);
      loop.advance(1 / 60);
    }
    return { steps, simTime: loop.simTime };
  };
  const normal = run(1, 3), fast = run(3, 1);
  assert.ok(Math.abs(normal.steps - fast.steps) <= 2, `${normal.steps} vs ${fast.steps}`);
  assert.ok(Math.abs(normal.simTime - fast.simTime) < 0.05);
  const paused = run(1, 3, 30);
  assert.ok(Math.abs(paused.simTime - (normal.simTime - 1)) < 0.05, 'one second paused = one second less sim time');
});

test('a full game: every enemy type and both bosses appear, and the run ends in defeat', () => {
  const sim = rich(26);
  const types = new Set();
  sim.events.on('zombieSpawned', (z) => types.add(z.type));
  // A thin defence that holds a while and then collapses.
  for (let x = 10; x <= 20; x++) sim.walls.build('reinforced', x, 16);
  const towerTypes = Object.keys(TOWERS);
  for (let x = 10; x <= 20; x += 2) sim.towers.build(towerTypes[x % towerTypes.length], sim.grid.wallAt(x, 16));
  sim.economy.trySpend(sim.economy.gold);
  // An unbreakable gate until every enemy type has shown up, then a normal one.
  sim.fortress.maxHp = sim.fortress.hp = 1e9;
  while (!sim.over && sim.waves.wave < 12) {
    if (sim.waves.phase === PHASE.PREP) sim.waves.startNext();
    sim.step(1 / 30);
  }
  sim.fortress.hp = Math.min(sim.fortress.hp, 1500);
  sim.fortress.maxHp = 1500;
  // Keep going until the fortress falls (cap so the test cannot hang).
  const until = sim.time + 3 * 3600;
  while (!sim.over && sim.time < until) {
    if (sim.waves.phase === PHASE.PREP) sim.waves.startNext();
    sim.step(1 / 30);
  }
  for (const t of ['walker', 'runner', 'brute', 'plague', 'siege', 'behemoth', 'gravelord']) assert.ok(types.has(t), t);
  assert.equal(sim.over, true);
  assert.equal(sim.fortress.hp, 0);
  assert.ok(Object.keys(HEROES).length === 6);
});
