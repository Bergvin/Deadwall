import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/core/simulation.js';
import { HEROES, HERO_RULES } from '../src/config/game.js';
import { heroStats } from '../src/core/heroStats.js';

const DT = 1 / 60;

/** A sim with lots of gold, one wall at (15, 14) and a hero of `type` on it. */
function setup(type, { level = 1 } = {}) {
  const sim = new Simulation({ seed: 100 });
  sim.economy.earn(100000);
  const wall = sim.walls.build('stone', 15, 14);
  const hero = sim.heroes.recruit(type);
  sim.heroes.deploy(hero.id, wall.id);
  while (hero.level < level) sim.heroes.addXp(hero, sim.heroes.xpToNext(hero));
  return { sim, wall, hero };
}

/** Spawns a stationary (stunned for a long time) walker at cell-centre coordinates. */
function dummy(sim, x, z, hp = 1000) {
  const zb = sim.zombies.spawn('walker', x, z);
  zb.hp = zb.maxHp = hp;
  sim.zombies.applyStun(zb, 1e6);
  return zb;
}

for (const type of Object.keys(HEROES)) {
  test(`${type}: basic attack damages a zombie in range`, () => {
    const { sim, hero } = setup(type);
    const melee = HEROES[type].attack.kind === 'melee';
    const z = dummy(sim, 15.5, melee ? 13.2 : 11);
    sim.run(4);
    assert.ok(z.hp < z.maxHp, `${type} dealt damage`);
    assert.equal(hero.targetId, z.id);
  });

  test(`${type}: every ability works, respects unlock level and cooldown`, () => {
    const { sim, hero, wall } = setup(type, { level: HERO_RULES.maxLevel });
    for (const [id, a] of Object.entries(HEROES[type].abilities)) {
      const z = dummy(sim, 15.5, 12.5, 1e7);
      const target = a.target === 'point' ? { x: z.x, z: z.z }
        : a.target === 'enemy' ? { zombieId: z.id }
          : a.target === 'wall' ? { wallId: wall.id } : null;
      const res = sim.combat.use(hero.id, id, target);
      assert.ok(res.ok, `${type}.${id}: ${res.reason}`);
      assert.ok(hero.abilityCooldowns[id] > 0, 'cooldown started');
      assert.equal(sim.combat.canUse(hero.id, id, target).reason, 'cooldown');
      const cd = hero.abilityCooldowns[id];
      sim.run(cd + 0.1);
      assert.ok(sim.combat.canUse(hero.id, id, target).ok, 'usable again after cooldown');
    }
  });
}

test('abilities are locked until their unlock level', () => {
  const { sim, hero } = setup('mage');
  assert.equal(sim.combat.canUse(hero.id, 'arcaneBlast', { x: 15.5, z: 12 }).reason, 'locked');
  assert.ok(sim.combat.canUse(hero.id, 'fireball', { x: 15.5, z: 12 }).ok);
});

test('abilities: out of range and undeployed heroes are rejected', () => {
  const { sim, hero } = setup('mage', { level: 5 });
  assert.equal(sim.combat.canUse(hero.id, 'fireball', { x: 15.5, z: 0.5 }).reason, 'out_of_range');
  const reserve = sim.heroes.recruit('mage');
  assert.equal(sim.combat.canUse(reserve.id, 'frostNova').reason, 'not_deployed');
});

test('multishot hits several enemies; piercing arrow hits a whole line', () => {
  const { sim, hero } = setup('archer', { level: 3 });
  const row = [0, 1, 2, 3].map((i) => dummy(sim, 12.5 + i * 2, 11));
  sim.combat.use(hero.id, 'multishot');
  sim.run(1.5);
  assert.ok(row.filter((z) => z.hp < z.maxHp).length >= 4);
  const line = [9, 10, 11].map((zz) => dummy(sim, 15.5, zz));
  sim.combat.use(hero.id, 'piercing', { x: 15.5, z: 9 });
  sim.run(1);
  assert.ok(line.every((z) => z.hp < z.maxHp), 'all three in the line were hit');
});

