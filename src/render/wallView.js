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

/** Per-type colour multiplied into the shared stone texture. */
const TYPE_TINT = {
  stone: [1, 1, 1],
  reinforced: [0.72, 0.68, 0.64],
  spiked: [0.92, 0.8, 0.68],
  arcane: [0.55, 0.6, 0.9],
};

/** Shared decoration geometry and materials, created on first use. */
let DECO = null;
function deco() {
  if (DECO) return DECO;
  const spike = new THREE.ConeGeometry(0.055, 0.34, 6);
  spike.rotateX(Math.PI / 2); // point along +z
  const ring = new THREE.RingGeometry(0.96, 1, 48);
  ring.rotateX(-Math.PI / 2);
  DECO = {
    band: new THREE.BoxGeometry(1.04, 0.07, 1.04),
    trim: new THREE.BoxGeometry(1.03, 0.035, 1.03),
    spike,
    crystal: new THREE.OctahedronGeometry(0.11),
    ring,
    iron: new THREE.MeshLambertMaterial({ color: 0x2c2a28 }),
    steel: new THREE.MeshLambertMaterial({ color: 0x8a8a90 }),
    gold: new THREE.MeshBasicMaterial({ color: 0xd8a83c }),
    rune: new THREE.MeshBasicMaterial({ color: 0x5aa8ff }),
    aura: new THREE.MeshBasicMaterial({ color: 0x5aa8ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
  };
  return DECO;
}

export class WallView {
  /** id -> Object3D */
  #nodes = new Map();
  /** "materialUuid:type" -> tinted material shared by all walls of that type */
  #typeMats = new Map();

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
    this.time = 0;
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
    events.on('wallUpgraded', ({ wall }) => this.#rebuild(wall, true));
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

  #typed(mat, type) {
    const key = `${mat.uuid}:${type}`;
    let m = this.#typeMats.get(key);
    if (!m) {
      m = mat.clone();
      m.color.setRGB(...TYPE_TINT[type]);
      this.#typeMats.set(key, m);
    }
    return m;
  }

  #rebuild(wall, force = false) {
    const mask = this.walls.connectionMask(wall.x, wall.y);
    const current = this.#nodes.get(wall.id);
    if (!force && current?.userData.mask === mask) return;
    const [model, rot, scaleY] = pieceFor(mask);
    this.#drop(wall.id);
    const node = this.assets.instance(model);
    node.position.set(wall.x + 0.5, 0, wall.y + 0.5);
    node.rotation.y = rot;
    node.scale.y *= scaleY;
    node.traverse((o) => { if (o.isMesh) o.material = this.#typed(o.material, wall.type); });
    node.userData = { wallId: wall.id, model, mask, shake: 0, worn: null, crystal: null, aura: null };
    this.#decorate(node, wall, mask, rot);
    this.group.add(node);
    this.#nodes.set(wall.id, node);
    if (wall.hp < wall.maxHp) this.#applyWear(node, wall);
  }

  /** Type and level decorations, in a child group counter-rotated to world axes. */
  #decorate(node, wall, mask, rot) {
    const d = deco();
    const g = new THREE.Group();
    g.rotation.y = -rot;
    const add = (geom, mat, x, y, z, ry = 0) => {
      const m = new THREE.Mesh(geom, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = true;
      g.add(m);
      return m;
    };
    if (wall.type === 'reinforced') {
      add(d.band, d.iron, 0, 0.32, 0);
      add(d.band, d.iron, 0, 0.82, 0);
    } else if (wall.type === 'spiked') {
      // Spikes on every face that does not join another wall, pointing outward.
      const faces = [[DIR.N, 0, -1], [DIR.E, 1, 0], [DIR.S, 0, 1], [DIR.W, -1, 0]];
      for (const [bit, fx, fz] of faces) {
        if (mask & bit) continue;
        for (const t of [-0.3, 0, 0.3]) {
          for (const y of [0.35, 0.7]) {
            add(d.spike, d.steel, fx * 0.56 + fz * t, y, fz * 0.56 + fx * t, Math.atan2(fx, fz));
          }
        }
      }
    } else if (wall.type === 'arcane') {
      add(d.band, d.rune, 0, 0.6, 0);
      node.userData.crystal = add(d.crystal, d.rune, 0, 1.45, 0);
      const aura = add(d.ring, d.aura, 0, 0.03, 0);
      aura.castShadow = false;
      aura.scale.setScalar(wall.arcane.radius);
      aura.raycast = () => {}; // never pickable
      node.userData.aura = aura;
    }
    for (let i = 1; i < wall.level; i++) add(d.trim, d.gold, 0, 1.0 + i * 0.06, 0);
    node.add(g);
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
        if (!o.isMesh || !this.#isTyped(o.material)) return;
        o.material = o.material.clone();
        node.userData.worn.push(o.material);
      });
    }
    // Below half health, fallen stones pile up at the foot of the wall.
    if (ratio < 0.5 && !node.userData.rubble) {
      const rubble = this.assets.instance('debris');
      rubble.scale.setScalar(0.6);
      rubble.position.set(0.15, 0, 0.3);
      node.userData.rubble = rubble;
      node.add(rubble);
    } else if (ratio >= 0.5 && node.userData.rubble) {
      node.remove(node.userData.rubble);
      node.userData.rubble = null;
    }
    const k = 1 - ratio;
    const [r, gr, b] = TYPE_TINT[wall.type];
    for (const m of node.userData.worn) m.color.setRGB(r * (1 - 0.55 * k), gr * (1 - 0.62 * k), b * (1 - 0.66 * k));
  }

  #isTyped(mat) {
    for (const m of this.#typeMats.values()) if (m === mat) return true;
    return false;
  }

  /** Hit shake and arcane animation; call every frame with real dt. */
  update(dt) {
    this.time += dt;
    for (const node of this.#nodes.values()) {
      const u = node.userData;
      if (u.crystal) {
        u.crystal.position.y = 1.45 + Math.sin(this.time * 2 + u.wallId) * 0.05;
        u.crystal.rotation.y += dt * 1.5;
        u.aura.material.opacity = 0.25 + 0.12 * Math.sin(this.time * 3);
      }
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
    for (const m of this.#typeMats.values()) m.dispose();
    this.#typeMats.clear();
    this.group.parent?.remove(this.group);
  }
}
