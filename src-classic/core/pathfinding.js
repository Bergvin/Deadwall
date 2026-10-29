// Grid pathfinding: A* for single routes and a Dijkstra flow field for whole hordes.
// Movement is 8-directional; a diagonal step is only allowed when both orthogonal
// neighbours are open, so units never squeeze between diagonally touching walls.

const DIRS = [
  [0, -1, 1], [1, 0, 1], [0, 1, 1], [-1, 0, 1],
  [1, -1, Math.SQRT2], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** Binary min-heap keyed by a Float64Array of priorities (cell index -> priority). */
class MinHeap {
  constructor(priority) {
    this.items = [];
    this.priority = priority;
  }
  get size() { return this.items.length; }
  push(i) {
    const a = this.items;
    a.push(i);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.priority[a[p]] <= this.priority[a[c]]) break;
      [a[p], a[c]] = [a[c], a[p]];
      c = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = l + 1;
        let m = p;
        if (l < a.length && this.priority[a[l]] < this.priority[a[m]]) m = l;
        if (r < a.length && this.priority[a[r]] < this.priority[a[m]]) m = r;
        if (m === p) break;
        [a[p], a[m]] = [a[m], a[p]];
        p = m;
      }
    }
    return top;
  }
}

/**
 * @typedef {object} PathOptions
 * @property {(x:number, y:number) => number} cost  cost to enter a cell (Infinity = impassable)
 * @property {(x:number, y:number) => boolean} [isOpen]  cell counts as open for the
 *   diagonal corner rule; defaults to cost === 1
 */

function canStep(grid, x, y, dx, dy, opts, isOpen) {
  const nx = x + dx, ny = y + dy;
  if (!grid.inBounds(nx, ny)) return false;
  if (dx !== 0 && dy !== 0) {
    if (!isOpen(x + dx, y) || !isOpen(x, y + dy)) return false;
  }
  return opts.cost(nx, ny) !== Infinity;
}

/**
 * A* from start to goal. Returns [{x, y}, ...] including start and goal, or null.
 * @param {import('./grid.js').Grid} grid
 * @param {PathOptions} opts
 */
export function findPath(grid, start, goal, opts) {
  const isOpen = opts.isOpen ?? ((x, y) => grid.inBounds(x, y) && opts.cost(x, y) === 1);
  const n = grid.width * grid.height;
  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap(f);
  const h = (x, y) => {
    const dx = Math.abs(x - goal.x), dy = Math.abs(y - goal.y);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); // octile distance
  };
  const s = grid.index(start.x, start.y);
  const goalIdx = grid.index(goal.x, goal.y);
  g[s] = 0;
  f[s] = h(start.x, start.y);
  heap.push(s);

  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === goalIdx) break;
    closed[cur] = 1;
    const cx = cur % grid.width, cy = (cur / grid.width) | 0;
    for (const [dx, dy, len] of DIRS) {
      if (!canStep(grid, cx, cy, dx, dy, opts, isOpen)) continue;
      const nx = cx + dx, ny = cy + dy;
      const ni = grid.index(nx, ny);
      if (closed[ni]) continue;
      const ng = g[cur] + len * opts.cost(nx, ny);
      if (ng < g[ni]) {
        g[ni] = ng;
        f[ni] = ng + h(nx, ny);
        from[ni] = cur;
        heap.push(ni);
      }
    }
  }
  if (g[goalIdx] === Infinity) return null;
  const path = [];
  for (let i = goalIdx; i !== -1; i = from[i]) {
    path.push({ x: i % grid.width, y: (i / grid.width) | 0 });
  }
  return path.reverse();
}

/**
 * Dijkstra from one or more goal cells over the whole grid. `dist[i]` is the cost to
 * reach the nearest goal from cell i, `next[i]` is the index of the next cell on that
 * route (-1 for goals and unreachable cells). One field serves every unit heading to
 * the same goals, so it is recomputed only when the map changes.
 * @param {{x:number, y:number}[]} goals
 * @param {PathOptions} opts  cost is the cost of *entering* a cell when moving toward the goal
 */
export function computeFlowField(grid, goals, opts) {
  const isOpen = opts.isOpen ?? ((x, y) => grid.inBounds(x, y) && opts.cost(x, y) === 1);
  const n = grid.width * grid.height;
  const dist = new Float64Array(n).fill(Infinity);
  const next = new Int32Array(n).fill(-1);
  const heap = new MinHeap(dist);
  for (const gl of goals) {
    const i = grid.index(gl.x, gl.y);
    dist[i] = 0;
    heap.push(i);
  }
  const done = new Uint8Array(n);
  while (heap.size) {
    const cur = heap.pop();
    if (done[cur]) continue;
    done[cur] = 1;
    const cx = cur % grid.width, cy = (cur / grid.width) | 0;
    // Expand backwards: a unit at neighbour (nx, ny) would step into cur.
    const enterCost = opts.cost(cx, cy);
    for (const [dx, dy, len] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!grid.inBounds(nx, ny)) continue;
      if (opts.cost(nx, ny) === Infinity) continue;
      if (dx !== 0 && dy !== 0 && (!isOpen(cx, ny) || !isOpen(nx, cy))) continue;
      const ni = grid.index(nx, ny);
      const nd = dist[cur] + len * enterCost;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        next[ni] = cur;
        heap.push(ni);
      }
    }
  }
  return { dist, next };
}
