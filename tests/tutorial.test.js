import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../src/core/save.js';
import { ENEMY_GUIDE, TUTORIAL_STEPS } from '../src/config/tutorial.js';
import { ZOMBIES, TOWERS } from '../src/config/game.js';

test('tutorial progress is saved and bad values are cleaned', () => {
  const d = sanitize(null);
  assert.equal(d.settings.tutorial, true);
  assert.deepEqual(d.tutorial, { steps: [], enemies: [] });
  const s = sanitize({ ...d, settings: { ...d.settings, tutorial: false }, tutorial: { steps: ['welcome', 'welcome', 3, '<b>'], enemies: 'ghost' } });
  assert.equal(s.settings.tutorial, false);
  assert.deepEqual(s.tutorial, { steps: ['welcome'], enemies: [] });
});

test('every enemy has a guide entry naming real towers; steps are well formed', () => {
  for (const type of Object.keys(ZOMBIES)) {
    const g = ENEMY_GUIDE[type];
    assert.ok(g, `guide for ${type}`);
    for (const id of [...g.good, ...g.bad]) assert.ok(TOWERS[id], `${type}: unknown tower ${id}`);
  }
  const ids = new Set(TUTORIAL_STEPS.map((s) => s.id));
  assert.equal(ids.size, TUTORIAL_STEPS.length);
  for (const s of TUTORIAL_STEPS) {
    for (const a of s.after ?? []) assert.ok(ids.has(a), `${s.id} waits for unknown ${a}`);
    assert.ok(s.card || s.done, `${s.id} can finish`);
  }
});
