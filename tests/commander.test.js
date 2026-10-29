import test from 'node:test';
import assert from 'node:assert/strict';
import * as CFG from '../src/config/game.js';
import { RARITIES, PERKS, ARTIFACTS, COMMANDER, ABILITIES } from '../src/config/commander.js';
import {
  commanderDefaults, rollOffer, ensureOffer, choosePerk, addXp, runXp, addArtifact, chooseArtifact,
  equip, unequip, salvage, slotCount, totalBonuses, totalAbilities, applyBonuses, runConfig, perkValue,
  artifactOdds, rollArtifactOffer, artifactAbility, artifactBonuses, levelFactor, isSkill,
} from '../src/core/commander.js';
import { sanitize, recordRun, isMapUnlocked } from '../src/core/save.js';
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
  const ids = Object.keys(ARTIFACTS).slice(0, slots + 2);
  const uids = ids.map((id) => addArtifact(cmd, { id, rarity: 'common' }).artifact.uid);
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

test('artifacts: identical ones merge into higher levels; other rarities stay separate', () => {
  const cmd = commanderDefaults();
  const first = addArtifact(cmd, { id: 'hearth', rarity: 'rare' });
  assert.equal(first.artifact.level, 1);
  const second = addArtifact(cmd, { id: 'hearth', rarity: 'rare' });
  assert.ok(second.merged);
  assert.equal(second.artifact.uid, first.artifact.uid);
  assert.equal(first.artifact.level, 2);
  assert.equal(addArtifact(cmd, { id: 'hearth', rarity: 'uncommon' }).merged, false, 'a different rarity is a different artifact');
  for (let i = 0; i < 10; i++) addArtifact(cmd, { id: 'hearth', rarity: 'rare' });
  const rares = cmd.artifacts.filter((a) => a.id === 'hearth' && a.rarity === 'rare');
  assert.equal(rares[0].level, COMMANDER.artifactMaxLevel, 'capped at max level');
  assert.ok(rares.length > 1, 'past max level a new copy starts');
  // Levels make it stronger: bonuses and ability power.
  const b1 = artifactBonuses('hearth', 'rare', 1).houseHpPct, b3 = artifactBonuses('hearth', 'rare', 3).houseHpPct;
  assert.ok(Math.abs(b3 - b1 * levelFactor(3)) < 0.02);
  assert.ok(artifactAbility('hearth', 'rare', 3).power > artifactAbility('hearth', 'rare', 1).power);
});

test('artifacts: commons carry no ability, uncommon and better do, stronger by rarity', () => {
  for (const id of Object.keys(ARTIFACTS)) {
    assert.equal(artifactAbility(id, 'common'), null);
    let prev = 0;
    for (const r of RARITIES.slice(1)) {
      const ab = artifactAbility(id, r);
      assert.ok(ab && ABILITIES[ab.id], `${id} ${r}`);
      assert.ok(ab.power > prev);
      prev = ab.power;
    }
  }
});

test('run-end artifacts: three distinct choices; odds improve the further the run got', () => {
  const rnd = seq(17);
  for (let i = 0; i < 200; i++) {
    const offer = rollArtifactOffer(3, rnd);
    assert.equal(offer.length, 3);
    assert.equal(new Set(offer.map((o) => o.id)).size, 3);
  }
  const share = (wave) => {
    const r = seq(wave + 1);
    let good = 0, n = 0;
    for (let i = 0; i < 3000; i++) for (const o of rollArtifactOffer(wave, r)) { n++; if (['rare', 'legendary', 'mythical'].includes(o.rarity)) good++; }
    return good / n;
  };
  const early = share(3), mid = share(12), deep = share(30);
  assert.ok(early < 0.12, `early runs mostly give poor artifacts (${early})`);
  assert.ok(mid > early * 1.8 && deep > mid * 1.4, `${early} ${mid} ${deep}`);
  const o1 = artifactOdds(1);
  assert.ok(o1.common > o1.uncommon + o1.rare + o1.legendary + o1.mythical, 'a short run is mostly commons');
  assert.ok(artifactOdds(30).mythical > o1.mythical * 10);
  // Choosing takes one and clears the offer.
  const cmd = commanderDefaults();
  cmd.artifactOffer = [{ id: 'bloodstone', rarity: 'rare' }, { id: 'hearth', rarity: 'common' }, { id: 'ledger', rarity: 'uncommon' }];
  const res = chooseArtifact(cmd, 0);
  assert.equal(res.artifact.id, 'bloodstone');
  assert.equal(cmd.artifactOffer, null);
  assert.equal(chooseArtifact(cmd, 0), null, 'only once');
});

