// Composition root: creates systems, views, UI and input, and runs the loop.
import * as THREE from 'three';
import { MAP, ECONOMY, WALLS, PATHING, CAMERA } from '../config/game.js';
import { MODELS } from '../config/assets.js';
import { Emitter } from '../core/events.js';
import { Economy } from '../core/economy.js';
import { createMapGrid } from '../core/grid.js';
import { WallSystem, zombieCostFn } from '../core/walls.js';
import { findPath } from '../core/pathfinding.js';
import { GameLoop } from '../core/loop.js';
import { createStage } from '../render/setup.js';
import { CameraController } from '../render/cameraController.js';
import { AssetLibrary } from '../render/assets.js';
import { WallView } from '../render/wallView.js';
import { buildWorld } from '../render/worldView.js';
import { Overlay } from '../render/overlay.js';
import { Interaction } from '../input/interaction.js';
import { Hud } from '../ui/hud.js';

export class Game {
  /** @param {HTMLElement} container */
  async init(container) {
    this.events = new Emitter();
    this.grid = createMapGrid(MAP);
    this.economy = new Economy(ECONOMY.startingGold, this.events);
    this.walls = new WallSystem(this.grid, this.economy, WALLS, this.events, ECONOMY);

    const { renderer, scene, center } = createStage(container, MAP, CAMERA.distance);
    this.renderer = renderer;
    this.scene = scene;
    this.cam = new CameraController(renderer.domElement, CAMERA,
      { minX: 0, maxX: MAP.width, minZ: 2, maxZ: MAP.height }, new THREE.Vector3(center.x, 0, center.z + 1));

    this.assets = new AssetLibrary();
    // Characters are not needed until phase 2.
    await this.assets.load(MODELS, Object.keys(MODELS).filter((k) => !['archer', 'walker'].includes(k)));
    buildWorld(scene, this.assets, this.grid, MAP);
    this.wallView = new WallView(scene, this.assets, this.walls, this.events);
    this.overlay = new Overlay(scene, this.grid, this.assets);

    this.hud = new Hud(document.body, {
      walls: this.walls, economy: this.economy, events: this.events, wallTypes: WALLS,
    });
    this.input = new Interaction({
      canvas: renderer.domElement, cam: this.cam, walls: this.walls, wallView: this.wallView,
      overlay: this.overlay, hud: this.hud, events: this.events, cameraCfg: CAMERA,
    });
    this.hud.onBuild((type) => this.input.enterBuild(type));
    this.hud.onSell((id) => this.walls.sell(id));

    // Zombie route preview (spawn -> gate), recomputed only when walls change.
    this.showPath = true;
    this.pathDirty = true;
    this.events.on('wallAdded', () => { this.pathDirty = true; });
    this.events.on('wallRemoved', () => { this.pathDirty = true; });
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !e.repeat) { this.showPath = !this.showPath; this.pathDirty = true; }
    });

    addEventListener('resize', () => {
      renderer.setSize(container.clientWidth, container.clientHeight);
      this.cam.update(0);
    });

    this.loop = new GameLoop({
      onStep: (dt) => this.step(dt),
      onFrame: (realDt) => this.frame(realDt),
    });
    this.loop.start();
  }

  /** Fixed-timestep simulation (combat, waves etc. arrive in phase 2). */
  step(_dt) {}

  frame(realDt) {
    this.cam.update(realDt);
    if (this.pathDirty) {
      this.pathDirty = false;
      this.currentPath = this.computeZombiePath();
      this.overlay.setPath(this.showPath ? this.currentPath : null);
    }
    this.renderer.render(this.scene, this.cam.camera);
  }

  computeZombiePath() {
    const cost = zombieCostFn(this.grid, this.walls, PATHING);
    return findPath(this.grid, { x: MAP.gateX, y: 1 }, { x: MAP.gateX, y: MAP.castleWallRow },
      { cost, isOpen: (x, y) => cost(x, y) === 1 });
  }
}
