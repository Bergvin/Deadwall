import test from 'node:test';
import assert from 'node:assert/strict';
import * as CFG from '../src/config/game.js';
import { RARITIES, PERKS, ARTIFACTS, LOOT_TABLES, COMMANDER } from '../src/config/commander.js';
import {
  commanderDefaults, rollOffer, ensureOffer, choosePerk, addXp, runXp, rollLoot, addArtifact,
  equip, unequip, salvage, slotCount, totalBonuses, applyBonuses, perkValue,
} from '../src/core/commander.js';
import { sanitize, recordRun } from '../src/core/save.js';
import { createRng } from '../src/core/rng.js';
import { Simulation } from '../src/core/simulation.js';

const seq = (seed) => { const r = createRng(seed); return () => r.next(); };

test('level-up offers: three distinct perks, each valid at its rarity', () => {
  const rnd = seq(7);
  for (let i = 0; i < 500; i++) {
    const offer = rollOffer(rnd);
    assert.equal(offer.length, COMMANDER.offerSize);
    assert.equal(new Set(offer.map((o) => o.id)).size, offer.length);
    for (const o of offer) {
      assert.ok(PERKS[o.id]);
      assert.ok(RARITIES.includes(o.rarity));
      assert.notEqual(perkValue(o.id, o.rarity), null);
    }
  }
});

test('rarities: common is by far the most likely, mythical the rarest', () => {
  const rnd = seq(11);
  const count = Object.fromEntries(RARITIES.map((r) => [r, 0]));
  for (let i = 0; i < 4000; i++) for (const o of rollOffer(rnd)) count[o.rarity]++;
  for (let i = 1; i < RARITIES.length; i++) assert.ok(count[RARITIES[i - 1]] > count[RARITIES[i]], JSON.stringify(count));
  assert.ok(count.mythical > 0, 'mythical perks can appear');
});

test('loot: every table favours common; better tables give more top rarities', () => {
  const tally = (table) => {
    const rnd = seq(3);
    const c = Object.fromEntries(RARITIES.map((r) => [r, 0]));
    let drops = 0;
    for (let i = 0; i < 20000; i++) {
      const d = rollLoot(table, rnd);
      if (!d) continue;
      drops++;
      assert.ok(ARTIFACTS[d.id]);
      c[d.rarity]++;
    }
    return { c, drops };
  };
  const minor = tally('minor'), major = tally('major'), mythic = tally('mythic'), boss = tally('boss');
  for (const t of [minor, major, mythic, boss]) {
    for (const r of RARITIES.slice(1)) assert.ok(t.c.common > t.c[r], `${r}: ${JSON.stringify(t.c)}`);
  }
  assert.equal(boss.c.legendary + boss.c.mythical, 0, 'bosses never drop the good stuff');
  assert.ok(Math.abs(boss.drops / 20000 - LOOT_TABLES.boss.chance) < 0.02);
  assert.ok(mythic.c.mythical > major.c.mythical && major.c.mythical > minor.c.mythical);
});

test('XP and levels: each level grants exactly one pick, offers are spent once', () => {
  const cmd = commanderDefaults();
  const levels = addXp(cmd, COMMANDER.xpToNext(1) + COMMANDER.xpToNext(2) + 5);
  assert.equal(levels, 2);
  assert.equal(cmd.level, 3);
  assert.equal(cmd.xp, 5);
  assert.equal(cmd.pendingPicks, 2);
  const rnd = seq(5);
  const offer = ensureOffer(cmd, rnd);
  assert.equal(ensureOffer(cmd, rnd), offer, 'reopening does not reroll the offer');
  const chosen = choosePerk(cmd, 1, rnd);
  assert.deepEqual(chosen, offer[1]);
  assert.equal(cmd.perks.length, 1);
  assert.equal(cmd.pendingPicks, 1);
  assert.ok(cmd.offer && cmd.offer !== offer, 'next offer is ready');
  choosePerk(cmd, 0, rnd);
  assert.equal(cmd.pendingPicks, 0);
  assert.equal(cmd.offer, null);
  assert.equal(choosePerk(cmd, 0, rnd), null, 'no picks left');
  assert.equal(cmd.perks.length, 2);
});

test('run XP grows with depth', () => {
  const a = runXp({ wave: 3, wavesCleared: 2, kills: 40 });
  const b = runXp({ wave: 15, wavesCleared: 14, kills: 900 });
  assert.ok(a > 0 && b > a * 5);
  assert.equal(runXp({}), 0);
});