test('fireball burns an area; frost nova slows; arcane blast hits hard', () => {
  const { sim, hero } = setup('mage', { level: 4 });
  const pack = [dummy(sim, 15.5, 11), dummy(sim, 16.3, 11.4), dummy(sim, 14.8, 10.6)];
  sim.combat.use(hero.id, 'fireball', { x: 15.5, z: 11 });
  sim.run(1.2);
  assert.ok(pack.every((z) => z.hp < z.maxHp));
  assert.ok(pack.some((z) => z.dots.some((d) => d.type === 'fire')), 'burning');
  const near = dummy(sim, 15.5, 12.5);
  sim.combat.use(hero.id, 'frostNova');
  assert.ok(near.slowUntil > sim.zombies.time && near.slowFactor < 1);
  const big = dummy(sim, 15.5, 10.5, 5000);
  sim.combat.use(hero.id, 'arcaneBlast', { x: 15.5, z: 10.5 });
  assert.ok(5000 - big.hp >= HEROES.mage.abilities.arcaneBlast.damage * 0.99);
});

test('shield bash stuns; stunned zombies do not move or attack', () => {
  const { sim, hero } = setup('warrior');
  const z = sim.zombies.spawn('walker', 15.5, 13.3);
  sim.combat.use(hero.id, 'shieldBash');
  assert.ok(z.stunUntil > sim.zombies.time);
  const pos = [z.x, z.z];
  sim.run(1);
  assert.deepEqual([z.x, z.z], pos);
});

test('warrior guard and rally reduce wall damage; paladin mends walls', () => {
  const plain = new Simulation({ seed: 1 });
  const pw = plain.walls.build('stone', 10, 10);
  plain.walls.damage(pw.id, 100);
  const { sim, wall, hero } = setup('warrior', { level: 2 });
  sim.walls.damage(wall.id, 100);
  const guarded = wall.maxHp - wall.hp;
  assert.ok(guarded < 100 - 1, `guard reduced damage (${guarded})`);
  sim.combat.use(hero.id, 'rally');
  const before = wall.hp;
  sim.walls.damage(wall.id, 100);
  assert.ok(before - wall.hp < guarded * 0.6, 'rally halves it again');

  const p = setup('paladin');
  p.sim.walls.damage(p.wall.id, 120);
  const hp = p.wall.hp;
  p.sim.run(5);
  assert.ok(p.wall.hp > hp, 'paladin mended the wall');
  assert.ok(p.wall.hp <= p.wall.maxHp);
});

test('holy shield protects a wall and its neighbours; consecration damages over time', () => {
  const { sim, hero, wall } = setup('paladin', { level: 2 });
  const side = sim.walls.build('stone', 16, 14);
  sim.combat.use(hero.id, 'holyShield', { wallId: wall.id });
  const before = side.hp;
  sim.walls.damage(side.id, 100);
  assert.ok(before - side.hp <= 31, 'neighbour shielded');
  const z = dummy(sim, 15.5, 12.5);
  sim.combat.use(hero.id, 'consecration', { x: 15.5, z: 12.5 });
  sim.run(3);
  assert.ok(z.hp < z.maxHp);
});

test('crossbow armor-piercing bolt ignores armor', () => {
  const { sim, hero } = setup('crossbowman');
  const z = dummy(sim, 15.5, 11, 5000);
  z.armor = 0.6;
  sim.combat.use(hero.id, 'apBolt', { zombieId: z.id });
  sim.run(0.6);
  const expected = hero.stats.damage * HEROES.crossbowman.abilities.apBolt.damageMult;
  assert.ok(5000 - z.hp >= expected * 0.99, `${5000 - z.hp} >= ${expected}`);
});

test('alchemist poison cloud and explosive mixture', () => {
  const { sim, hero } = setup('alchemist', { level: 2 });
  const a = dummy(sim, 15.5, 11.5);
  sim.combat.use(hero.id, 'toxicFlask', { x: 15.5, z: 11.5 });
  sim.run(3);
  assert.ok(a.hp < a.maxHp && sim.zones.list.length === 1);
  const b = dummy(sim, 14.5, 11, 5000);
  sim.combat.use(hero.id, 'explosiveMixture', { x: 14.5, z: 11 });
  sim.run(1.5);
  assert.ok(5000 - b.hp >= 80);
});

