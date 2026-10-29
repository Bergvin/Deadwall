import test from 'node:test';
import assert from 'node:assert/strict';
import * as CFG from '../../src-classic/config/game.js';
import { Simulation } from '../../src-classic/core/simulation.js';
import { RARITIES, HERO_ABILITIES, WEAPON_STYLES, AFFIXES } from '../../src-classic/config/game.js';
import { makeItem, rollItem, rollAbilityOffer, heroMods, lootOdds, itemLines } from '../../src-classic/core/heroBuild.js';
import { createRng } from '../../src-classic/core/rng.js';
import { buildBlock } from './helpers.js';

const seq = (seed) => { const r = createRng(seed); return () => r.next(); };

/** Hero of `style` on a 2x2 block at (15..16, 14..15), auto-cast off. */
function setup(style = 'archer', seed = 200) {
  const sim = new Simulation({ seed });
  sim.economy.earn(100000);
  const wall = buildBlock(sim, 15, 14);
  const hero = sim.heroes.recruitChampion(style);
  sim.heroes.deploy(hero.id, wall.id);
  hero.autoCast = false;
  return { sim, hero, wall };
}

/** A walker that stands still (long stun) with lots of HP. */
function dummy(sim, x, z, hp = 1e6) {
  const zb = sim.zombies.spawn('walker', x, z);
  zb.hp = zb.maxHp = hp;
  sim.zombies.applyStun(zb, 1e6);
  return zb;
}

const hit = (z) => z.hp < z.maxHp;

test('the hero starts with a common weapon of its style and no abilities', () => {
  const { hero } = setup('warrior');
  assert.equal(hero.weapon.rarity, 'common');
  assert.equal(hero.weapon.style, 'warrior');
  assert.deepEqual(hero.abilities, {});
  assert.deepEqual(Object.keys(hero.stats.actives), []);
  assert.equal(hero.stats.delivery, 'melee');
});

test('each level gives a pick of three; picks only happen between waves; ranks stack', () => {
  const { sim, hero } = setup('archer');
  sim.heroes.addXp(hero, sim.heroes.xpToNext(hero) + sim.heroes.xpToNext({ level: 2 }) + 1);
  assert.ok(hero.pendingPicks >= 2);
  const offer = sim.heroes.abilityOffer(hero.id);
  assert.equal(offer.length, 3);
  assert.equal(new Set(offer.map((o) => o.id)).size, 3);
  assert.equal(sim.heroes.abilityOffer(hero.id), offer, 'the offer is rolled once');
  sim.waves.startNext();
  assert.equal(sim.heroes.chooseAbility(hero.id, 0), null, 'not during a wave');
  for (const z of sim.zombies.list) sim.zombies.damage(z, 1e9);
  sim.waves.queue.length = 0;
  sim.waves.step(0.1);
  const picks = hero.pendingPicks;
  const chosen = sim.heroes.chooseAbility(hero.id, 1);
  assert.equal(chosen.id, offer[1].id);
  assert.equal(hero.abilities[chosen.id], 1);
  assert.equal(hero.pendingPicks, picks - 1);
  sim.heroes.grantAbility(hero.id, 'whetstone', 3);
  const dmg = hero.stats.damage;
  sim.heroes.grantAbility(hero.id, 'whetstone', 4);
  assert.ok(hero.stats.damage > dmg, 'higher rank, more damage');
});

test('offers respect weapon delivery, requirements and max ranks; synergies are likelier', () => {
  const rnd = seq(9);
  const melee = { level: 10, type: 'warrior', weapon: makeItem(CFG, { slot: 'weapon', style: 'warrior', rarity: 'common' }), gear: {}, abilities: {} };
  for (let i = 0; i < 300; i++) {
    for (const o of rollAbilityOffer(CFG, melee, rnd)) {
      const a = HERO_ABILITIES[o.id];
      assert.ok(!a.delivery || a.delivery === 'melee', `${o.id} offered to a sword`);
      assert.ok(!a.requires || a.requires === 'melee', `${o.id} needs ${a.requires}`);
    }
  }
  const capped = { ...melee, abilities: { whetstone: HERO_ABILITIES.whetstone.maxRank } };
  for (let i = 0; i < 300; i++) assert.ok(!rollAbilityOffer(CFG, capped, rnd).some((o) => o.id === 'whetstone'));
  const firey = { ...melee, abilities: { emberTips: 1 } };
  let fireOffers = 0, plainOffers = 0;
  for (let i = 0; i < 2000; i++) {
    fireOffers += rollAbilityOffer(CFG, firey, rnd).filter((o) => HERO_ABILITIES[o.id].tags.includes('fire')).length;
    plainOffers += rollAbilityOffer(CFG, melee, rnd).filter((o) => HERO_ABILITIES[o.id].tags.includes('fire')).length;
  }
  assert.ok(fireOffers > plainOffers * 1.5, `fire synergy ${fireOffers} vs ${plainOffers}`);
});

