// Keeps 3D wall pieces in sync with WallSystem, choosing a piece and rotation from each
// cell's neighbour mask so lines, corners and junctions connect visually.
import * as THREE from 'three';
import { DIR } from '../core/walls.js';

const R90 = Math.PI / 2;
// Wall walkway top, measured with a downward raycast on wall.glb.
const WALKWAY_HEIGHT = 1.18;
/** Seconds a wall shakes after being hit. */
const SHAKE_TIME = 0.15;

/**
 * Picks [modelName, rotationY, scaleY] for a connection mask.
 * See config/assets.js for piece orientation.
 */
export function pieceFor(mask) {
  const n = !!(mask & DIR.N), e = !!(mask & DIR.E), s = !!(mask & DIR.S), w = !!(mask & DIR.W);
  const count = n + e + s + w;
  if (count === 0) return ['wallPillar', 0, 1];
  if (count === 1 || (count === 2 && ((n && s) || (e && w)))) {
    return ['wallStraight', n || s ? 0 : R90, 1];
  }
  if (count === 2) {
    // Corner at rotation 0 connects S+W (verified top-down); each +90deg turns the pair
    // counter-clockwise seen from above: S+W -> E+S -> N+E -> W+N.
    if (s && w) return ['wallCorner', 0, 1];
    if (e && s) return ['wallCorner', R90, 1];
    if (n && e) return ['wallCorner', 2 * R90, 1];
    return ['wallCorner', 3 * R90, 1]; // w && n
  }
  // Junctions (see createJunctionPieces). Junction pieces are straight walls with the rim
  // removed on the joined side: local +x maps to world E at rotation 0 and to world N at 90.
  if (count === 4) return ['wallCross', 0, 1];
  if (!s) return ['wallJunctionE', R90, 1]; // N+E+W: through E-W, branch N (local +x)
  if (!n) return ['wallJunctionW', R90, 1]; // E+S+W: through E-W, branch S (local -x)
  if (!w) return ['wallJunctionE', 0, 1]; // N+E+S: through N-S, branch E (local +x)
  return ['wallJunctionW', 0, 1]; // N+S+W: through N-S, branch W (local -x)
}

// The straight wall (rotation 0) runs north-south with a battlement rim on each long side,
// occupying x in [RIM_INNER_X, 0.5] (and its mirror) above the walkway.
const RIM_INNER_X = 0.29;

/**
 * Builds junction pieces from the straight wall so their faces, colours and battlements
 * match exactly. In the straight wall's own frame (runs N-S, rims on local +x and -x) a
 * junction removes the rim on each side where another wall joins and fills that strip with
 * walkway, leaving open floor where walls meet and keeping battlements on open sides.
 * Returns prototypes: junctionE (local +x rim removed), junctionW (-x removed), cross (both).
 * @param {THREE.Object3D} wallProto  the straight wall prototype
 */
export function createJunctionPieces(wallProto) {
  let mesh = null;
  wallProto.traverse((o) => { if (o.isMesh) mesh ??= o; });
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const { position: pos, normal: nrm, uv } = src.attributes;

  let walkwayUv = null;
  for (let i = 0; i < pos.count && !walkwayUv; i++) {
    if (Math.abs(pos.getY(i) - WALKWAY_HEIGHT) < 0.01 && nrm.getY(i) > 0.9) walkwayUv = [uv.getX(i), uv.getY(i)];
  }

  const build = (removeE, removeW) => {
    const P = [], N = [], U = [];
    for (let t = 0; t < pos.count; t += 3) {
      let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = t; k < t + 3; k++) {
        minX = Math.min(minX, pos.getX(k)); maxX = Math.max(maxX, pos.getX(k)); maxY = Math.max(maxY, pos.getY(k));
      }
      const aboveWalkway = maxY > WALKWAY_HEIGHT + 0.001;
      if (aboveWalkway && removeE && minX >= RIM_INNER_X - 0.01) continue;
      if (aboveWalkway && removeW && maxX <= -RIM_INNER_X + 0.01) continue;
      for (let k = t; k < t + 3; k++) {
        P.push(pos.getX(k), pos.getY(k), pos.getZ(k));
        N.push(nrm.getX(k), nrm.getY(k), nrm.getZ(k));
        U.push(uv.getX(k), uv.getY(k));
      }
    }
    // Walkway filler where a rim was removed (two triangles, facing up).
    const fill = (x0, x1) => {
      const y = WALKWAY_HEIGHT;
      for (const [x, z] of [[x0, -0.5], [x0, 0.5], [x1, 0.5], [x0, -0.5], [x1, 0.5], [x1, -0.5]]) {
        P.push(x, y, z); N.push(0, 1, 0); U.push(...walkwayUv);
      }
    };
    if (removeE) fill(RIM_INNER_X - 0.01, 0.5);
    if (removeW) fill(-0.5, -RIM_INNER_X + 0.01);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    const m = new THREE.Mesh(g, mesh.material);
    m.castShadow = m.receiveShadow = true;
    const root = new THREE.Group();
    root.add(m);
    return root;
  };
  return { junctionE: build(true, false), junctionW: build(false, true), cross: build(true, true) };
}

