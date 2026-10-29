import test from 'node:test';
import assert from 'node:assert/strict';
import * as CFG from '../src/config/game.js';
import { Simulation } from '../src/core/simulation.js';
import { buildMap, TERRAIN } from '../src/core/grid.js';
import { pointAt } from '../src/core/paths.js';
import { towerStats } from '../src/core/towers.js';
import { applyBonuses } from '../src/core/commander.js';

const fresh = (opts = {}) => {
  const sim = new Simulation({ seed: 7, ...opts });
  sim.economy.earn(100000);
  return sim;
};
/** Buildable cell closest to a point on road 0 at distance s. */
const besideRoad = (sim, s, pathId = 0) => {
  const p = pointAt(sim.paths[pathId], s);
  let best = null, bd = Infinity;
  for (let y = 0; y < sim.grid.height; y++) {
    for (let x = 0; x < sim.grid.width; x++) {
      if (!sim.grid.isBuildable(x, y)) continue;
      const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.z);
      if (d < bd) { bd = d; best = { x, y }; }
    }
  }
  return best;
};

test('maps: roads start at the edge, end at the house, and leave ground to build on', () => {
  for (const map of CFG.MAPS) {
    const { grid, paths, house } = buildMap(map, CFG.MAP_RULES);
    for (const p of paths) {
      const a = p.points[0], b = p.points[p.points.length - 1];
      assert.ok(a.x <= 0 || a.z <= 0 || a.x >= grid.width || a.z >= grid.height, `${map.id}: road starts at the edge`);
      assert.ok(Math.abs(b.x - house.x) <= 1.7 && Math.abs(b.z - house.z) <= 1.7, `${map.id}: road ends at the house`);
      // The road itself is never blocked.
      for (let s = 0; s < p.length; s += 0.5) {
        const q = pointAt(p, s);
        const cx = Math.floor(q.x), cy = Math.floor(q.z);
        if (!grid.inBounds(cx, cy)) continue;
        assert.ok([TERRAIN.ROAD, TERRAIN.HOUSE].includes(grid.terrainAt(cx, cy)), `${map.id}: road cell ${cx},${cy} is open`);
      }
    }
    let buildable = 0;
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) if (grid.isBuildable(x, y)) buildable++;
    assert.ok(buildable > 200, `${map.id}: room for towers`);
    assert.equal(house.cells.length, 4);
  }
});

test('zombies walk the road to the house and break in; a fallen house ends the run', () => {
  const sim = fresh();
  const gold = sim.economy.gold;
  const z = sim.zombies.spawn('runner', 0);
  let over = null, leaked = 0;
  sim.events.on('gameOver', (s) => { over = s; });
  sim.events.on('zombieLeaked', () => leaked++);
  let atDoor = false;
  for (let i = 0; i < 60 * 60 && z.alive; i++) {
    sim.step(1 / 60);
    if (z.state === 'attackHouse') atDoor = true;
  }
  assert.ok(atDoor, 'it reached the door');
  assert.equal(leaked, 1);
  assert.equal(z.alive, false);
  assert.equal(sim.house.hp, sim.house.maxHp - CFG.ZOMBIES.runner.damage);
  assert.equal(sim.economy.gold, gold, 'no bounty for a zombie that got through');
  const end = sim.paths[0].points.at(-1);
  assert.ok(Math.hypot(z.x - end.x, z.z - end.z) < 1.2, 'it broke in at the end of the road');
  sim.house.damage(1e9);
  assert.ok(sim.over && over && over.map === 'oldroad');
});