test('bonuses and abilities: perks, skills and equipped artifacts add up; unequipped do not count', () => {
  const cmd = commanderDefaults();
  cmd.perks.push({ id: 'sharpSteel', rarity: 'rare' }, { id: 'sharpSteel', rarity: 'common' }, { id: 'skillMeteor', rarity: 'uncommon' });
  const a = addArtifact(cmd, { id: 'kingslayer', rarity: 'legendary' }).artifact;
  addArtifact(cmd, { id: 'falconHood', rarity: 'rare' });
  let b = totalBonuses(cmd);
  assert.equal(b.towerDamagePct, 22 + 8 + 28);
  assert.equal(b.towerCritAdd, 12);
  let ab = totalAbilities(cmd);
  assert.equal(ab.judgement, 2.4);
  assert.equal(ab.meteor, 1 + 1.5, 'skill and artifact with the same ability stack');
  assert.ok(isSkill('skillMeteor') && !isSkill('sharpSteel'));
  unequip(cmd, a.uid);
  b = totalBonuses(cmd);
  ab = totalAbilities(cmd);
  assert.equal(b.towerDamagePct, 30);
  assert.equal(b.towerCritAdd, undefined);
  assert.equal(ab.judgement, undefined);
  assert.deepEqual(runConfig(CFG, cmd).COMMANDER_ABILITIES, ab);
});

test('applyBonuses changes a copy and never the shared config', () => {
  const before = JSON.stringify(CFG.TOWERS) + JSON.stringify(CFG.RUNNER) + CFG.ECONOMY.startingGold;
  const c = applyBonuses(CFG, {
    towerDamagePct: 50, towerCostPct: 500, startingGoldAdd: 100, enemyHpPct: 10, killGoldPct: 20,
    runnerSpeedPct: 20, runnerCrateAdd: 1, spellCooldownPct: 50, ammoPct: 25, towerSlotAdd: 1, upgradeCostPct: 10,
  }, { meteor: 2 });
  assert.deepEqual(c.COMMANDER_ABILITIES, { meteor: 2 });
  assert.equal(JSON.stringify(CFG.TOWERS) + JSON.stringify(CFG.RUNNER) + CFG.ECONOMY.startingGold, before);
  assert.equal(c.TOWERS.arrow.damage, CFG.TOWERS.arrow.damage * 1.5);
  assert.equal(c.TOWERS.arrow.cost, Math.round(CFG.TOWERS.arrow.cost * (1 - COMMANDER.maxReductionPct / 100)), 'reductions are capped');
  assert.equal(c.TOWERS.boulder.ammo, Math.round(CFG.TOWERS.boulder.ammo * 1.25));
  assert.equal(c.ECONOMY.startingGold, CFG.ECONOMY.startingGold + 100);
  assert.equal(c.ZOMBIES.walker.hp, Math.round(CFG.ZOMBIES.walker.hp * 0.9));
  assert.equal(c.BONUS.killGoldPct, 20);
  assert.equal(c.BONUS.towerSlotAdd, 1);
  assert.ok(Math.abs(c.RUNNER.speed - CFG.RUNNER.speed * 1.2) < 1e-9);
  assert.equal(c.RUNNER.crates, CFG.RUNNER.crates + 1);
  assert.equal(c.SPELLS.pepTalk.cooldown, CFG.SPELLS.pepTalk.cooldown * 0.5);
  assert.ok(Math.abs(c.TOWER_RULES.upgradeBase - CFG.TOWER_RULES.upgradeBase * 0.9) < 1e-9);
  assert.equal(typeof c.RUNNER.xpToNext, 'function');
  const sim = new Simulation({ seed: 1, config: c });
  assert.equal(sim.economy.gold, CFG.ECONOMY.startingGold + 100);
  assert.equal(sim.towers.slots, CFG.TOWER_RULES.baseSlots + 1, 'a commander slot bonus opens a slot');
  assert.equal(sim.runner.main.crates, CFG.RUNNER.crates + 1);
});