test('items: rarity scales damage and affixes; legendary weapons grant an ability', () => {
  const rnd = seq(4);
  for (const r of RARITIES) {
    for (let i = 0; i < 30; i++) {
      const it = rollItem(CFG, 10, rnd);
      assert.ok(it.name && itemLines(CFG, it).length >= (it.slot === 'trinket' ? 1 : 0));
      for (const a of it.affixes) {
        assert.ok(AFFIXES[a.id].slots.includes(it.slot));
        if (AFFIXES[a.id].delivery) assert.equal(AFFIXES[a.id].delivery, WEAPON_STYLES[it.style].delivery);
      }
    }
    const w = makeItem(CFG, { slot: 'weapon', style: 'archer', rarity: r, rnd });
    assert.equal(w.affixes.length, CFG.ITEM_RARITY.affixes[RARITIES.indexOf(r)]);
    if (RARITIES.indexOf(r) >= CFG.ITEM_RARITY.grantsAbilityFrom) assert.ok(HERO_ABILITIES[w.grants], `${r} weapon grants`);
  }
  assert.ok(lootOdds(CFG, 30).legendary > lootOdds(CFG, 1).legendary * 5, 'deeper waves drop better loot');
});

test('equipment changes only between waves; a new weapon style changes how the hero fights', () => {
  const { sim, hero } = setup('archer');
  const sword = makeItem(CFG, { slot: 'weapon', style: 'warrior', rarity: 'rare', affixes: [] });
  const armor = makeItem(CFG, { slot: 'armor', rarity: 'epic', affixes: [] });
  sim.heroes.addLoot(sword);
  sim.heroes.addLoot(armor);
  assert.equal(hero.bag.length, 2);
  sim.waves.startNext();
  assert.equal(sim.heroes.equipItem(hero.id, sword.uid), false, 'not during a wave');
  sim.waves.phase = 'prep';
  const hp = hero.maxHp;
  assert.ok(sim.heroes.equipItem(hero.id, armor.uid));
  assert.ok(hero.maxHp > hp && hero.stats.damageReduction > 0);
  const changed = [];
  sim.events.on('heroWeaponChanged', (h) => changed.push(h.type));
  assert.ok(sim.heroes.equipItem(hero.id, sword.uid));
  assert.equal(hero.type, 'warrior');
  assert.equal(hero.stats.delivery, 'melee');
  assert.deepEqual(changed, ['warrior']);
  assert.ok(hero.bag.some((x) => x.style === 'archer'), 'the old bow went back into the bag');
  const gold = sim.economy.gold;
  assert.ok(sim.heroes.sellItem(hero.id, hero.bag[0].uid) > 0);
  assert.ok(sim.economy.gold > gold);
});

test('a full bag sells new drops; elites and bosses drop loot during a run', () => {
  const { sim, hero } = setup('archer');
  for (let i = 0; i < CFG.LOOT.bagSize; i++) sim.heroes.addLoot(makeItem(CFG, { slot: 'trinket', rarity: 'common' }));
  const gold = sim.economy.gold;
  assert.equal(sim.heroes.addLoot(makeItem(CFG, { slot: 'trinket', rarity: 'rare' })).stored, false);
  assert.ok(sim.economy.gold > gold);
  hero.bag.length = 0;
  const drops = [];
  sim.events.on('lootDropped', (d) => drops.push(d));
  const boss = sim.zombies.spawn('behemoth', 10.5, 5.5);
  sim.zombies.damage(boss, 1e9);
  assert.equal(drops.length, CFG.LOOT.bossDrops, 'a boss always drops');
  assert.equal(hero.bag.length, CFG.LOOT.bossDrops);
});