test('towers: only on free ground, limited slots that grow with the waves, selling frees a slot', () => {
  const sim = fresh();
  const road = pointAt(sim.paths[0], 5);
  assert.equal(sim.towers.build('arrow', Math.floor(road.x), Math.floor(road.z)), null, 'not on the road');
  const h = sim.house.cells[0];
  assert.equal(sim.towers.build('arrow', h.x, h.y), null, 'not on the house');
  const cells = [];
  for (let y = 0; y < 24 && cells.length < 12; y++) for (let x = 0; x < 30 && cells.length < 12; x++) if (sim.grid.isBuildable(x, y)) cells.push({ x, y });
  const built = cells.map((c) => sim.towers.build('arrow', c.x, c.y)).filter(Boolean);
  assert.equal(built.length, CFG.TOWER_RULES.baseSlots);
  assert.equal(sim.towers.build('arrow', cells[0].x, cells[0].y), null, 'one tower per cell');
  sim.towers.sell(built[0].id);
  assert.ok(sim.towers.build('fire', cells[0].x, cells[0].y), 'the sold slot is free again');
  sim.waves.wave = CFG.TOWER_RULES.slotWaves[0];
  assert.equal(sim.towers.slots, CFG.TOWER_RULES.baseSlots + 1);
  sim.waves.wave = 999;
  assert.equal(sim.towers.slots, CFG.TOWER_RULES.maxSlots);
});

test('upgrades: expensive, stronger every level, a specialisation at the spec level', () => {
  const sim = fresh();
  const c = besideRoad(sim, 8);
  const t = sim.towers.build('arrow', c.x, c.y);
  const costs = [];
  while (t.level < CFG.TOWER_RULES.specLevel - 1) { costs.push(sim.towers.upgradeCost(t.id)); assert.ok(sim.towers.upgrade(t.id)); }
  for (let i = 1; i < costs.length; i++) assert.ok(costs[i] > costs[i - 1] * 1.3, 'each level costs a lot more');
  assert.ok(sim.towers.needsSpec(t.id));
  assert.equal(sim.towers.upgrade(t.id), false, 'needs a specialisation');
  assert.ok(sim.towers.upgrade(t.id, 'a'));
  assert.equal(t.spec, 'a');
  assert.equal(t.stats.targets, 3, 'Volley shoots three');
  while (t.level < CFG.TOWER_RULES.maxLevel) assert.ok(sim.towers.upgrade(t.id));
  assert.equal(sim.towers.upgrade(t.id), false);
  const s1 = towerStats(CFG.TOWERS.arrow, 1, null, CFG.TOWER_RULES), s10 = towerStats(CFG.TOWERS.arrow, 10, 'b', CFG.TOWER_RULES);
  assert.ok(s10.damage > s1.damage * 15 && s10.range > s1.range + 3 && s10.maxAmmo > s1.maxAmmo);
  // Every tower type has two specialisations that change something.
  for (const [k, type] of Object.entries(CFG.TOWERS)) {
    const a = towerStats(type, 5, 'a', CFG.TOWER_RULES), b = towerStats(type, 5, 'b', CFG.TOWER_RULES), n = towerStats(type, 5, null, CFG.TOWER_RULES);
    assert.notDeepEqual(a, n, `${k} a`);
    assert.notDeepEqual(b, n, `${k} b`);
  }
});

test('ammo: a tower stops when empty and the runner brings a crate', () => {
  const sim = fresh();
  const c = besideRoad(sim, 6);
  const t = sim.towers.build('arrow', c.x, c.y);
  t.ammo = 2;
  let empty = 0, refilled = 0;
  sim.events.on('towerEmpty', () => empty++);
  sim.events.on('towerRefilled', () => refilled++);
  for (let i = 0; i < 6; i++) sim.zombies.spawn('walker', 0, 50, { s: 4 + i * 0.3 });
  sim.run(3);
  assert.ok(t.ammo < 1 || refilled, 'it shot its last arrows');
  sim.run(20);
  assert.ok(empty >= 1);
  assert.ok(refilled >= 1, 'the runner came');
  assert.ok(t.ammo > 2);
  assert.ok(sim.runner.main.crates < CFG.RUNNER.crates || sim.runner.stats.refills > 0);
});