test('armor and resist mitigate physical and magic damage; holy ignores resist', () => {
  const sim = new Simulation({ seed: 3 });
  const z = dummy(sim, 5, 5, 10000);
  z.armor = 0.5; z.resist = 0.5;
  assert.equal(sim.zombies.damage(z, 100, 0, { type: 'physical' }), 50);
  assert.equal(sim.zombies.damage(z, 100, 0, { type: 'physical', armorPen: 0.3 }), 80);
  assert.equal(sim.zombies.damage(z, 100, 0, { type: 'magic' }), 50);
  assert.equal(sim.zombies.damage(z, 100, 0, { type: 'holy' }), 100);
});

test('levelling raises class stats and restores health', () => {
  const sim = new Simulation({ seed: 4 });
  const h = sim.heroes.recruit('warrior');
  const before = { ...h.stats };
  let ups = 0;
  sim.events.on('heroLevelUp', () => ups++);
  sim.heroes.addXp(h, sim.heroes.xpToNext(h) * 3);
  assert.ok(h.level >= 2 && ups === h.level - 1);
  assert.ok(h.stats.maxHp > before.maxHp && h.stats.damage > before.damage);
  sim.heroes.addXp(h, 1e9);
  assert.equal(h.level, HERO_RULES.maxLevel, 'capped');
});

test('talents: need level and gold, exclude the other option, change behaviour', () => {
  const sim = new Simulation({ seed: 5 });
  sim.economy.earn(5000);
  const h = sim.heroes.recruit('archer');
  assert.equal(sim.heroes.canBuyTalent(h.id, 0, 'rapidDraw').reason, 'level_too_low');
  while (h.level < 3) sim.heroes.addXp(h, sim.heroes.xpToNext(h));
  const projected = heroStats(HEROES.archer, h.level, [...h.talents, 'rapidDraw']);
  assert.ok(sim.heroes.buyTalent(h.id, 0, 'rapidDraw'));
  assert.equal(h.stats.attackInterval, projected.attackInterval);
  assert.equal(sim.heroes.canBuyTalent(h.id, 0, 'piercingShafts').reason, 'tier_taken');
  const g = sim.economy.gold;
  sim.economy.trySpend(g);
  while (h.level < 5) sim.heroes.addXp(h, sim.heroes.xpToNext(h));
  assert.equal(sim.heroes.canBuyTalent(h.id, 1, 'volley').reason, 'insufficient_gold');
});

test('dismissing an upgraded hero never returns more than was spent', () => {
  const sim = new Simulation({ seed: 6 });
  sim.economy.earn(1000);
  const start = sim.economy.gold;
  const h = sim.heroes.recruit('archer');
  while (h.level < 3) sim.heroes.addXp(h, sim.heroes.xpToNext(h));
  sim.heroes.buyTalent(h.id, 0, 'rapidDraw');
  sim.heroes.dismiss(h.id);
  assert.ok(sim.economy.gold < start);
});

test('targeting preference: strongest picks the healthiest zombie', () => {
  const { sim, hero } = setup('archer');
  const weak = dummy(sim, 14.5, 11, 50);
  const strong = dummy(sim, 16.5, 11, 900);
  sim.heroes.setTargeting(hero.id, 'strongest');
  assert.equal(sim.heroes.pickTarget(hero, { x: 15.5, z: 14.5 }), strong);
  sim.heroes.setTargeting(hero.id, 'weakest');
  assert.equal(sim.heroes.pickTarget(hero, { x: 15.5, z: 14.5 }), weak);
});

test('cooldowns follow simulation time only (pause-safe, speed-consistent)', () => {
  const run = (stepsPerSecond) => {
    const { sim, hero } = setup('warrior');
    sim.combat.use(hero.id, 'shieldBash');
    sim.run(4, 1 / stepsPerSecond);
    return hero.abilityCooldowns.shieldBash;
  };
  const a = run(60), b = run(30);
  assert.ok(Math.abs(a - b) < 0.05, `${a} vs ${b}`);
});
