// Road polylines: zombies walk along them by distance `s` from the start. Pure geometry.

/** @param {number[][]} points [[x, z], ...] in world units */
export function buildPath(points) {
  const segs = [];
  let start = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) continue;
    segs.push({ x: x0, z: z0, dx: (x1 - x0) / len, dz: (z1 - z0) / len, len, start });
    start += len;
  }
  return { points: points.map(([x, z]) => ({ x, z })), segs, length: start };
}

/** Position and direction at distance s along the path (clamped to its ends). */
export function pointAt(path, s) {
  const segs = path.segs;
  let i = 0;
  if (s <= 0) i = 0;
  else {
    // Paths are short (under ten segments): a linear scan is fastest.
    while (i < segs.length - 1 && s > segs[i].start + segs[i].len) i++;
  }
  const g = segs[i];
  const t = Math.min(Math.max(s - g.start, 0), g.len);
  return { x: g.x + g.dx * t, z: g.z + g.dz * t, dx: g.dx, dz: g.dz };
}

/** Shortest distance from (x, z) to the path's centre line. */
export function distanceToPath(path, x, z) {
  let best = Infinity;
  for (const g of path.segs) {
    const t = Math.min(g.len, Math.max(0, (x - g.x) * g.dx + (z - g.z) * g.dz));
    const px = g.x + g.dx * t, pz = g.z + g.dz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}

/** How much of the path lies within `range` of (x, z) (sampled; cells of road covered). */
export function coverage(path, x, z, range, step = 0.25) {
  let n = 0;
  for (let s = 0; s <= path.length; s += step) {
    const p = pointAt(path, s);
    if ((p.x - x) ** 2 + (p.z - z) ** 2 <= range * range) n++;
  }
  return n * step;
}