test('runner: goes home for crates, follows orders first, gets knocked over by zombies', () => {
  const sim = fresh();
  const a = sim.towers.build('arrow', besideRoad(sim, 6).x, besideRoad(sim, 6).y);
  const b = sim.towers.build('frost', besideRoad(sim, 30).x, besideRoad(sim, 30).y);
  a.ammo = 0; b.ammo = b.stats.maxAmmo - 1;
  sim.runner.orderRefill(b.id);
  const order = [];
  sim.events.on('towerRefilled', ({ tower }) => order.push(tower.id));
  sim.run(40);
  assert.equal(order[0], b.id, 'the ordered tower first');
  assert.ok(order.includes(a.id), 'then the empty one');
  // Out of crates: he goes home.
  const u = sim.runner.main;
  u.crates = 0;
  let reloaded = 0;
  sim.events.on('runnerReloaded', () => reloaded++);
  sim.run(25);
  assert.ok(reloaded >= 1);
  // A zombie walking into him knocks him over.
  const z = sim.zombies.spawn('walker', 0, 50);
  u.x = z.x; u.z = z.z;
  let bonked = 0;
  sim.events.on('runnerBonked', () => bonked++);
  sim.run(0.1);
  assert.equal(bonked, 1);
  assert.equal(u.state, 'bonked');
  sim.run(CFG.RUNNER.bonkTime + 0.2);
  assert.notEqual(u.state, 'bonked');
});

test('spells: buffs reach only towers near the runner; banana peels trip the dead', () => {
  const sim = fresh();
  const u = sim.runner.main;
  const near = sim.towers.build('arrow', besideRoad(sim, 50).x, besideRoad(sim, 50).y);
  const far = sim.towers.build('arrow', besideRoad(sim, 5).x, besideRoad(sim, 5).y);
  u.x = near.cx + 0.5; u.z = near.cz;
  assert.ok(sim.runner.cast('pepTalk'));
  assert.equal(sim.towers.modsOf(near).attackSpeedPct, CFG.SPELLS.pepTalk.buff.attackSpeedPct);
  assert.equal(sim.towers.modsOf(far).attackSpeedPct, 0);
  assert.equal(sim.runner.cast('pepTalk'), false, 'on cooldown');
  // Learning a spell, ranking it up.
  sim.runner.grant('learnBanana');
  sim.runner.grant('learnBanana');
  assert.equal(sim.runner.spells.bananaPeel, 2);
  const p = pointAt(sim.paths[0], 20);
  u.x = p.x; u.z = p.z;
  u.immuneUntil = 1e9;
  assert.ok(sim.runner.cast('bananaPeel'));
  const z = sim.zombies.spawn('walker', 0, 50, { s: 18, lane: 0 });
  let slipped = 0;
  sim.events.on('zombieSlipped', () => slipped++);
  sim.run(5);
  assert.equal(slipped, 1);
  assert.ok(z.stunUntil > 0);
  // Tea Break refills, Bottomless Pockets makes shots free.
  sim.runner.grant('learnTea');
  sim.runner.grant('learnBottomless');
  u.x = near.cx + 0.5; u.z = near.cz;
  near.ammo = 0;
  assert.ok(sim.runner.cast('teaBreak'));
  assert.equal(near.ammo, near.stats.maxAmmo);
  assert.ok(sim.runner.cast('bottomless'));
  assert.ok(sim.towers.modsOf(near).freeAmmo);
});

