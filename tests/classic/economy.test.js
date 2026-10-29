import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy } from '../../src-classic/core/economy.js';

test('spending deducts gold and never goes negative', () => {
  const e = new Economy(50);
  assert.equal(e.trySpend(30), true);
  assert.equal(e.gold, 20);
  assert.equal(e.trySpend(21), false);
  assert.equal(e.gold, 20);
  assert.equal(e.trySpend(20), true);
  assert.equal(e.gold, 0);
  assert.equal(e.trySpend(1), false);
});

test('invalid amounts are rejected', () => {
  const e = new Economy(100);
  assert.equal(e.trySpend(-10), false);
  assert.equal(e.trySpend(NaN), false);
  e.earn(-5);
  e.earn(NaN);
  assert.equal(e.gold, 100);
});
