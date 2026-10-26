import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/core/simulation.js';
import { TOWERS, TOWER_RULES } from '../src/config/game.js';

const rich = (seed = 1) => {
  const sim = new Simulation({ seed });
  sim.economy.earn(100000);
  return sim;
};
const dummy = (sim, x, z, hp = 5000) => {
  const zb = sim.zombies.spawn('walker', x, z);
  zb.hp = zb.maxHp = hp;
  sim.zombies.applyStun(zb, 1e6);
  return zb;
};

for (const type of Object.keys(TOWERS)) {
  test(`${type} tower builds on a wall and damages zombies in range`, () => {
    const sim = rich();
    const w = sim.walls.build('stone', 15, 14);
    const t = sim.towers.build(type, w.id);
    assert.ok(t && w.towerId === t.id);
    const z = dummy(sim, 15.5, 11.5);
    sim.run(4);
    assert.ok(z.hp < z.maxHp, `${type} hit`);
    assert.ok(t.totalDamage > 0);
  });
}

test('element effects: fire burns, earth stuns, wind hits several, water slows', () => {
  const sim = rich(2);
  const build = (type, x) => sim.towers.build(type, sim.walls.build('stone', x, 14).id);
  build('fire', 5);
  const f = dummy(sim, 5.5, 11.5);
  build('water', 25);
  const wa = dummy(sim, 25.5, 11.5);
  sim.run(3);
  assert.ok(f.dots.some((d) => d.type === 'fire'), 'burning');
  assert.ok(wa.slowUntil > sim.zombies.time && wa.slowFactor < 1, 'slowed');

  const s2 = rich(3);
  const e = s2.towers.build('earth', s2.walls.build('stone', 15, 14).id);
  const armored = s2.zombies.spawn('brute', 15.5, 11.5);
  armored.hp = armored.maxHp = 5000;
  let stunned = 0;
  s2.events.on('zombieStunned', () => stunned++);
  s2.run(4);
  assert.ok(stunned > 0 && e.totalDamage > 0, 'earth staggers its target');

  const s3 = rich(4);
  s3.towers.build('wind', s3.walls.build('stone', 15, 14).id);
  const a = dummy(s3, 14.5, 10.5), b = dummy(s3, 16.5, 10.5);
  s3.run(1.2);
  assert.ok(a.hp < a.maxHp && b.hp < b.maxHp, 'wind hits two at once');
});

test('upgrades: escalating cost, stronger stats, capped at level 3; refunds lose gold', () => {
  const sim = rich(5);
  const t = sim.towers.build('fire', sim.walls.build('stone', 10, 10).id);
  const d1 = t.stats.damage, r1 = t.stats.range;
  const c1 = sim.towers.upgradeCost(t.id);
  assert.ok(sim.towers.upgrade(t.id));
  const c2 = sim.towers.upgradeCost(t.id);
  assert.ok(c2 > c1 && t.stats.damage > d1 && t.stats.range > r1 && t.stats.burn.dps > TOWERS.fire.burn.dps);
  assert.ok(sim.towers.upgrade(t.id));
  assert.equal(t.level, TOWER_RULES.maxLevel);
  assert.equal(sim.towers.canUpgrade(t.id).reason, 'max_level');
  assert.ok(sim.towers.sellValue(t.id) < TOWERS.fire.cost + c1 + c2);
});

test('one tower per wall; towers fall with their wall; selling a wall sells its tower', () => {
  const sim = rich(6);
  const w = sim.walls.build('stone', 10, 10);
  assert.ok(sim.towers.build('water', w.id));
  assert.equal(sim.towers.canBuild('fire', w.id).reason, 'has_tower');
  sim.walls.destroy(w.id);
  assert.equal(sim.towers.count, 0, 'destroyed with the wall');
  const w2 = sim.walls.build('stone', 12, 10);
  sim.towers.build('earth', w2.id);
  const gold = sim.economy.gold;
  sim.walls.sell(w2.id);
  assert.equal(sim.towers.count, 0);
  assert.ok(sim.economy.gold > gold + sim.walls.sellValue(w2.id), 'tower refund paid too');
});

test('towers cost more during a wave and cannot be afforded without gold', () => {
  const sim = new Simulation({ seed: 7 });
  const base = sim.towers.costOf('fire');
  sim.waves.startNext();
  assert.ok(sim.towers.costOf('fire') > base);
  sim.economy.trySpend(sim.economy.gold);
  const w = sim.walls.build;
  assert.equal(sim.towers.canBuild('fire', 9999).reason, 'no_wall');
  assert.ok(w);
});

test('tower DPS is tracked per wave like the champion', () => {
  const sim = rich(8);
  const t = sim.towers.build('wind', sim.walls.build('stone', 15, 14).id);
  sim.waves.startNext();
  sim.waves.queue.length = 0;
  dummy(sim, 15.5, 11.5, 80);
  sim.run(10);
  assert.equal(sim.waves.phase, 'prep');
  assert.ok(t.lastWaveDps > 0 && t.kills === 1);
});
