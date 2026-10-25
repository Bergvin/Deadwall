import test from 'node:test';
import assert from 'node:assert/strict';
import { lineCells } from '../src/input/interaction.js';
import { pieceFor } from '../src/render/wallView.js';
import { DIR } from '../src/core/walls.js';

test('lineCells is 4-connected and inclusive', () => {
  for (const [a, b] of [[{ x: 0, y: 0 }, { x: 5, y: 3 }], [{ x: 4, y: 4 }, { x: 0, y: 0 }], [{ x: 2, y: 2 }, { x: 2, y: 7 }]]) {
    const cells = lineCells(a, b);
    assert.deepEqual(cells[0], a);
    assert.deepEqual(cells.at(-1), b);
    for (let i = 1; i < cells.length; i++) {
      const d = Math.abs(cells[i].x - cells[i - 1].x) + Math.abs(cells[i].y - cells[i - 1].y);
      assert.equal(d, 1, 'each step moves one orthogonal cell');
    }
  }
  assert.equal(lineCells({ x: 3, y: 3 }, { x: 3, y: 3 }).length, 1);
});

test('pieceFor picks straight, corner and junction pieces', () => {
  assert.deepEqual(pieceFor(0), ['wallPillar', 0]);
  assert.equal(pieceFor(DIR.N | DIR.S)[0], 'wallStraight');
  assert.equal(pieceFor(DIR.E | DIR.W)[1], Math.PI / 2);
  assert.equal(pieceFor(DIR.E)[0], 'wallStraight');
  const corners = [DIR.E | DIR.S, DIR.N | DIR.E, DIR.W | DIR.N, DIR.S | DIR.W].map(pieceFor);
  assert.ok(corners.every(([m]) => m === 'wallCorner'));
  assert.equal(new Set(corners.map(([, r]) => r)).size, 4, 'each corner has its own rotation');
  assert.equal(pieceFor(DIR.N | DIR.E | DIR.S)[0], 'towerBase');
});

test('axisLock keeps drags on the dominant axis', async () => {
  const { axisLock } = await import('../src/input/interaction.js');
  const a = { x: 10, y: 10 };
  assert.deepEqual(axisLock(a, { x: 4, y: 12 }), { x: 4, y: 10 }, 'mostly left -> horizontal');
  assert.deepEqual(axisLock(a, { x: 11, y: 3 }), { x: 10, y: 3 }, 'mostly up -> vertical');
  assert.deepEqual(axisLock(a, { x: 10, y: 10 }), a);
});
