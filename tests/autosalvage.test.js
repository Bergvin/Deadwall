import test from 'node:test';
import assert from 'node:assert/strict';
import { RARITIES, ARTIFACTS, RARITY_INFO } from '../src/config/commander.js';
import {
  commanderDefaults, addArtifact, chooseArtifact, setAutoSalvage, autoSalvages, unkeptArtifacts, salvageUnkept,
} from '../src/core/commander.js';
import { sanitize } from '../src/core/save.js';
import { Simulation } from '../src/core/simulation.js';
import * as CFG from '../src/config/game.js';
import { makeItem } from '../src/core/heroBuild.js';

const [idA, idB] = Object.keys(ARTIFACTS);

test('auto-salvage is off by default and keeps everything', () => {
  const cmd = commanderDefaults();
  assert.equal(cmd.autoSalvage.on, false);
  const res = addArtifact(cmd, { id: idA, rarity: 'common' });
  assert.ok(res.artifact && !res.auto);
});

test('auto-salvage turns new artifacts of unkept rarities into XP', () => {
  const cmd = commanderDefaults();
  setAutoSalvage(cmd, { on: true, keep: ['rare', 'legendary', 'mythical'] });
  assert.ok(autoSalvages(cmd, 'common') && autoSalvages(cmd, 'uncommon') && !autoSalvages(cmd, 'rare'));
  cmd.artifactOffer = [{ id: idA, rarity: 'uncommon' }];
  const res = chooseArtifact(cmd, 0);
  assert.equal(res.artifact, null);
  assert.deepEqual(res.auto, { id: idA, rarity: 'uncommon' });
  assert.equal(res.salvagedXp, RARITY_INFO.uncommon.salvageXp);
  assert.equal(cmd.xp, RARITY_INFO.uncommon.salvageXp);
  assert.equal(cmd.artifacts.length, 0);
  assert.ok(addArtifact(cmd, { id: idA, rarity: 'rare' }).artifact, 'kept rarity is stored');
});

test('clearing the stash salvages only unequipped unkept artifacts', () => {
  const cmd = commanderDefaults();
  const eq = addArtifact(cmd, { id: idA, rarity: 'common' }).artifact; // fills a free slot
  addArtifact(cmd, { id: idB, rarity: 'common' }); // second slot
  const stashed = addArtifact(cmd, { id: Object.keys(ARTIFACTS)[2], rarity: 'common' }).artifact;
  const rare = addArtifact(cmd, { id: Object.keys(ARTIFACTS)[3], rarity: 'rare' }).artifact;
  assert.ok(cmd.equipped.includes(eq.uid) && !cmd.equipped.includes(stashed.uid));
  assert.equal(unkeptArtifacts(cmd).length, 0, 'nothing while the setting is off');
  setAutoSalvage(cmd, { on: true, keep: ['rare'] });
  assert.deepEqual(unkeptArtifacts(cmd).map((a) => a.uid), [stashed.uid]);
  const res = salvageUnkept(cmd);
  assert.deepEqual(res, { count: 1, xp: RARITY_INFO.common.salvageXp });
  assert.ok(cmd.artifacts.some((a) => a.uid === eq.uid) && cmd.artifacts.some((a) => a.uid === rare.uid));
});

test('the setting survives the save and bad values are cleaned', () => {
  const cmd = commanderDefaults();
  setAutoSalvage(cmd, { on: true, keep: ['mythical', 'rare'] });
  const back = sanitize({ version: 2, commander: JSON.parse(JSON.stringify(cmd)) }).commander;
  assert.deepEqual(back.autoSalvage, { on: true, keep: ['rare', 'mythical'] });
  const bad = sanitize({ version: 2, commander: { autoSalvage: { on: 'yes', keep: ['junk', 'rare'] } } }).commander;
  assert.deepEqual(bad.autoSalvage, { on: false, keep: ['rare'] });
  const old = sanitize({ version: 2, commander: {} }).commander;
  assert.deepEqual(old.autoSalvage, { on: false, keep: RARITIES.slice(1) });
});

// --- hero loot auto-sell ---------------------------------------------------------------

const lootSim = () => {
  const sim = new Simulation({ seed: 3 });
  const hero = sim.heroes.recruitChampion('archer');
  return { sim, hero };
};
const item = (rarity) => makeItem(CFG, { slot: 'armor', rarity, affixes: [] });

test('hero loot: auto-sell off keeps every drop in the bag', () => {
  const { sim, hero } = lootSim();
  const res = sim.heroes.addLoot(item('common'));
  assert.ok(res.stored && !res.autoSold);
  assert.equal(hero.bag.length, 1);
});

test('hero loot: drops of unkept rarities are sold for gold at once', () => {
  const { sim, hero } = lootSim();
  sim.heroes.setAutoSell({ on: true, keep: ['epic', 'legendary', 'mythical'] });
  const gold = sim.economy.gold;
  const res = sim.heroes.addLoot(item('rare'));
  assert.ok(res.autoSold && !res.stored);
  assert.equal(res.gold, RARITY_INFO.rare.salvageGold);
  assert.equal(sim.economy.gold, gold + RARITY_INFO.rare.salvageGold);
  assert.equal(hero.bag.length, 0);
  assert.ok(sim.heroes.addLoot(item('epic')).stored, 'kept rarity goes to the bag');
});

test('hero loot: selling unkept bag items leaves kept ones', () => {
  const { sim, hero } = lootSim();
  for (const r of ['common', 'uncommon', 'legendary']) sim.heroes.addLoot(item(r));
  assert.equal(sim.heroes.unkeptItems(hero.id).length, 0, 'nothing while off');
  sim.heroes.setAutoSell({ on: true, keep: ['legendary'] });
  const res = sim.heroes.sellUnkept(hero.id);
  assert.deepEqual(res, { count: 2, gold: RARITY_INFO.common.salvageGold + RARITY_INFO.uncommon.salvageGold });
  assert.deepEqual(hero.bag.map((i) => i.rarity), ['legendary']);
});

test('hero loot: the setting is saved and cleaned', () => {
  const s = sanitize({ version: 2, settings: { lootAutoSell: { on: true, keep: ['mythical', 'junk', 'rare'] } } }).settings;
  assert.deepEqual(s.lootAutoSell, { on: true, keep: ['rare', 'mythical'] });
  assert.deepEqual(sanitize({ version: 2 }).settings.lootAutoSell, { on: false, keep: RARITIES.slice(1) });
});
