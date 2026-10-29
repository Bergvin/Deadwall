import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath, computeFlowField } from '../../src-classic/core/pathfinding.js';
import { zombieCostFn } from '../../src-classic/core/walls.js';
import { makeWorld, openGrid } from './helpers.js';
import { MAP, PATHING } from '../../src-classic/config/game.js';

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

test('zombies go around a short wall but through a full wall line', () => {
  const { grid, walls } = makeWorld({ gold: 10000 });
  const cost = zombieCostFn(grid, walls, PATHING);
  const isOpen = (x, y) => cost(x, y) === 1;
  const start = { x: MAP.gateX, y: 1 };
  const goal = { x: MAP.gateX, y: MAP.castleWallRow };
  const touchesWall = (p) => p.some(({ x, y }) => walls.at(x, y));

  for (let x = 12; x <= 18; x++) walls.build('stone', x, 10);
  let p = findPath(grid, start, goal, { cost, isOpen });
  assert.ok(p && !touchesWall(p), 'detours around a 7-wide wall');

  for (let x = 0; x < MAP.width; x++) walls.build('stone', x, 10);
  p = findPath(grid, start, goal, { cost, isOpen });
  assert.ok(p && touchesWall(p), 'breaks through a complete line');
  assert.equal(p.filter(({ x, y }) => walls.at(x, y)).length, 1, 'through exactly one wall');
});

test('path reacts when a wall is removed', () => {
  const { grid, walls } = makeWorld({ gold: 10000 });
  const cost = zombieCostFn(grid, walls, PATHING);
  for (let x = 0; x < MAP.width; x++) walls.build('stone', x, 10);
  const gap = walls.at(3, 10);
  walls.destroy(gap.id);
  const p = findPath(grid, { x: 3, y: 1 }, { x: MAP.gateX, y: MAP.castleWallRow }, { cost });
  assert.ok(p.some(({ x, y }) => x === 3 && y === 10), 'uses the new opening');
  assert.ok(!p.some(({ x, y }) => walls.at(x, y)), 'no longer attacks a wall');
});

test('flow field: every reachable cell leads to the goal', () => {
  const { grid, walls } = makeWorld({ gold: 10000 });
  const cost = zombieCostFn(grid, walls, PATHING);
  for (let x = 0; x < MAP.width; x++) if (x !== 23) walls.build('stone', x, 12);
  const goal = { x: MAP.gateX, y: MAP.castleWallRow };
  const { dist, next } = computeFlowField(grid, [goal], { cost });
  const goalIdx = grid.index(goal.x, goal.y);
  for (let y = 0; y < MAP.spawnRows; y++) {
    for (let x = 0; x < MAP.width; x++) {
      let i = grid.index(x, y);
      if (dist[i] === Infinity) continue;
      let steps = 0;
      while (i !== goalIdx && steps++ < 500) i = next[i];
      assert.equal(i, goalIdx, `from ${x},${y}`);
    }
  }
  // Near the gap the field funnels through it rather than attacking walls. (From far
  // away, breaking one wall can be cheaper than a long detour, which is intended.)
  const spawn = grid.index(23, 1);
  let i = spawn, usedGap = false;
  while (i !== goalIdx) {
    const x = i % grid.width, y = (i / grid.width) | 0;
    assert.ok(!walls.at(x, y));
    if (x === 23 && y === 12) usedGap = true;
    i = next[i];
  }
  assert.ok(usedGap);
});
