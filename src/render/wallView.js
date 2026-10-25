// Keeps 3D wall pieces in sync with WallSystem, choosing a piece and rotation from each
// cell's neighbour mask so lines, corners and junctions connect visually.
import * as THREE from 'three';
import { DIR } from '../core/walls.js';

const R90 = Math.PI / 2;
// Measured with a downward raycast: wall walkway top is at 1.18, tower-square-base top at
// 1.01. Junction blocks are stretched so their top is flush with the walkways.
const WALKWAY_HEIGHT = 1.18;
const TOWER_BASE_HEIGHT = 1.01;
const JUNCTION_SCALE_Y = WALKWAY_HEIGHT / TOWER_BASE_HEIGHT;

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
  return ['towerBase', 0, JUNCTION_SCALE_Y]; // T-junctions and crossings
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
    this.group = new THREE.Group();
    this.group.name = 'walls';
    scene.add(this.group);
    events.on('wallAdded', (w) => this.#refreshAround(w.x, w.y));
    events.on('wallRemoved', ({ wall }) => {
      this.#drop(wall.id);
      this.#refreshAround(wall.x, wall.y);
    });
  }

  /** Meshes to raycast against for picking. Each piece has userData.wallId. */
  get pickables() {
    return this.group.children;
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
    node.userData = { wallId: wall.id, model };
    this.group.add(node);
    this.#nodes.set(wall.id, node);
  }

  #drop(id) {
    const node = this.#nodes.get(id);
    if (!node) return;
    this.group.remove(node);
    this.#nodes.delete(id);
  }
}
