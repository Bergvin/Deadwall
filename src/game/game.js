// Composition root and state machine (menu -> map select -> playing -> game over). Owns
// everything that persists between runs (renderer, camera, models, shared renderers) and
// creates a fresh Session for every run (which builds that map's scenery).
import * as THREE from 'three';
import * as CFG from '../config/game.js';
import { MAP_RULES as MAP, CAMERA, ZOMBIES, MAPS } from '../config/game.js';
import { MODELS } from '../config/assets.js';
import { GameLoop } from '../core/loop.js';
import { loadSave, writeSave, recordRun, isMapUnlocked } from '../core/save.js';
import {
  runConfig, runXp, addXp, ensureOffer, choosePerk, equip, unequip, salvage, rollArtifactOffer, chooseArtifact, totalBonuses,
  setAutoSalvage, salvageUnkept,
} from '../core/commander.js';
import { createStage } from '../render/setup.js';
import { CameraController } from '../render/cameraController.js';
import { AssetLibrary } from '../render/assets.js';
import { ZombieView } from '../render/zombieView.js';
import { ProjectileView } from '../render/projectileView.js';
import { Effects } from '../render/effects.js';
import { Fx } from '../render/fx.js';
import { Sfx } from '../audio/sfx.js';
import { HealthBars } from '../render/healthBars.js';
import { FloatingText } from '../ui/floatingText.js';
import { Screens } from '../ui/screens.js';
import { Session } from './session.js';

export const STATE = { MENU: 'menu', PLAYING: 'playing', OVER: 'over' };