test('save: old saves start fresh, garbage commander data is cleaned, maps unlock in order', () => {
  const old = { version: 2, bestWave: 12, highScore: 3400, totalKills: 900, runs: 7, settings: { muted: true } };
  const s = sanitize(old);
  assert.equal(s.version, 3);
  assert.equal(s.bestWave, 0, 'DW Classic progress stays in DW Classic');
  assert.deepEqual(s.commander, commanderDefaults());

  const messy = sanitize({
    version: 3, maps: { oldroad: { bestWave: 4 }, nowhere: { bestWave: 99 } },
    commander: {
      level: 3, xp: 1e9, pendingPicks: 2, offer: [{ id: 'hacked', rarity: 'mythical' }],
      perks: [{ id: 'sharpSteel', rarity: 'rare' }, { id: 'hallowedGround', rarity: 'common' }, { id: 'x' }],
      artifacts: [{ uid: 4, id: 'hearth', rarity: 'superb' }, { uid: 5, id: 'hearth', rarity: 'rare', level: 99 }, { uid: 5, id: 'ledger', rarity: 'rare' }],
      equipped: [5, 5, 99], nextUid: 1, artifactOffer: [{ id: 'hearth', rarity: 'rare' }, { id: 'hacked', rarity: 'rare' }],
    },
  });
  const c = messy.commander;
  assert.equal(c.level, 3);
  assert.ok(c.xp < COMMANDER.xpToNext(3));
  assert.equal(c.offer, null, 'invalid offers are dropped (a fresh one is rolled later)');
  assert.deepEqual(c.perks, [{ id: 'sharpSteel', rarity: 'rare' }], 'unknown perks and impossible rarities are dropped');
  assert.deepEqual(c.artifacts, [{ uid: 5, id: 'hearth', rarity: 'rare', level: COMMANDER.artifactMaxLevel }]);
  assert.equal(c.artifactOffer, null, 'an offer with an unknown artifact is dropped');
  assert.deepEqual(c.equipped, [5]);
  assert.equal(c.nextUid, 6);
  assert.deepEqual(Object.keys(messy.maps), ['oldroad'], 'unknown maps are dropped');
  assert.deepEqual(sanitize('garbage').commander, commanderDefaults());
  // Maps unlock in order: wave 10 on one map opens the next.
  const [m1, m2, m3] = CFG.MAPS;
  assert.ok(isMapUnlocked(messy, m1) && !isMapUnlocked(messy, m2));
  const r = recordRun(messy, { map: m1.id, wave: m2.unlock.wave, score: 100, kills: 5 });
  assert.deepEqual(r.unlocked, [m2.id]);
  assert.ok(isMapUnlocked(r.save, m2) && !isMapUnlocked(r.save, m3));
  assert.equal(r.save.maps[m1.id].bestWave, m2.unlock.wave);
  // recordRun keeps the commander.
  messy.commander.level = 4;
  assert.equal(recordRun(messy, { map: m1.id, wave: 1, score: 0, kills: 0 }).save.commander.level, 4);
});

test('plunder bonus pays extra kill gold fractionally', () => {
  const c = applyBonuses(CFG, { killGoldPct: 50 });
  const sim = new Simulation({ seed: 2, config: c });
  const g = sim.economy.gold;
  for (let i = 0; i < 4; i++) sim.zombies.damage(sim.zombies.spawn('walker', 0), 1e9);
  assert.equal(sim.economy.gold - g, 4 * CFG.ZOMBIES.walker.reward * 1.5);
});