test('artifacts: auto-equip into free slots, slot limit, salvage gives XP', () => {
  const cmd = commanderDefaults();
  const slots = slotCount(1);
  const uids = [];
  for (let i = 0; i < slots + 2; i++) uids.push(addArtifact(cmd, { id: 'bloodstone', rarity: 'common' }).artifact.uid);
  assert.equal(cmd.equipped.length, slots);
  assert.equal(equip(cmd, uids[slots]), false, 'slots full');
  assert.ok(unequip(cmd, uids[0]));
  assert.ok(equip(cmd, uids[slots]));
  assert.equal(addArtifact(cmd, { id: 'nope', rarity: 'common' }).artifact, null);
  const xp = cmd.xp;
  salvage(cmd, uids[slots]);
  assert.equal(cmd.artifacts.length, slots + 1);
  assert.ok(!cmd.equipped.includes(uids[slots]));
  assert.ok(cmd.xp > xp);
  assert.ok(slotCount(20) > slotCount(1));
});

test('bonuses: perks and equipped artifacts add up; unequipped ones do not count', () => {
  const cmd = commanderDefaults();
  cmd.perks.push({ id: 'sharpSteel', rarity: 'rare' }, { id: 'sharpSteel', rarity: 'common' });
  const a = addArtifact(cmd, { id: 'kingslayer', rarity: 'legendary' }).artifact;
  let b = totalBonuses(cmd);
  assert.equal(b.heroDamagePct, 11 + 4 + 14);
  assert.equal(b.heroCritAdd, 6);
  unequip(cmd, a.uid);
  b = totalBonuses(cmd);
  assert.equal(b.heroDamagePct, 15);
  assert.equal(b.heroCritAdd, undefined);
});

test('applyBonuses changes a copy and never the shared config', () => {
  const before = JSON.stringify(CFG.HEROES) + JSON.stringify(CFG.WALLS) + CFG.ECONOMY.startingGold;
  const c = applyBonuses(CFG, { heroDamagePct: 50, wallCostPct: 500, startingGoldAdd: 100, enemyHpPct: 10, killGoldPct: 20 });
  assert.equal(JSON.stringify(CFG.HEROES) + JSON.stringify(CFG.WALLS) + CFG.ECONOMY.startingGold, before);
  assert.equal(c.HEROES.archer.damage, CFG.HEROES.archer.damage * 1.5);
  assert.equal(c.WALLS.stone.cost, Math.round(CFG.WALLS.stone.cost * (1 - COMMANDER.maxReductionPct / 100)), 'reductions are capped');
  assert.equal(c.ECONOMY.startingGold, CFG.ECONOMY.startingGold + 100);
  assert.equal(c.ZOMBIES.walker.hp, Math.round(CFG.ZOMBIES.walker.hp * 0.9));
  assert.equal(c.BONUS.killGoldPct, 20);
  const t = applyBonuses(CFG, { heroDamagePct: 20, heroRangeAdd: 1, towerCostPct: 10 });
  assert.equal(t.TOWERS.fire.damage, CFG.TOWERS.fire.damage * 1.2, 'damage bonuses reach the towers');
  assert.equal(t.TOWERS.wind.range, CFG.TOWERS.wind.range + 1);
  assert.equal(t.TOWERS.earth.cost, Math.round(CFG.TOWERS.earth.cost * 0.9));
  assert.equal(CFG.TOWERS.fire.damage, 12);
  assert.equal(typeof c.HERO_RULES.xpToNext, 'function');
  const sim = new Simulation({ seed: 1, config: c });
  assert.equal(sim.economy.gold, CFG.ECONOMY.startingGold + 100);
});

test('save: version 1 saves are upgraded, garbage commander data is cleaned', () => {
  const v1 = { version: 1, bestWave: 12, highScore: 3400, totalKills: 900, runs: 7, settings: { muted: true, volume: 0.3, shadows: false, showPath: true } };
  const s = sanitize(v1);
  assert.equal(s.version, 2);
  assert.equal(s.bestWave, 12);
  assert.equal(s.settings.muted, true);
  assert.deepEqual(s.commander, commanderDefaults());

  const messy = sanitize({
    ...v1, version: 2,
    commander: {
      level: 3, xp: 1e9, pendingPicks: 2, offer: [{ id: 'hacked', rarity: 'mythical' }],
      perks: [{ id: 'sharpSteel', rarity: 'rare' }, { id: 'hallowedGround', rarity: 'common' }, { id: 'x' }],
      artifacts: [{ uid: 4, id: 'mortar', rarity: 'epic' }, { uid: 5, id: 'mortar', rarity: 'rare' }, { uid: 5, id: 'ledger', rarity: 'rare' }],
      equipped: [5, 5, 99], nextUid: 1,
    },
  });
  const c = messy.commander;
  assert.equal(c.level, 3);
  assert.ok(c.xp < COMMANDER.xpToNext(3));
  assert.equal(c.offer, null, 'invalid offers are dropped (a fresh one is rolled later)');
  assert.deepEqual(c.perks, [{ id: 'sharpSteel', rarity: 'rare' }], 'unknown perks and impossible rarities are dropped');
  assert.deepEqual(c.artifacts, [{ uid: 5, id: 'mortar', rarity: 'rare' }]);
  assert.deepEqual(c.equipped, [5]);
  assert.equal(c.nextUid, 6);
  assert.deepEqual(sanitize('garbage').commander, commanderDefaults());
  // recordRun keeps the commander.
  messy.commander.level = 4;
  assert.equal(recordRun(messy, { wave: 1, score: 0, kills: 0 }).save.commander.level, 4);
});