test('runner perks: three distinct picks, only between waves; twin brother adds a runner', () => {
  const sim = fresh();
  const r = sim.runner;
  r.addXp(CFG.RUNNER.xpToNext(1) + CFG.RUNNER.xpToNext(2));
  assert.equal(r.pendingPicks, 2);
  const offer = r.currentOffer();
  assert.equal(new Set(offer).size, 3);
  sim.waves.startNext();
  assert.equal(r.choose(0), false, 'not during a wave');
  for (const z of sim.zombies.list) sim.zombies.damage(z, 1e9);
  sim.waves.queue.length = 0;
  sim.waves.step(0.1);
  assert.ok(r.choose(0));
  assert.equal(r.pendingPicks, 1);
  r.grant('twin');
  assert.equal(r.units.length, 2);
  r.grant('backpack');
  assert.equal(r.maxCrates, CFG.RUNNER.crates + 1);
  // Maxed perks are never offered again.
  for (let i = 0; i < 10; i++) r.grant('sneakers');
  for (let i = 0; i < 50; i++) assert.ok(!r.rollOffer().includes('sneakers'));
});

test('tower smashers drain ammo and jam towers near the road; plague clouds gum towers up', () => {
  const sim = fresh();
  const c = besideRoad(sim, 12);
  const t = sim.towers.build('arrow', c.x, c.y);
  t.ammo = t.stats.maxAmmo;
  const z = sim.zombies.spawn('siege', 0, 50, { s: 10, lane: 0 });
  let smashed = 0;
  sim.events.on('towerSmashed', () => smashed++);
  sim.runner.main.immuneUntil = 1e9;
  sim.run(8);
  assert.ok(smashed >= 1);
  assert.ok(t.ammo < t.stats.maxAmmo, 'ammo spilled');
  assert.ok(z.smashed?.has(t.id) || z.smashTarget === t.id);
  // A dead plague carrier leaves a cloud that slows towers inside it.
  const pz = sim.zombies.spawn('plague', 0, 1, { s: 12, lane: 0 });
  sim.zombies.damage(pz, 1e9);
  assert.ok(sim.zones.list.some((q) => q.kind === 'plague'));
  assert.equal(sim.towers.modsOf(t).gunk, CFG.ZOMBIES.plague.cloud.towerSlow);
});

test('gale pushes the dead back down the road; rolling stones hit everything in a line', () => {
  const sim = fresh();
  const c = besideRoad(sim, 10);
  sim.towers.build('gale', c.x, c.y);
  const z = sim.zombies.spawn('walker', 0, 100, { s: 10.5, lane: 0 });
  let s0 = null;
  sim.events.on('zombiePushed', () => { s0 ??= z.s; });
  sim.run(1.5);
  assert.ok(s0 != null, 'the gust hit');
  sim.run(0.4);
  assert.ok(z.s < s0 - 0.3, 'shoved back');
  const sim2 = fresh();
  const c2 = besideRoad(sim2, 26);
  sim2.towers.build('roller', c2.x, c2.y);
  const line = [];
  for (let i = 0; i < 6; i++) line.push(sim2.zombies.spawn('walker', 0, 100, { s: 23 + i * 0.6, lane: 0 }));
  sim2.run(4);
  assert.ok(line.filter((q) => q.hp < q.maxHp).length >= 3, 'one stone hit several');
});

test('determinism: same seed and actions give the same run', () => {
  const play = () => {
    const sim = new Simulation({ seed: 99, mapId: 'crossroads' });
    sim.towers.build('arrow', 9, 8);
    sim.towers.build('fire', 16, 12);
    sim.waves.startNext();
    sim.run(200);
    return JSON.stringify(sim.summary()) + sim.economy.gold + sim.house.hp;
  };
  assert.equal(play(), play());
});

test('fresh commander on the first map: an idle player loses early, towers hold longer', () => {
  const idle = new Simulation({ seed: 3 });
  idle.run(60 * 6);
  assert.ok(idle.over && idle.summary().wave <= 3, `no towers falls fast (wave ${idle.summary().wave})`);
  const c = applyBonuses(CFG, {}, {});
  const sim = new Simulation({ seed: 3, config: c });
  for (const s of [6, 12, 22, 34]) { const q = besideRoad(sim, s); sim.towers.build('arrow', q.x, q.y); }
  sim.run(60 * 6);
  assert.ok(sim.summary().wave > idle.summary().wave);
});