test('ricochet bounces one shot through several enemies; split shot bursts into shards', () => {
  const { sim, hero } = setup('archer');
  sim.heroes.grantAbility(hero.id, 'ricochet', 2);
  const row = [13, 14.5, 16, 17.5].map((x) => dummy(sim, x, 11));
  sim.heroes.setTargeting(hero.id, 'nearest');
  hero.cooldown = 0;
  hero.stats.attackInterval = 999; // exactly one basic attack
  sim.run(3);
  assert.ok(row.filter(hit).length >= 4, `bounced to ${row.filter(hit).length}`);

  const s2 = setup('archer', 201);
  s2.sim.heroes.grantAbility(s2.hero.id, 'splitShot', 1);
  const target = dummy(s2.sim, 15.5, 10);
  const ring = [[14, 9], [17, 9], [15.5, 8]].map(([x, z]) => dummy(s2.sim, x, z));
  s2.hero.stats.attackInterval = 999;
  s2.sim.heroes.setTargeting(s2.hero.id, 'nearest');
  s2.sim.run(3);
  assert.ok(hit(target) && ring.filter(hit).length >= 2, 'shards hit the neighbours');
});

test('extra projectiles hit other enemies; pierce goes through a line', () => {
  const { sim, hero } = setup('archer');
  sim.heroes.grantAbility(hero.id, 'steelStorm', 1);
  hero.stats.attackInterval = 999;
  const spread = [12, 14, 16, 18].map((x) => dummy(sim, x, 10.5));
  sim.run(2);
  assert.ok(spread.filter(hit).length >= 4);
  const p = setup('crossbowman', 202);
  p.sim.heroes.grantAbility(p.hero.id, 'piercingShots', 3);
  p.hero.stats.attackInterval = 999;
  const line = [12, 10, 8].map((z) => dummy(p.sim, 15.9, z));
  p.sim.run(2);
  assert.ok(line.filter(hit).length >= 3);
});

test("titan's reach lets a sword hit far away; whirlwind hurls enemies away from the gate", () => {
  const { sim, hero } = setup('warrior');
  const far = dummy(sim, 16, 10.6);
  sim.run(2);
  assert.ok(!hit(far), 'out of normal sword reach');
  sim.heroes.grantAbility(hero.id, 'titansReach', 1);
  sim.run(2);
  assert.ok(hit(far), 'reached with Titan\'s Reach');

  const w = setup('warrior', 203);
  w.sim.heroes.grantAbility(w.hero.id, 'whirlwind', 3);
  const pack = [[15.6, 12.6], [16.4, 12.8], [15.2, 12.9]].map(([x, z]) => w.sim.zombies.spawn('walker', x, z));
  for (const z of pack) { z.hp = z.maxHp = 1e6; }
  let flew = 0;
  w.sim.events.on('zombiePushed', ({ lift }) => { if (lift > 0) flew++; });
  w.sim.run(0.6);
  assert.ok(flew >= 3, 'thrown into the air');
  assert.ok(pack.every((z) => z.z < 12.4), 'and away from the gate (north)');
});

test('physics: knockback, flight over walls, landing safely, fall damage, bosses resist', () => {
  const sim = new Simulation({ seed: 7 });
  for (let x = 5; x <= 15; x++) sim.walls.build('stone', x, 10);
  const z = sim.zombies.spawn('walker', 10.5, 11.5);
  z.hp = z.maxHp = 1000;
  sim.zombies.push(z, 0, -1, 3, 9);
  const landed = [];
  sim.events.on('zombieLanded', (e) => landed.push(e));
  for (let t = 0; t < 3; t += 1 / 60) sim.zombies.step(1 / 60);
  assert.ok(z.z < 10, 'flew over the wall');
  assert.equal(landed.length, 1);
  assert.ok(z.hp < z.maxHp, 'a high fall hurts');
  assert.ok(!sim.walls.at(Math.floor(z.x), Math.floor(z.z)), 'never lands inside a wall');
  const boss = sim.zombies.spawn('behemoth', 20.5, 8.5);
  const walker = sim.zombies.spawn('walker', 22.5, 8.5);
  sim.zombies.push(boss, 1, 0, 5);
  sim.zombies.push(walker, 1, 0, 5);
  assert.ok(Math.abs(boss.vx) < Math.abs(walker.vx) * 0.5, 'bosses resist');
});

