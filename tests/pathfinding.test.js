import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath, computeFlowField } from '../src/core/pathfinding.js';
import { openGrid } from './helpers.js';

const blockedCost = (blocked) => (x, y) => (blocked.has(`${x},${y}`) ? Infinity : 1);

test('straight path on an open grid', () => {
  const g = openGrid(10, 10);
  const p = findPath(g, { x: 0, y: 0 }, { x: 0, y: 5 }, { cost: () => 1 });
  assert.equal(p.length, 6);
  assert.deepEqual(p.at(-1), { x: 0, y: 5 });
});

test('routes around an obstacle', () => {
  const g = openGrid(7, 7);
  const blocked = new Set(['1,3', '2,3', '3,3', '4,3', '5,3']);
  const p = findPath(g, { x: 3, y: 0 }, { x: 3, y: 6 }, { cost: blockedCost(blocked) });
  assert.ok(p);
  assert.ok(p.every(({ x, y }) => !blocked.has(`${x},${y}`)));
});

test('does not cut corners between diagonal obstacles', () => {
  const g = openGrid(2, 2);
  // (1,0) and (0,1) blocked: the only route from (0,0) to (1,1) is the forbidden diagonal.
  const p = findPath(g, { x: 0, y: 0 }, { x: 1, y: 1 }, { cost: blockedCost(new Set(['1,0', '0,1'])) });
  assert.equal(p, null);
});

test('returns null when fully blocked', () => {
  const g = openGrid(5, 5);
  const blocked = new Set([0, 1, 2, 3, 4].map((x) => `${x},2`));
  assert.equal(findPath(g, { x: 2, y: 0 }, { x: 2, y: 4 }, { cost: blockedCost(blocked) }), null);
});

test('flow field: every reachable cell leads to the goal', () => {
  const g = openGrid(12, 10);
  for (let y = 0; y < 9; y++) g.terrain[g.index(6, y)] = 1;
  const goal = { x: 11, y: 0 };
  const cost = (x, y) => (g.terrainAt(x, y) === 0 ? 1 : Infinity);
  const f = computeFlowField(g, [goal], { cost });
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if (cost(x, y) === Infinity) continue;
      let i = g.index(x, y), steps = 0;
      while (f.next[i] >= 0 && steps < 200) { i = f.next[i]; steps++; }
      assert.equal(i, g.index(goal.x, goal.y), `cell ${x},${y} reaches the goal`);
    }
  }
});
