import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/core/simulation.js';
import { PHASE, waveComposition } from '../src/core/waves.js';
import { ZSTATE } from '../src/core/zombies.js';
import { WALLS, WALL_UPGRADES, ZOMBIES, WAVE_TABLE, ELITE, FORTRESS, MAP } from '../src/config/game.js';
import { buildBlock } from './helpers.js';

const rich = (seed = 1) => {
  const sim = new Simulation({ seed });
  sim.economy.earn(100000);
  return sim;
};
const pin = (sim, z) => { sim.zombies.applyStun(z, 1e6); return z; };

// --- walls -------------------------------------------------------------------
test('every wall type builds with its own stats', () => {
  const sim = rich();
  let x = 5;
  for (const [key, t] of Object.entries(WALLS)) {
    const w = sim.walls.build(key, x++, 10);
    assert.ok(w, key);
    assert.equal(w.maxHp, t.maxHp);
    assert.equal(w.heroCapacity, t.heroCapacity);
  }
});

test('wall armor reduces incoming damage', () => {
  const sim = rich();
  const s = sim.walls.build('stone', 5, 10), r = sim.walls.build('reinforced', 7, 10);
  sim.walls.damage(s.id, 100);
  sim.walls.damage(r.id, 100);
  assert.equal(s.maxHp - s.hp, 100);
  assert.equal(r.maxHp - r.hp, 100 * (1 - WALLS.reinforced.armor));
});

test('wall upgrades: escalating cost, more HP, capped at max level, refund stays below spend', () => {
  const sim = rich();
  const w = sim.walls.build('spiked', 5, 10);
  sim.walls.damage(w.id, 50);
  const c1 = sim.walls.upgradeCost(w.id);
  const hp1 = w.hp, max1 = w.maxHp, thorns1 = w.thorns;
  assert.ok(sim.walls.upgrade(w.id));
  assert.equal(w.level, 2);
  assert.ok(w.maxHp > max1 && w.hp - hp1 === w.maxHp - max1, 'current HP rises by the same amount');
  assert.ok(w.thorns > thorns1);
  const c2 = sim.walls.upgradeCost(w.id);
  assert.ok(c2 > c1);
  assert.ok(sim.walls.upgrade(w.id));
  assert.equal(sim.walls.canUpgrade(w.id).reason, 'max_level');
  assert.equal(w.level, WALL_UPGRADES.maxLevel);
  const spent = WALLS.spiked.cost + c1 + c2;
  assert.ok(sim.walls.sellValue(w.id) < spent);
});

test('spiked walls wound attackers; arcane walls slow and pulse', () => {
  const sim = rich(2);
  for (let x = 0; x < MAP.width; x++) sim.walls.build(x === 12 ? 'spiked' : 'reinforced', x, 6);
  const z = sim.zombies.spawn('walker', 12.5, 4.5, 20);
  sim.run(12);
  assert.equal(z.state, ZSTATE.ATTACK_WALL);
  assert.ok(z.hp < z.maxHp, 'thorns hurt the attacker');

  const sim2 = rich(3);
  sim2.walls.build('arcane', 15, 10);
  const a = sim2.zombies.spawn('walker', 15.5, 8.5, 20);
  pin(sim2, a);
  sim2.run(3);
  assert.ok(a.hp < a.maxHp, 'arcane pulse damaged it');
  assert.ok(a.slowUntil > sim2.zombies.time && a.slowFactor < 1, 'slowed');
});

test('gate: repair costs gold and restores; reinforce raises max HP with escalating cost', () => {
  const sim = rich();
  const f = sim.fortress;
  f.damage(500);
  const cost = f.repairCost();
  assert.ok(cost > 0);
  const g = sim.economy.gold;
  assert.ok(f.repair());
  assert.equal(f.hp, f.maxHp);
  assert.equal(sim.economy.gold, g - cost);
  for (const step of FORTRESS.reinforce) {
    const max = f.maxHp;
    assert.ok(f.reinforce());
    assert.equal(f.maxHp, max + step.addHp);
  }
  assert.equal(f.reinforce(), false, 'fully reinforced');
});