test('zombies push each other apart instead of overlapping', () => {
  const sim = new Simulation({ seed: 8 });
  const a = sim.zombies.spawn('walker', 10.5, 8.5);
  const b = sim.zombies.spawn('walker', 10.5, 8.5);
  sim.zombies.applyStun(a, 99); sim.zombies.applyStun(b, 99);
  for (let i = 0; i < 30; i++) sim.zombies.step(1 / 60);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= (a.radius + b.radius) * 0.9);
});

test('on-hit effects: burn, poison, slow, chain lightning; execute and shatter bonuses', () => {
  const { sim, hero } = setup('archer');
  for (const [id, r] of [['emberTips', 1], ['venom', 1], ['frostbite', 1], ['thunderlord', 1], ['chainSpark', 3]]) sim.heroes.grantAbility(hero.id, id, r);
  const main = dummy(sim, 15.5, 11);
  const side = [dummy(sim, 16.5, 10.5), dummy(sim, 14.5, 10.5)];
  hero.stats.attackInterval = 999;
  sim.run(1.5);
  assert.ok(main.dots.some((d) => d.type === 'fire') && main.dots.some((d) => d.type === 'poison'));
  assert.ok(main.slowUntil > sim.zombies.time);
  assert.ok(side.every(hit), 'lightning arcs');
  const s = hero.stats;
  const low = dummy(sim, 12, 12, 1000); low.hp = 300;
  const v = dummy(sim, 12, 13, 1000);
  sim.zombies.applySlow(v, 0.5, 99);
  sim.heroes.grantAbility(hero.id, 'executioner', 3);
  sim.heroes.grantAbility(hero.id, 'shatter', 3);
  sim.combat.applyPayload(hero.id, { damage: 50, type: 'holy', hero }, low, low.x, low.z);
  sim.combat.applyPayload(hero.id, { damage: 50, type: 'holy', hero }, v, v.x, v.z);
  assert.ok(300 - low.hp > 50 * 2, 'execute bonus');
  assert.ok(1000 - v.hp > 50 * 2, 'shatter bonus on a slowed enemy');
  assert.ok(s.chainChance === 1);
});

test('corpse explosions chain through a pack; phoenix saves the hero once per wave', () => {
  const { sim, hero } = setup('archer');
  sim.heroes.grantAbility(hero.id, 'corpseBlast', 3);
  // A big corpse kills the two closest; their own (smaller) blasts reach the last one.
  const pack = [[10, 8, 1000], [10.8, 8, 150], [11.6, 8, 150], [12.4, 8, 150]].map(([x, z, hp]) => dummy(sim, x, z, hp));
  sim.zombies.damage(pack[0], 1e9, hero.id);
  assert.ok(!pack[1].alive && !pack[2].alive, 'the first blast killed its neighbours');
  assert.ok(hit(pack[3]), 'and their blasts reached the next one: a chain reaction');

  sim.heroes.grantAbility(hero.id, 'phoenix', 1);
  let rose = 0;
  sim.events.on('heroPhoenix', () => rose++);
  sim.heroes.damageHero(hero, hero.maxHp * 5);
  assert.equal(rose, 1);
  assert.ok(!hero.fallen && hero.hp === hero.maxHp);
  sim.heroes.damageHero(hero, hero.maxHp * 5);
  assert.ok(hero.fallen, 'only once per wave');
});

test('the build reads weapon, gear and abilities together', () => {
  const hero = {
    type: 'archer', level: 1,
    weapon: makeItem(CFG, { slot: 'weapon', style: 'archer', rarity: 'epic', affixes: [{ id: 'bounce', value: 1 }] }),
    gear: { trinket: makeItem(CFG, { slot: 'trinket', rarity: 'rare', affixes: [{ id: 'damagePct', value: 22 }] }) },
    abilities: { ricochet: 1, fireball: 2 },
  };
  const m = heroMods(CFG, hero);
  assert.equal(m.bounce, 3);
  assert.equal(m.damagePct, 22);
  assert.equal(m.actives.fireball, 2);
  assert.equal(m.weaponDamageMult, CFG.ITEM_RARITY.weaponDamage[3]);
});