// --- wave variants ---
import { waveComposition, rollVariant } from '../src/core/waves.js';

test('wave variants: swarm is many weak runners/walkers, chubby is few tanky brutes', () => {
  const { WAVE_TABLE: T, ELITE: E, WAVE_VARIANTS: V } = CFG;
  const n = 8;
  const normal = waveComposition(n, T, E);
  const swarm = waveComposition(n, T, E, V.types.swarm);
  const chubby = waveComposition(n, T, E, V.types.chubby);
  const total = (c) => c.groups.reduce((s, g) => s + g.count, 0);
  const types = (c) => c.groups.map((g) => g.type).sort();
  assert.ok(total(swarm) > total(normal) * 1.8);
  assert.deepEqual(types(swarm), ['runner', 'walker']);
  assert.ok(swarm.hpMultiplier < normal.hpMultiplier && swarm.spawnIntervalMult < 1 && swarm.rewardMult < 1);
  assert.ok(total(chubby) < total(normal) / 2);
  assert.ok(!types(chubby).includes('runner'));
  assert.ok(chubby.groups.find((g) => g.type === 'brute').count >= 3);
  assert.ok(chubby.hpMultiplier > normal.hpMultiplier && chubby.spawnIntervalMult > 1);
});

test('wave variants: early and boss waves are normal, specials never repeat, all kinds appear', () => {
  const { WAVE_TABLE: T, WAVE_VARIANTS: V } = CFG;
  const rnd = seq(4);
  const seen = new Set();
  let prev = null;
  for (let n = 1; n <= 400; n++) {
    const v = rollVariant(n, V, T, prev, rnd);
    if (n <= V.normalUntil || n % T.bossEvery === 0) assert.equal(v, 'normal', `wave ${n}`);
    if (v !== 'normal') assert.notEqual(v, prev, `wave ${n} repeats ${v}`);
    if (n < V.types[v].fromWave) assert.fail(`${v} too early at ${n}`);
    seen.add(v);
    prev = v;
  }
  assert.deepEqual([...seen].sort(), ['chubby', 'normal', 'swarm']);
});

test('wave variants in a run: preview matches the wave that starts, swarm kills pay less', () => {
  const sim = new Simulation({ seed: 5 });
  let checked = 0;
  for (let w = 0; w < 30; w++) {
    const pv = sim.waves.preview();
    sim.waves.startNext();
    assert.equal(sim.waves.variant, pv.variant);
    assert.equal(sim.waves.queue.length, pv.groups.reduce((s, g) => s + g.count, 0) + (pv.boss ? 1 : 0));
    if (pv.variant === 'swarm') {
      for (let i = 0; i < 40 && sim.waves.queue.length; i++) sim.waves.step(0.2);
      const z = sim.zombies.list.find((q) => q.alive && !q.elite && q.type === 'walker'); // corpses linger; elites pay more
      assert.ok(z.reward < CFG.ZOMBIES.walker.reward);
      checked++;
    }
    for (const z of sim.zombies.list) sim.zombies.damage(z, 1e9);
    sim.waves.queue.length = 0;
    sim.waves.step(0.1);
    assert.equal(sim.waves.phase, 'prep');
  }
  assert.ok(checked > 0, 'saw at least one swarm');
});

test('runner: levels from kills and cleared waves, never skipping past a level', () => {
  const sim = new Simulation({ seed: 8 });
  const r = sim.runner;
  const need = CFG.RUNNER.xpToNext(1);
  r.awardWave();
  assert.equal(r.level, 1);
  assert.equal(Math.round(r.xp), Math.round(need * CFG.RUNNER.waveClearLevelFraction));
  r.addXp(1e6);
  assert.equal(r.level, CFG.RUNNER.maxLevel, 'capped');
  assert.equal(r.pendingPicks, CFG.RUNNER.maxLevel - 1, 'one pick per level');
  for (let l = 1; l < 60; l++) assert.ok(CFG.RUNNER.xpToNext(l + 1) > CFG.RUNNER.xpToNext(l));
});