// --- zombies -----------------------------------------------------------------
test('every zombie type spawns and heads for the gate', () => {
  for (const type of Object.keys(ZOMBIES)) {
    const sim = rich(4);
    const z = sim.zombies.spawn(type, 15.5, 1.5);
    const start = z.z;
    sim.run(5);
    assert.ok(z.z > start, `${type} moved south`);
  }
});

test('runners are faster than walkers; brute armor needs penetration', () => {
  const sim = rich(5);
  const w = sim.zombies.spawn('walker', 10.5, 1.5);
  const r = sim.zombies.spawn('runner', 20.5, 1.5);
  sim.run(4);
  assert.ok(r.z - 1.5 > 1.8 * (w.z - 1.5));
  const b = pin(sim, sim.zombies.spawn('brute', 5.5, 5.5));
  assert.ok(sim.zombies.damage(b, 100, 0, { type: 'physical' }) < 60);
  assert.equal(Math.round(sim.zombies.damage(b, 100, 0, { type: 'physical', armorPen: 1 })), 100);
});

test('siege zombies bulldoze through walls that the horde walks around', () => {
  const sim = rich(6);
  for (let x = 8; x <= 22; x++) sim.walls.build('stone', x, 12);
  const walker = sim.zombies.spawn('walker', 15.5, 1.5);
  const siege = sim.zombies.spawn('siege', 15.6, 1.5);
  const hits = new Map();
  sim.events.on('zombieAttack', ({ zombie, gate }) => { if (!gate) hits.set(zombie, (hits.get(zombie) ?? 0) + 1); });
  sim.run(40);
  assert.ok(hits.get(siege) > 0, 'siege attacks the wall in its way');
  assert.ok(!hits.get(walker), 'walker goes around');
});

test('siege zombies hit reinforced walls harder', () => {
  const sim = rich(7);
  for (let x = 0; x < MAP.width; x++) sim.walls.build('reinforced', x, 3);
  const r = sim.walls.at(15, 3);
  const z = pin(sim, sim.zombies.spawn('siege', 15.5, 2.5));
  z.stunUntil = 0;
  let dealt = 0;
  sim.events.on('wallDamaged', ({ wall, amount }) => { if (wall.id === r.id) dealt = amount; });
  sim.run(4);
  const expected = ZOMBIES.siege.wallDamage * ZOMBIES.siege.siege.reinforcedBonus * (1 - WALLS.reinforced.armor);
  assert.ok(Math.abs(dealt - expected) < 0.01, `${dealt} vs ${expected}`);
});

test('plague carriers poison nearby heroes and leave puddles; heroes fall, then revive between waves', () => {
  const sim = rich(8);
  for (let x = 0; x < MAP.width; x++) sim.walls.build('reinforced', x, 10);
  const wall = buildBlock(sim, 15, 10, 'reinforced');
  const hero = sim.heroes.recruitChampion('mage');
  hero.autoCast = false;
  sim.heroes.deploy(hero.id, wall.id);
  const p = sim.zombies.spawn('plague', 15.5, 8.6);
  p.hp = p.maxHp = 5000; // survive the champion long enough to strike the wall
  sim.run(5);
  assert.ok(hero.hp < hero.maxHp, 'aura hurt the hero');
  assert.ok(sim.hazards.puddles.length > 0, 'puddle at the struck wall');
  let fell = 0;
  sim.events.on('heroFell', () => fell++);
  sim.heroes.damageHero(hero, 1e6);
  assert.equal(fell, 1);
  assert.ok(hero.fallen && hero.wallId === 0);
  assert.deepEqual(wall.heroes, []);
  assert.equal(sim.heroes.canDeploy(hero.id, wall.id).reason, 'fallen');
  sim.waves.startNext();
  assert.equal(sim.heroes.canRevive(hero.id).reason, 'wave_active');
  sim.zombies.damage(p, 1e6);
  sim.waves.queue.length = 0;
  for (const z of sim.zombies.list) sim.zombies.damage(z, 1e6);
  sim.run(1);
  assert.equal(sim.waves.phase, PHASE.PREP);
  const cost = sim.heroes.reviveCost(hero.id);
  const g = sim.economy.gold;
  assert.ok(sim.heroes.revive(hero.id));
  assert.equal(sim.economy.gold, g - cost);
  assert.ok(!hero.fallen && hero.hp === hero.maxHp);
});

