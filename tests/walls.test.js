import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers.js';
import { DIR } from '../src/core/walls.js';
import { MAP, WALLS, ECONOMY } from '../src/config/game.js';

const cost = WALLS.stone.cost;

test('building charges gold and occupies the cell', () => {
  const { walls, economy, grid } = makeWorld({ gold: 100 });
  const w = walls.build('stone', 10, 10);
  assert.ok(w);
  assert.equal(economy.gold, 100 - cost);
  assert.equal(grid.wallAt(10, 10), w.id);
  assert.equal(walls.at(10, 10), w);
});

test('invalid placements are rejected without charging', () => {
  const { walls, economy, log } = makeWorld({ gold: 100 });
  walls.build('stone', 10, 10);
  const before = economy.gold;
  const [bx, by] = MAP.blocked[0];
  const cases = [
    [10, 10, 'occupied'],
    [-1, 5, 'out_of_bounds'],
    [5, 0, 'not_buildable'], // spawn zone
    [5, MAP.castleWallRow, 'not_buildable'],
    [bx, by, 'not_buildable'],
  ];
  for (const [x, y, reason] of cases) {
    assert.equal(walls.build('stone', x, y), null, `${x},${y}`);
    assert.equal(log.at(-1).p.reason, reason);
  }
  assert.equal(economy.gold, before);
});

test('cannot build without enough gold', () => {
  const { walls, economy } = makeWorld({ gold: cost * 2 + 5 });
  assert.ok(walls.build('stone', 5, 5));
  assert.ok(walls.build('stone', 6, 5));
  assert.equal(walls.canBuild('stone', 7, 5).reason, 'insufficient_gold');
  assert.equal(walls.build('stone', 7, 5), null);
  assert.equal(economy.gold, 5);
});

test('selling refunds a fraction scaled by health and frees the cell', () => {
  const { walls, economy, grid } = makeWorld({ gold: 100 });
  const w = walls.build('stone', 8, 8);
  w.hp = w.maxHp / 2;
  const expected = Math.floor(cost * ECONOMY.sellRefund * 0.5);
  assert.equal(walls.sellValue(w.id), expected);
  const before = economy.gold;
  assert.equal(walls.sell(w.id), true);
  assert.equal(economy.gold, before + expected);
  assert.equal(grid.wallAt(8, 8), 0);
  assert.equal(walls.sell(w.id), false, 'cannot sell twice');
  assert.equal(economy.gold, before + expected);
});

test('build/sell loop never creates gold', () => {
  const { walls, economy } = makeWorld({ gold: 100 });
  for (let i = 0; i < 20; i++) {
    const w = walls.build('stone', 12, 12);
    if (w) walls.sell(w.id);
  }
  assert.ok(economy.gold < 100);
});

test('destroyed wall frees its cell and can be rebuilt', () => {
  const { walls, grid } = makeWorld();
  const w = walls.build('stone', 9, 9);
  walls.destroy(w.id);
  assert.equal(grid.wallAt(9, 9), 0);
  assert.ok(walls.build('stone', 9, 9));
});

test('connection mask reflects orthogonal neighbours', () => {
  const { walls } = makeWorld();
  walls.build('stone', 10, 10);
  walls.build('stone', 11, 10);
  walls.build('stone', 10, 11);
  walls.build('stone', 13, 9); // not adjacent to either
  assert.equal(walls.connectionMask(10, 10), DIR.E | DIR.S);
  assert.equal(walls.connectionMask(11, 10), DIR.W);
  assert.equal(walls.connectionMask(10, 11), DIR.N);
});

test('wall ids are unique', () => {
  const { walls } = makeWorld();
  const ids = new Set();
  for (let x = 3; x < 13; x++) ids.add(walls.build('stone', x, 10).id);
  assert.equal(ids.size, 10);
});
