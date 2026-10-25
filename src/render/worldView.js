// Static scenery: the castle along the south edge, terrain obstacles and set dressing.
import * as THREE from 'three';
import { TERRAIN } from '../core/grid.js';
import { PALETTE } from './setup.js';

const R90 = Math.PI / 2;

/**
 * @param {THREE.Scene} scene
 * @param {import('./assets.js').AssetLibrary} assets
 * @param {import('../core/grid.js').Grid} grid
 * @param {typeof import('../config/game.js').MAP} map
 */
export function buildWorld(scene, assets, grid, map) {
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);
  const place = (name, x, z, rotY = 0, y = 0, scale = 1) => {
    const o = assets.instance(name);
    o.position.set(x, y, z);
    o.rotation.y = rotY;
    o.scale.multiplyScalar(scale);
    root.add(o);
    return o;
  };

  // Tinted ground strips: spawn zone (north) and castle interior (south).
  const strip = (z0, z1, color, opacity) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(map.width, z1 - z0),
      new THREE.MeshStandardMaterial({ color, roughness: 1, transparent: true, opacity }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(map.width / 2, 0.005, (z0 + z1) / 2);
    m.receiveShadow = true;
    root.add(m);
  };
  strip(0, map.spawnRows, PALETTE.groundSpawn, 0.9);
  strip(map.castleWallRow, map.height, PALETTE.groundCastle, 1);

  // Castle wall: east-west wall with towers every 5 cells, two towers flanking the gate.
  const row = map.castleWallRow;
  const z = row + 0.5;
  const gx = map.gateX;
  let gate = null;
  for (let x = 0; x < map.width; x++) {
    const cx = x + 0.5;
    if (x === gx) {
      gate = place('gateDoor', cx, z, 0, 0, 1);
      continue;
    }
    const isTower = x === 0 || x === map.width - 1 || x === gx - 1 || x === gx + 1 || (x % 6 === 3);
    if (isTower) {
      place('towerBase', cx, z);
      place('towerMid', cx, z, 0, 1.01);
      place('towerTop', cx, z, 0, 2.02);
      if (x === gx - 1 || x === gx + 1) place('flag', cx, z, 0, 3.0);
    } else {
      place('wallStraight', cx, z, R90);
    }
  }
  // A keep behind the gate.
  for (const [dx, dz] of [[-2, 1.5], [2, 1.5]]) {
    place('towerBase', gx + 0.5 + dx, row + 0.5 + dz);
    place('towerMid', gx + 0.5 + dx, row + 0.5 + dz, 0, 1.01);
    place('towerRoof', gx + 0.5 + dx, row + 0.5 + dz, 0, 2.02);
  }

  // Braziers either side of the gate, outside the wall.
  for (const dx of [-1, 1]) {
    const bx = gx + 0.5 + dx * 1.6;
    place('fireBasket', bx, row - 0.2);
    const light = new THREE.PointLight(PALETTE.torch, 8, 6, 1.6);
    light.position.set(bx, 1.2, row - 0.2);
    root.add(light);
  }
  // Torches along the castle wall.
  for (let x = 3; x < map.width; x += 6) {
    const light = new THREE.PointLight(PALETTE.torch, 5, 5, 1.6);
    light.position.set(x + 0.5, 1.8, row - 0.1);
    root.add(light);
  }

  // Terrain obstacles: rocks on BLOCKED cells.
  const rockModels = ['rocksLarge', 'rocksSmall'];
  let k = 0;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.terrainAt(x, y) !== TERRAIN.BLOCKED) continue;
      place(rockModels[k++ % rockModels.length], x + 0.5, y + 0.5, (k * 1.7) % (2 * Math.PI));
    }
  }

  // Dead trees and debris outside the playable area (decorative, deterministic layout).
  const rand = mulberry32(7);
  for (let i = 0; i < 70; i++) {
    const side = i % 3;
    let x, zz;
    if (side === 0) { x = -1 - rand() * 6; zz = rand() * map.height; }
    else if (side === 1) { x = map.width + 1 + rand() * 6; zz = rand() * map.height; }
    else { x = rand() * map.width; zz = -1 - rand() * 6; }
    const model = rand() < 0.7 ? 'pineCrooked' : (rand() < 0.5 ? 'trunk' : 'gravestone');
    place(model, x, zz, rand() * Math.PI * 2, 0, 0.9 + rand() * 0.6);
  }
  return { root, gate };
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