test('behemoth summons and smashes neighbouring walls; gravelord empowers the horde', () => {
  const sim = rich(9);
  for (let x = 0; x < MAP.width; x++) sim.walls.build('reinforced', x, 5);
  const b = sim.zombies.spawn('behemoth', 15.5, 3.5);
  const before = sim.zombies.list.length;
  sim.run(14);
  assert.ok(sim.zombies.list.length > before, 'summoned');
  const hurt = [...sim.walls.all()].filter((w) => w.hp < w.maxHp);
  assert.ok(hurt.length >= 2, 'the struck wall and a neighbour took damage');
  assert.ok(b.alive);

  const s2 = rich(10);
  const g = s2.zombies.spawn('gravelord', 15.5, 1.5);
  const minion = s2.zombies.spawn('walker', 16.5, 1.5);
  s2.run(15);
  assert.ok(minion.empoweredUntil > 0, 'empowered at least once');
  s2.zombies.applyStun(g, 3);
  assert.ok(g.stunUntil - s2.zombies.time <= 1.01, 'bosses shrug off most of a stun');
});

test('wave composition: new threats arrive gradually, bosses every few waves, elites later', () => {
  const types = (n) => waveComposition(n, WAVE_TABLE, ELITE).groups.map((g) => g.type);
  assert.deepEqual(types(1), ['walker']);
  assert.ok(types(2).includes('runner') && !types(2).includes('brute'));
  assert.ok(types(6).includes('siege') && types(6).includes('plague'));
  assert.equal(waveComposition(4, WAVE_TABLE, ELITE).boss, null);
  assert.equal(waveComposition(5, WAVE_TABLE, ELITE).boss, 'behemoth');
  assert.equal(waveComposition(10, WAVE_TABLE, ELITE).boss, 'gravelord');
  assert.equal(waveComposition(ELITE.fromWave - 1, WAVE_TABLE, ELITE).eliteChance, 0);
  assert.ok(waveComposition(10, WAVE_TABLE, ELITE).eliteChance > 0);
  const w1 = waveComposition(1, WAVE_TABLE, ELITE), w10 = waveComposition(10, WAVE_TABLE, ELITE);
  assert.ok(w10.hpMultiplier > w1.hpMultiplier && w10.damageMultiplier > w1.damageMultiplier);
  assert.ok(w10.hpMultiplier < 120, 'growth is steep but bounded (tuned so runs end; see WAVE_TABLE)');
  assert.ok(waveComposition(30, WAVE_TABLE, ELITE).hpMultiplier < 50000, 'exponential late, but finite');
});

test('boss wave actually spawns its boss once; elites are tougher and worth more', () => {
  const sim = rich(11);
  sim.waves.wave = 4;
  let bosses = 0;
  sim.events.on('bossSpawned', () => bosses++);
  sim.waves.startNext();
  sim.run(80);
  assert.equal(bosses, 1);
  const e = sim.zombies.spawn('walker', 5, 5, 1, { elite: true });
  assert.ok(e.elite && e.maxHp === Math.round(ZOMBIES.walker.hp * ELITE.hpMult));
  assert.equal(e.reward, ZOMBIES.walker.reward * ELITE.rewardMult);
});

test('zombies never stay stuck inside rocks or walls', () => {
  const sim = rich(12);
  const [rx, ry] = MAP.blocked[MAP.blocked.length - 1];
  const inRock = sim.zombies.spawn('walker', rx + 0.5, ry + 0.5);
  const w = sim.walls.build('stone', 12, 8);
  const inWall = sim.zombies.spawn('walker', 12.5, 8.5);
  sim.run(3);
  for (const z of [inRock, inWall]) {
    const cx = Math.floor(z.x), cy = Math.floor(z.z);
    assert.ok(sim.grid.isWalkableTerrain(cx, cy) && !sim.grid.wallAt(cx, cy), `escaped to ${cx},${cy}`);
  }
  assert.ok(w);
});