test('wanderer crosses west to east through walls, never attacks, and leaves without reward', () => {
  const sim = new Simulation({ seed: 3 });
  // Walls across every row a wanderer can use: it must walk straight through them.
  sim.economy.earn(50000);
  for (let y = sim.config.WANDERERS.minRow - 1; y <= sim.config.WANDERERS.maxRow + 2; y += 2) {
    for (let x = 0; x < sim.config.MAP.width; x++) sim.walls.build('stone', x, y);
  }
  const gold = sim.economy.gold;
  const gate = sim.fortress.hp;
  const wallHp = [...sim.walls.all()].reduce((s, w) => s + w.hp, 0);
  const escaped = [];
  sim.events.on('wandererEscaped', (e) => escaped.push(e));
  const z = sim.wanderers.spawn(3, 'wraith');
  assert.ok(z.wanderer);
  assert.equal(sim.zombies.hordeAlive, 0, 'wanderers are not part of the wave');
  let maxDrift = 0;
  for (let t = 0; t < 80 && z.alive; t += 1 / 30) {
    sim.zombies.step(1 / 30);
    maxDrift = Math.max(maxDrift, Math.abs(z.z - z.row));
  }
  assert.equal(escaped.length, 1);
  assert.ok(!z.alive && z.escaped);
  assert.ok(!sim.zombies.list.includes(z), 'removed from the field at once');
  assert.ok(maxDrift < 1.5);
  assert.equal(sim.economy.gold, gold, 'no reward for an escape');
  assert.equal(sim.fortress.hp, gate);
  assert.equal([...sim.walls.all()].reduce((s, w) => s + w.hp, 0), wallHp, 'walls untouched');
  assert.equal(sim.stats.wanderersEscaped, 1);
});

test('slaying a wanderer drops exactly one artifact; a wanderer never holds up the wave', () => {
  const sim = new Simulation({ seed: 9 });
  const drops = [];
  sim.events.on('artifactDropped', (d) => drops.push(d));
  const z = sim.wanderers.spawn(3, 'colossus');
  sim.zombies.damage(z, 1e9);
  sim.zombies.damage(z, 1e9);
  assert.equal(drops.length, 1);
  assert.ok(ARTIFACTS[drops[0].id] && RARITIES.includes(drops[0].rarity));
  assert.deepEqual(sim.summary().artifacts, [{ id: drops[0].id, rarity: drops[0].rarity }]);
  assert.equal(sim.stats.wanderersSlain, 1);

  // A live wanderer during an active wave: the wave still clears when the horde is dead.
  sim.waves.startNext();
  const w = sim.wanderers.spawn(1, 'eclipse');
  for (let i = 0; i < 4000 && sim.waves.queue.length; i++) sim.waves.step(0.1);
  for (const zb of sim.zombies.list) if (!zb.wanderer) sim.zombies.damage(zb, 1e9);
  sim.waves.step(0.1);
  assert.equal(sim.waves.phase, 'prep');
  assert.ok(w.alive);
});

test('wanderer sightings use their own random stream: the horde is unchanged', () => {
  const run = (wanderers) => {
    const sim = new Simulation({ seed: 21, config: { ...CFG, WANDERERS: wanderers ? { ...CFG.WANDERERS, chance: 1, fromWave: 1 } : null } });
    sim.waves.startNext();
    sim.run(40);
    return sim.zombies.list.filter((z) => !z.wanderer).map((z) => `${z.type}:${z.x.toFixed(3)}`).join(',');
  };
  assert.equal(run(true), run(false));
});

test('plunder bonus pays extra kill gold fractionally', () => {
  const c = applyBonuses(CFG, { killGoldPct: 50 });
  const sim = new Simulation({ seed: 2, config: c });
  const g = sim.economy.gold;
  for (let i = 0; i < 4; i++) sim.zombies.damage(sim.zombies.spawn('walker', 5.5, 5.5), 1e9);
  assert.equal(sim.economy.gold - g, 4 * CFG.ZOMBIES.walker.reward * 1.5);
});
