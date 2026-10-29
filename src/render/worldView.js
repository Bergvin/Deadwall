// Scenery of one map: the house, rocks, river, set dressing, torches at the house and
// the painted ground (roads). Built per run because every map looks different.
import * as THREE from 'three';
import { TERRAIN } from '../core/grid.js';
import { PALETTE } from './setup.js';
import { makeGroundTexture } from './ambience.js';

/** Size of the house: the Kenney square tower stretched over its 2x2 cells. */
const HOUSE_SCALE = { xz: 1.75, y: 1.15 };

/**
 * @param {THREE.Scene} scene
 * @param {import('./assets.js').AssetLibrary} assets
 * @param {import('../core/simulation.js').Simulation} sim
 * @param {THREE.Mesh} ground the shared ground plane (gets this map's texture)
 */
export function buildWorld(scene, assets, sim, ground) {
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);
  const grid = sim.grid;
  const place = (name, x, z, rotY = 0, y = 0, scale = 1) => {
    const o = assets.instance(name);
    o.position.set(x, y, z);
    o.rotation.y = rotY;
    o.scale.multiplyScalar(scale);
    root.add(o);
    return o;
  };

  // Ground: roads and water painted into one texture.
  const water = [];
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) if (grid.terrainAt(x, y) === TERRAIN.WATER) water.push({ x, y });
  const oldMap = ground.material.map;
  ground.material.map = makeGroundTexture(grid, sim.paths, water, 20);
  ground.material.color.set(0xffffff);
  ground.material.needsUpdate = true;
  oldMap?.dispose();
  // A faint sheen over the water.
  if (water.length) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a5a78, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.35 });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.InstancedMesh(geo, mat, water.length);
    const mx = new THREE.Matrix4();
    water.forEach((c, i) => m.setMatrixAt(i, mx.makeTranslation(c.x + 0.5, 0.03, c.y + 0.5)));
    m.receiveShadow = true;
    root.add(m);
  }

  // The house: a stout stone keep with a flag, its door facing the first road's end.
  const h = sim.house;
  const end = sim.paths[0].points.at(-1);
  const doorAngle = Math.atan2(end.x - h.x, end.z - h.z);
  const house = new THREE.Group();
  house.position.set(h.x, 0, h.z);
  root.add(house);
  const piece = (name, y) => {
    const o = assets.instance(name);
    o.scale.set(HOUSE_SCALE.xz, HOUSE_SCALE.y, HOUSE_SCALE.xz);
    o.position.y = y;
    house.add(o);
    return o;
  };
  piece('towerBase', 0);
  piece('towerMid', 1.01 * HOUSE_SCALE.y);
  piece('towerRoof', 2.02 * HOUSE_SCALE.y);
  const flag = assets.instance('flag');
  flag.position.y = 3.2 * HOUSE_SCALE.y;
  house.add(flag);
  house.rotation.y = doorAngle;

  // Torches by the door; their light flickers and they throw embers (see ambience.js).
  const lights = [], emitters = [];
  const fx = Math.sin(doorAngle), fz = Math.cos(doorAngle);
  for (const side of [-1, 1]) {
    const bx = h.x + fx * 1.3 + fz * side * 1.1, bz = h.z + fz * 1.3 - fx * side * 1.1;
    if (!grid.isWalkable(Math.floor(bx), Math.floor(bz)) || grid.terrainAt(Math.floor(bx), Math.floor(bz)) === TERRAIN.ROAD) continue;
    place('fireBasket', bx, bz, 0, 0, 0.7);
    const light = new THREE.PointLight(PALETTE.torch, 7, 6, 1.6);
    light.position.set(bx, 1.1, bz);
    root.add(light);
    lights.push(light);
    emitters.push({ x: bx, y: 0.8, z: bz });
  }
  const glow = new THREE.PointLight(PALETTE.torch, 10, 9, 1.4);
  glow.position.set(h.x, 2.6, h.z);
  root.add(glow);
  lights.push(glow);

  // Where the roads come in: braziers and gravestones.
  for (const p of sim.paths) {
    const a = p.points[0];
    const x = Math.min(grid.width - 0.4, Math.max(0.4, a.x)), z = Math.min(grid.height - 0.4, Math.max(0.4, a.z));
    const d = p.segs[0];
    for (const side of [-1, 1]) {
      const gx = x - d.dz * side * 1.5, gz = z + d.dx * side * 1.5;
      place('gravestone', gx, gz, Math.atan2(d.dx, d.dz) + side * 0.3, 0, 0.9);
    }
    const light = new THREE.PointLight(0xc03020, 5, 6, 1.6);
    light.position.set(x, 1, z);
    root.add(light);
    lights.push(light);
  }

  // Rocks on blocked cells.
  const rockModels = ['rocksLarge', 'rocksSmall', 'rocks'];
  let k = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.terrainAt(x, y) !== TERRAIN.BLOCKED) continue;
      place(rockModels[k++ % rockModels.length], x + 0.5, y + 0.5, (k * 1.7) % (2 * Math.PI));
    }
  }

  // Dead trees and debris around the battlefield (deterministic per map).
  const rand = mulberry32(7 + sim.map.id.length * 31);
  for (let i = 0; i < 90; i++) {
    const side = i % 4;
    let x, zz;
    if (side === 0) { x = -1 - rand() * 6; zz = rand() * grid.height; }
    else if (side === 1) { x = grid.width + 1 + rand() * 6; zz = rand() * grid.height; }
    else if (side === 2) { x = rand() * grid.width; zz = -1 - rand() * 6; }
    else { x = rand() * grid.width; zz = grid.height + 1 + rand() * 6; }
    // Keep the roads' entrances clear.
    if (sim.paths.some((p) => Math.hypot(p.points[0].x - x, p.points[0].z - zz) < 3)) continue;
    const model = rand() < 0.7 ? 'pineCrooked' : (rand() < 0.5 ? 'trunk' : 'gravestone');
    place(model, x, zz, rand() * Math.PI * 2, 0, 0.9 + rand() * 0.6);
  }
  return {
    root, house, lights, emitters,
    dispose() {
      scene.remove(root);
    },
  };
}

/** Small deterministic PRNG so the decoration layout is the same every run. */
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