// --- commander abilities in a run ---
const abilityRun = (abilities, seed = 31) => {
  const sim = new Simulation({ seed, config: applyBonuses(CFG, {}, abilities) });
  sim.waves.startNext();
  return sim;
};

test('no commander abilities: no ability system at all', () => {
  assert.equal(new Simulation({ seed: 1 }).abilities, null);
});

test('meteor hits the densest pack; judgement smites the toughest enemy', () => {
  const sim = abilityRun({ meteor: 1, judgement: 1 });
  sim.waves.queue.length = 0;
  const pack = [];
  for (let i = 0; i < 6; i++) pack.push(sim.zombies.spawn('walker', 0, 50, { s: 10 + i * 0.1, lane: 0.1 * (i % 2) }));
  const lone = sim.zombies.spawn('walker', 0, 50, { s: 30 });
  const big = sim.zombies.spawn('brute', 0, 200, { s: 45 });
  const used = [];
  sim.events.on('commanderAbility', (e) => used.push(e.id));
  for (let t = 0; t < 10; t += 1 / 30) sim.abilities.step(1 / 30);
  assert.ok(used.includes('meteor') && used.includes('judgement'));
  assert.ok(pack.every((z) => z.hp < z.maxHp), 'the whole pack was hit');
  assert.equal(lone.hp, lone.maxHp, 'the lone walker was not');
  assert.ok(big.hp < big.maxHp, 'the toughest enemy was smitten');
});

test('frost slows everyone, supply refills towers, bulwark heals the house, tithe pays on clear', () => {
  const sim = abilityRun({ frost: 1, supply: 1, bulwark: 1, tithe: 1 });
  sim.waves.queue.length = 0;
  const zs = [sim.zombies.spawn('walker', 0, 1, { s: 3 }), sim.zombies.spawn('runner', 0, 1, { s: 20 })];
  sim.economy.earn(1000);
  const t = sim.towers.build('arrow', 17, 2);
  t.ammo = 0;
  sim.house.hp = sim.house.maxHp / 2;
  for (let k = 0; k < 20; k += 1 / 30) sim.abilities.step(1 / 30);
  assert.ok(zs.every((z) => z.slowUntil > sim.zombies.time), 'everyone slowed');
  assert.ok(t.ammo > 0, 'supply drop refilled the tower');
  assert.ok(sim.house.hp > sim.house.maxHp / 2);
  const gold = sim.economy.gold;
  for (const z of sim.zombies.list) sim.zombies.damage(z, 1e9);
  sim.waves.step(0.1);
  assert.equal(sim.waves.phase, 'prep');
  assert.ok(sim.economy.gold - gold >= ABILITIES.tithe.goldPerWave, 'tithe paid');
});

test('abilities rest between waves and scale with power', () => {
  const sim = abilityRun({ judgement: 1 });
  sim.waves.queue.length = 0;
  for (const z of sim.zombies.list) sim.zombies.damage(z, 1e9);
  sim.waves.step(0.1);
  assert.equal(sim.waves.phase, 'prep');
  const z = sim.zombies.spawn('brute', 0, 10, { s: 20 });
  for (let t = 0; t < 20; t += 1 / 30) sim.abilities.step(1 / 30);
  assert.equal(z.hp, z.maxHp, 'nothing fires during preparation');
  const hit = (power) => {
    const s = abilityRun({ judgement: power }, 40);
    s.waves.queue.length = 0;
    const b = s.zombies.spawn('brute', 0, 100, { s: 20 });
    for (let t = 0; t < ABILITIES.judgement.interval; t += 1 / 30) s.abilities.step(1 / 30);
    return b.maxHp - b.hp;
  };
  assert.ok(hit(3) > hit(1) * 2.5);
});