export class Game {
  /** @param {HTMLElement} container */
  async init(container) {
    this.container = container;
    this.state = STATE.MENU;
    this.save = loadSave();
    const { renderer, scene, center, ground } = createStage(container, MAP, CAMERA.distance);
    this.renderer = renderer;
    this.scene = scene;
    this.ground = ground;
    this.cam = new CameraController(renderer.domElement, CAMERA,
      { minX: 0, maxX: MAP.width, minZ: 2, maxZ: MAP.height }, new THREE.Vector3(center.x, 0, center.z + 1));

    this.assets = new AssetLibrary();
    await this.assets.load(MODELS);
    this.zombieView = new ZombieView(scene, this.assets, ZOMBIES);
    this.projectileView = new ProjectileView(scene);
    this.effects = new Effects(scene);
    this.fx = new Fx(scene);
    this.bars = new HealthBars(scene);
    this.floaters = new FloatingText(document.body);
    this.sfx = new Sfx(this.save.settings);

    this.loop = new GameLoop({
      onStep: (dt) => this.session?.sim.step(dt),
      onFrame: (realDt) => this.frame(realDt),
    });
    this.screens = new Screens(document.body, {
      onNewGame: () => this.chooseMap(),
      onPlayMap: (id) => this.newGame(undefined, id),
      onRetry: () => this.newGame(undefined, this.lastMap),
      onClassic: () => { location.href = './classic.html'; },
      onMenu: () => this.toMenu(),
      onCommander: () => this.openCommander(),
      onChooseArtifact: (i) => this.pickArtifact(i),
      onResume: () => this.togglePause(),
      getSettings: () => this.save.settings,
      setSetting: (key, value) => this.setSetting(key, value),
    });
    this.screens.mapName = (id) => MAPS.find((m) => m.id === id)?.name ?? id;
    this.applySettings();

    addEventListener('resize', () => {
      renderer.setSize(container.clientWidth, container.clientHeight);
      this.cam.update(0);
    });
    // Pause automatically when the tab is hidden so a run is never lost in the background.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === STATE.PLAYING && !this.loop.paused) this.togglePause();
    });

    this.toMenu();
    this.loop.start();
  }

  #endSession() {
    this.session?.dispose();
    this.session = null;
  }

  /** New Game first asks which map to play. */
  chooseMap() {
    this.#endSession();
    this.screens.hideGameOver();
    this.#resetPause();
    this.state = STATE.MENU;
    this.screens.showMapSelect(MAPS, this.save, (m) => isMapUnlocked(this.save, m));
  }

  newGame(seed, mapId = this.lastMap ?? MAPS[0].id) {
    this.#endSession();
    this.screens.hideMenu();
    this.screens.hideGameOver();
    this.screens.hideCommander();
    this.loop.speed = 1;
    this.#resetPause();
    this.lastMap = mapId;
    this.session = new Session({
      scene: this.scene, canvas: this.renderer.domElement, cam: this.cam, assets: this.assets, ground: this.ground,
      zombieView: this.zombieView, projectileView: this.projectileView,
      effects: this.effects, fx: this.fx, bars: this.bars, sfx: this.sfx, floaters: this.floaters,
      loop: this.loop, seed, mapId, togglePause: () => this.togglePause(),
      resume: () => this.resume(), setHold: (on) => this.setHold(on),
      // Every run plays with the Commander's perks, skills and equipped artifacts.
      config: runConfig(CFG, this.save.commander),
      settings: this.save.settings, setSetting: (k, v) => this.setSetting(k, v),
      onGameOver: (summary) => this.gameOver(summary),
    });
    this.state = STATE.PLAYING;
  }

  toMenu() {
    this.#endSession();
    this.state = STATE.MENU;
    this.#resetPause();
    this.screens.hideGameOver();
    this.screens.hideCommander();
    this.screens.showMenu(this.save);
  }

  /** Takes one of the three run-end artifacts and shows the result where the player is. */
  pickArtifact(index) {
    const res = chooseArtifact(this.save.commander, index);
    writeSave(this.save);
    if (!res) return;
    if (this.state === STATE.OVER && this.lastRun) {
      this.lastRun[3] = { ...this.lastRun[3], picked: res };
      if (this.screens.cmd.hidden) { this.screens.showGameOver(...this.lastRun); return; }
    }
    this.openCommander({ picked: res });
  }

  /** Commander screen (from the menu or the game over screen). */
  openCommander(ui = {}) {
    const cmd = this.save.commander;
    ensureOffer(cmd);
    writeSave(this.save);
    const from = this.state;
    const redraw = (next = {}) => this.openCommander(next);
    const act = (fn) => (arg) => { fn(cmd, arg); writeSave(this.save); redraw(); };
    this.screens.showCommander(cmd, {
      choose: act(choosePerk),
      chooseArtifact: (i) => this.pickArtifact(i),
      equip: act(equip),
      unequip: act(unequip),
      // Salvaging destroys an artifact, so it takes two clicks.
      salvage: (uid) => {
        if (ui.armedSalvage !== uid) { redraw({ armedSalvage: uid }); return; }
        salvage(cmd, uid);
        writeSave(this.save);
        redraw();
      },
      autoSalvage: act(setAutoSalvage),
      // Clearing the stash of unkept rarities also takes two clicks.
      salvageUnkept: () => {
        if (!ui.armedSweep) { redraw({ armedSweep: true }); return; }
        salvageUnkept(cmd);
        writeSave(this.save);
        redraw();
      },
      back: () => {
        this.screens.hideCommander();
        if (from === STATE.OVER && this.lastRun) this.screens.showGameOver(...this.lastRun);
        else this.toMenu();
      },
      backLabel: from === STATE.OVER ? 'Back' : 'Main Menu',
    }, ui);
  }

  gameOver(summary) {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.OVER;
    const rec = recordRun(this.save, summary);
    this.save = rec.save;
    const xp = runXp(summary);
    const levels = addXp(this.save.commander, xp);
    // Three artifacts to choose from: better odds the further this run got. It is saved
    // right away, so closing the game does not lose the choice.
    this.save.commander.artifactOffer = rollArtifactOffer(summary.wave, Math.random, totalBonuses(this.save.commander).artifactLuckPct ?? 0);
    writeSave(this.save);
    this.lastRun = [summary, this.save, rec, { xp, levels }];
    // Let the final moments play out behind the screen, then freeze.
    setTimeout(() => {
      if (this.state === STATE.OVER) this.screens.showGameOver(...this.lastRun);
    }, 1200);
  }

  /** Changes a persistent setting, applies it immediately and saves it. */
  setSetting(key, value) {
    this.save.settings[key] = value;
    writeSave(this.save);
    this.applySettings();
  }

  applySettings() {
    const s = this.save.settings;
    this.sfx.setVolume(s.volume);
    this.sfx.setMuted(s.muted);
    if (this.renderer.shadowMap.enabled !== s.shadows) {
      this.renderer.shadowMap.enabled = s.shadows;
      // Materials must recompile when shadow support changes.
      this.scene.traverse((o) => {
        for (const m of [].concat(o.material ?? [])) m.needsUpdate = true;
      });
    }
  }

  // Game time stops when the player pauses (the Paused panel) or while an overlay holds it
  // (the perk picker). The two are kept apart so releasing a hold never unpauses the player
  // and the panel always matches the player's pause.
  togglePause() {
    if (this.state !== STATE.PLAYING) return;
    this.userPaused = !this.userPaused;
    this.#applyPause();
  }

  /** Ends the player's pause (starting or calling a wave does this). */
  resume() {
    if (!this.userPaused) return;
    this.userPaused = false;
    this.#applyPause();
  }

  setHold(on) {
    this.held = on;
    this.#applyPause();
  }

  #applyPause() {
    this.loop.paused = !!(this.userPaused || this.held);
    this.screens.setPaused(!!this.userPaused);
  }

  #resetPause() {
    this.userPaused = false;
    this.held = false;
    this.#applyPause();
  }

  frame(realDt) {
    this.cam.update(realDt);
    this.session?.frame(realDt);
    this.renderer.render(this.scene, this.cam.camera);
  }
}