export class WallView {
  /** id -> Object3D */
  #nodes = new Map();

  /**
   * @param {THREE.Scene} scene
   * @param {import('./assets.js').AssetLibrary} assets
   * @param {import('../core/walls.js').WallSystem} walls
   * @param {import('../core/events.js').Emitter} events
   */
  constructor(scene, assets, walls, events) {
    this.scene = scene;
    this.assets = assets;
    this.walls = walls;
    const j = createJunctionPieces(assets.proto('wallStraight'));
    assets.register('wallJunctionE', j.junctionE);
    assets.register('wallJunctionW', j.junctionW);
    assets.register('wallCross', j.cross);
    this.group = new THREE.Group();
    this.group.name = 'walls';
    scene.add(this.group);
    events.on('wallAdded', (w) => this.#refreshAround(w.x, w.y));
    events.on('wallRemoved', ({ wall }) => {
      this.#drop(wall.id);
      this.#refreshAround(wall.x, wall.y);
    });
    events.on('wallDamaged', ({ wall }) => {
      const node = this.#nodes.get(wall.id);
      if (!node) return;
      this.#applyWear(node, wall);
      node.userData.shake = SHAKE_TIME;
    });
    events.on('wallRepaired', ({ wall }) => {
      const node = this.#nodes.get(wall.id);
      if (node) this.#applyWear(node, wall);
    });
  }

  /** Meshes to raycast against for picking. Each piece has userData.wallId. */
  get pickables() {
    return this.group.children;
  }

  node(id) {
    return this.#nodes.get(id) ?? null;
  }

  #refreshAround(x, y) {
    for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const w = this.walls.at(x + dx, y + dy);
      if (w) this.#rebuild(w);
    }
  }

  #rebuild(wall) {
    const [model, rot, scaleY] = pieceFor(this.walls.connectionMask(wall.x, wall.y));
    const current = this.#nodes.get(wall.id);
    if (current?.userData.model === model && current.rotation.y === rot) return;
    this.#drop(wall.id);
    const node = this.assets.instance(model);
    node.position.set(wall.x + 0.5, 0, wall.y + 0.5);
    node.rotation.y = rot;
    node.scale.y *= scaleY;
    node.userData = { wallId: wall.id, model, shake: 0, worn: null };
    this.group.add(node);
    this.#nodes.set(wall.id, node);
    if (wall.hp < wall.maxHp) this.#applyWear(node, wall);
  }

  /**
   * Progressive deterioration: the piece darkens toward scorched stone as it loses health.
   * Materials are cloned per damaged wall on first use so other walls are unaffected.
   */
  #applyWear(node, wall) {
    const ratio = wall.hp / wall.maxHp;
    if (!node.userData.worn) {
      if (ratio >= 1) return;
      node.userData.worn = [];
      node.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        node.userData.worn.push(o.material);
      });
    }
    const k = 1 - ratio;
    for (const m of node.userData.worn) m.color.setRGB(1 - 0.55 * k, 1 - 0.62 * k, 1 - 0.66 * k);
  }

  /** Hit shake; call every frame with real dt. */
  update(dt) {
    for (const node of this.#nodes.values()) {
      const u = node.userData;
      if (u.shake <= 0) continue;
      u.shake = Math.max(0, u.shake - dt);
      const w = this.walls.get(u.wallId);
      const a = u.shake > 0 ? 0.04 * (u.shake / SHAKE_TIME) : 0;
      node.position.x = w.x + 0.5 + (Math.random() - 0.5) * a;
      node.position.z = w.y + 0.5 + (Math.random() - 0.5) * a;
    }
  }

  #drop(id) {
    const node = this.#nodes.get(id);
    if (!node) return;
    this.group.remove(node);
    for (const m of node.userData.worn ?? []) m.dispose();
    this.#nodes.delete(id);
  }

  dispose() {
    for (const id of [...this.#nodes.keys()]) this.#drop(id);
    this.group.parent?.remove(this.group);
  }
}
