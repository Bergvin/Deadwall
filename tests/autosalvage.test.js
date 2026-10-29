import test from 'node:test';
import assert from 'node:assert/strict';
import { RARITIES, ARTIFACTS, RARITY_INFO } from '../src/config/commander.js';
import {
  commanderDefaults, addArtifact, chooseArtifact, setAutoSalvage, autoSalvages, unkeptArtifacts, salvageUnkept,
} from '../src/core/commander.js';
import { sanitize } from '../src/core/save.js';

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
  const back = sanitize({ version: 3, commander: JSON.parse(JSON.stringify(cmd)) }).commander;
  assert.deepEqual(back.autoSalvage, { on: true, keep: ['rare', 'mythical'] });
  const bad = sanitize({ version: 3, commander: { autoSalvage: { on: 'yes', keep: ['junk', 'rare'] } } }).commander;
  assert.deepEqual(bad.autoSalvage, { on: false, keep: ['rare'] });
  const old = sanitize({ version: 3, commander: {} }).commander;
  assert.deepEqual(old.autoSalvage, { on: false, keep: RARITIES.slice(1) });
});
