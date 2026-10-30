// One run on one map: the Simulation plus everything that only lives for that run (the
// map's scenery, ambience and overlay, tower and runner views, input, HUD, event wiring).
// Shared, persistent pieces (renderer, camera, assets, horde/projectile/effect renderers)
// are passed in and only reset. dispose() removes every trace of the run.
import { Simulation } from '../core/simulation.js';
import { CAMERA } from '../config/game.js';
import { buildWorld } from '../render/worldView.js';
import { Ambience } from '../render/ambience.js';
import { PortalView } from '../render/portalView.js';
import { Overlay } from '../render/overlay.js';
import { TowerView } from '../render/towerView.js';
import { RunnerView } from '../render/runnerView.js';
import { healthColor } from '../render/healthBars.js';
import { FX_COLORS } from '../render/fx.js';
import { Interaction } from '../input/interaction.js';
import { Hud } from '../ui/hud.js';

export class Session {
  /**
   * @param {{scene, canvas, cam, assets, ground, zombieView, projectileView, effects, fx, bars,
   *          floaters, sfx, loop, onGameOver, seed?, mapId, config, settings, setSetting}} shared
   */
  constructor(shared) {
    this.shared = shared;
    const { scene, canvas, cam, assets } = shared;
    this.abort = new AbortController();
    this.sim = new Simulation({ seed: shared.seed, mapId: shared.mapId, ...(shared.config ? { config: shared.config } : {}) });
    const sim = this.sim;
    const C = sim.config;
    this.world = buildWorld(scene, assets, sim, shared.ground);
    this.ambience = new Ambience(scene, this.world, C.MAP_RULES, sim.paths.map((p) => p.points[0]));
    this.portalView = new PortalView(scene, assets, sim, C.MAP_RULES);
    // The build grid only shows cells a tower can go on (free ground, not next to a tower).
    this.overlay = new Overlay(scene, sim.grid, assets, (x, y) => sim.grid.isBuildable(x, y) && !sim.towers.tooClose(x, y));
    for (const e of ['towerBuilt', 'towerRemoved']) sim.events.on(e, () => this.overlay.invalidateGrid());
    this.towerView = new TowerView(scene, assets, sim.towers, sim.events, C.TOWERS, C.TOWER_RULES);
    this.runnerView = new RunnerView(scene, assets, sim.runner, sim.events, C.RUNNER);
    // Spells keep their auto-cast choice between runs.
    sim.runner.setAutoCastAll(!!shared.settings?.autoCastAll);
    for (const [id, on] of Object.entries(shared.settings?.autoCast ?? {})) sim.runner.setAutoCast(id, on);
    // Start with the camera on the house.
    cam.target.set(sim.house.x, 0, Math.min(C.MAP_RULES.height - 6, sim.house.z - 4));
    cam.update(0);

    const loop = shared.loop;
    this.hud = new Hud(document.body, sim, {
      buildTower: (type) => this.input.enterTowerBuild(type),
      select: (sel) => this.input.select(sel),
      order: (id) => sim.runner.orderRefill(id),
      cast: (n) => this.input.castSlot(n),
      aim: (id) => this.input.enterAim(id),
      toggleAutoCast: (id) => {
        const on = !sim.runner.isAutoCast(id);
        sim.runner.setAutoCast(id, on);
        shared.setSetting('autoCast', { ...shared.settings.autoCast, [id]: on });
        this.hud.toast(`${C.SPELLS[id].name}: auto-cast ${on ? 'on' : 'off'}`);
      },
      toggleAutoCastAll: () => {
        const on = !sim.runner.autoCastAll;
        sim.runner.setAutoCastAll(on);
        shared.setSetting('autoCast', {});
        shared.setSetting('autoCastAll', on);
        this.hud.toast(`Auto-cast ${on ? 'on' : 'off'} for every spell`);
      },
      // Starting or calling a wave also ends a pause (the player wants to play).
      startWave: () => { if (sim.waves.startNext()) shared.resume(); },
      togglePause: () => shared.togglePause(),
      /** Stops/starts game time without the pause menu (the perk picker uses it). */
      holdTime: (on) => shared.setHold(on),
      setSpeed: (s) => { loop.speed = s; },
      isPaused: () => loop.paused,
      getSpeed: () => loop.speed,
      toggleMute: () => shared.setSetting('muted', !shared.settings.muted),
      isMuted: () => shared.settings.muted,
    });
    this.input = new Interaction({
      canvas, cam, sim, towerView: this.towerView, runnerView: this.runnerView, overlay: this.overlay,
      hud: this.hud, cameraCfg: CAMERA, signal: this.abort.signal, settings: shared.settings,
    });
    addEventListener('keydown', (e) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); shared.togglePause(); }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') this.hud.actions.startWave();
    }, { signal: this.abort.signal });
    this.#wireFeedback();
    this.hud.toast(`${sim.runner.name} ${C.RUNNER.title} reporting for duty! Build towers beside the road.`, 'good');
    this.hud.showBanner(sim.map.name, sim.map.tip);
  }

  /** Visual and text feedback for simulation events. */
  #wireFeedback() {
    const { effects, floaters, fx } = this.shared;
    const ev = this.sim.events;
    ev.on('impactFx', ({ x, z, radius, fx: kind }) => {
      const color = FX_COLORS[kind.split('-')[0]] ?? FX_COLORS.hit;
      if (radius > 0) fx.ring(x, z, radius, color, kind.endsWith('small') ? 0.35 : 0.6);
      const big = !kind.endsWith('small') && radius > 1;
      effects.burst({ x, y: 0.4, z }, {
        count: big ? 24 : 6, color, size: big ? 0.1 : 0.06, speed: big ? 2.5 : 1.2, up: big ? 2.5 : 1.5,
        life: big ? 0.9 : 0.5, spread: Math.min(1, radius),
      });
    });
    ev.on('bossAbility', ({ zombie, kind, radius }) => {
      const color = kind === 'summon' ? 0x7cff5a : 0xd060ff;
      fx.ring(zombie.x, zombie.z, radius, color, 0.9);
      effects.burst({ x: zombie.x, y: 1.2, z: zombie.z }, { count: 20, color, size: 0.08, speed: 1.8, up: 2.2, life: 0.9, spread: 0.6 });
    });
    ev.on('bossSpawned', (z) => fx.ring(z.x, z.z, 2.5, 0xd0453a, 1.2));
    ev.on('zombieLanded', ({ zombie, height }) => {
      if (height < 0.6) return;
      effects.burst({ x: zombie.x, y: 0.1, z: zombie.z }, { count: 8, color: 0x6a6050, size: 0.07, speed: 1.2, up: 0.8, life: 0.5, spread: 0.3 });
    });
    ev.on('commanderAbility', ({ icon, name, x, z, extra }) => {
      floaters.spawn({ x, y: 2.2, z }, `${icon} ${name}${extra ? ` ${extra}` : ''}`, 'cmdab');
    });
    // No damage numbers over the dead (the damage meter on the left shows who does what).
    ev.on('zombieDamaged', ({ zombie, crit, dot }) => {
      if (dot) return;
      effects.burst({ x: zombie.x, y: 0.6, z: zombie.z }, { count: crit ? 6 : 3, color: 0x6a1a14, size: 0.06, speed: 1, up: 1.5, life: 0.5, spread: 0.2 });
    });
    // Hits that do nothing (Ghosts vs physical, Ironclads vs arrows): a short note now and then.
    const immuneShown = new Map();
    ev.on('zombieImmune', ({ zombie }) => {
      const now = this.sim.time;
      if ((immuneShown.get(zombie.id) ?? -9) > now - 2.5) return;
      immuneShown.set(zombie.id, now);
      floaters.spawn({ x: zombie.x, y: 1.3, z: zombie.z }, 'immune', 'wall');
    });
    // Tesla lightning: sparks along each jump.
    ev.on('teslaArc', ({ from, to }) => {
      let a = { x: from.x, z: from.z, y: 1.8 };
      for (const b of to) {
        for (let k = 1; k <= 3; k++) {
          const f = k / 4;
          effects.burst({ x: a.x + (b.x - a.x) * f, y: a.y + (0.8 - a.y) * f, z: a.z + (b.z - a.z) * f }, { count: 2, color: FX_COLORS.tesla, size: 0.05, speed: 0.4, up: 0.3, life: 0.25, spread: 0.05 });
        }
        fx.ring(b.x, b.z, 0.35, FX_COLORS.tesla, 0.25);
        a = { x: b.x, z: b.z, y: 0.8 };
      }
    });
    ev.on('zombieKilled', ({ zombie }) => {
      floaters.spawn({ x: zombie.x, y: 1.4, z: zombie.z }, `+${zombie.reward}`, 'gold');
    });
    ev.on('zombieLeaked', ({ zombie, damage }) => {
      const h = this.sim.house;
      floaters.spawn({ x: h.x, y: 3.2, z: h.z }, `-${Math.round(damage)}`, 'wall');
      effects.burst({ x: zombie.x, y: 0.8, z: zombie.z }, { count: 14, color: 0x6a1a14, size: 0.09, speed: 1.6, up: 1.8, life: 0.7, spread: 0.3 });
      this.houseShake = 0.25;
    });
    ev.on('houseDestroyed', () => {
      const h = this.sim.house;
      const at = { x: h.x, y: 1.2, z: h.z };
      effects.burst(at, { count: 60, color: 0x6a4a30, size: 0.18, speed: 3, up: 4, life: 1.8, spread: 1 });
      effects.burst(at, { count: 40, color: 0x8f8678, size: 0.24, speed: 1.8, up: 2.4, life: 2.2, spread: 1.1 });
      this.world.house.visible = false;
    });
    // Towers.
    ev.on('towerRefilled', ({ tower }) => {
      floaters.spawn({ x: tower.cx, y: 2.6, z: tower.cz }, 'Reloaded!', 'refill');
      fx.ring(tower.cx, tower.cz, 0.8, 0x5aa8ff, 0.5, 0.15);
    });
    ev.on('towerEmpty', (t) => floaters.spawn({ x: t.cx, y: 2.8, z: t.cz }, 'OUT OF AMMO', 'wall'));
    ev.on('towerSmashed', ({ tower }) => {
      floaters.spawn({ x: tower.cx, y: 2.4, z: tower.cz }, 'Smashed!', 'wall');
      effects.burst({ x: tower.cx, y: 1, z: tower.cz }, { count: 14, color: 0x9a8f80, size: 0.08, speed: 1.6, up: 2, life: 0.7, spread: 0.4 });
    });
    ev.on('towerJammed', ({ tower }) => floaters.spawn({ x: tower.cx, y: 2.6, z: tower.cz }, 'Jammed!', 'wall'));
    ev.on('towerUpgradeQueued', (t) => floaters.spawn({ x: t.cx, y: 2.6, z: t.cz }, 'Upgrade ordered', 'cast'));
    ev.on('towerInstantUpgrade', (t) => floaters.spawn({ x: t.cx, y: 2.8, z: t.cz }, 'Snap! Instant upgrade', 'level'));
    ev.on('towerUpgraded', (t) => {
      fx.ring(t.cx, t.cz, 1, FX_COLORS.level, 0.6, 0.15);
      effects.burst({ x: t.cx, y: 1.6, z: t.cz }, { count: 14, color: FX_COLORS.level, size: 0.05, speed: 0.8, up: 2, life: 0.7, spread: 0.4 });
    });
    // The runner.
    ev.on('runnerBonked', ({ runner }) => {
      floaters.spawn({ x: runner.x, y: 2, z: runner.z }, 'BONK!', 'bonk');
      effects.burst({ x: runner.x, y: 1.2, z: runner.z }, { count: 10, color: 0xffe060, size: 0.06, speed: 1.4, up: 1.6, life: 0.6, spread: 0.2 });
    });
    ev.on('runnerStomp', ({ zombie }) => floaters.spawn({ x: zombie.x, y: 1.4, z: zombie.z }, 'STOMP!', 'bonk'));
    ev.on('runnerLevelUp', ({ runner }) => {
      floaters.spawn({ x: runner.x, y: 2.2, z: runner.z }, `Level ${this.sim.runner.level}!`, 'level');
      fx.ring(runner.x, runner.z, 1.2, FX_COLORS.level, 0.8, 0.1);
    });
    ev.on('spellCast', ({ name, icon, x, z, radius, towers }) => {
      floaters.spawn({ x, y: 2.3, z }, `${icon} ${name}`, 'cast');
      fx.ring(x, z, radius, FX_COLORS.spell, 0.7);
      for (const t of towers) effects.burst({ x: t.cx, y: 1.8, z: t.cz }, { count: 8, color: FX_COLORS.spell, size: 0.05, speed: 0.6, up: 1.5, life: 0.6, spread: 0.3 });
    });
    ev.on('zombieSlipped', ({ zombie }) => floaters.spawn({ x: zombie.x, y: 1.2, z: zombie.z }, 'Whoops!', 'bonk'));
    ev.on('zombieFrozen', ({ zombie }) => effects.burst({ x: zombie.x, y: 0.6, z: zombie.z }, { count: 8, color: 0x8fd8ff, size: 0.06, speed: 0.8, up: 1, life: 0.6, spread: 0.2 }));
    ev.on('gameOver', (summary) => this.shared.onGameOver(summary));
    this.#wireSound();
  }

  /** Maps simulation events to sound effects. */
  #wireSound() {
    const sfx = this.shared.sfx;
    if (!sfx) return;
    const ev = this.sim.events;
    const IMPACT = { fire: 'fire', explosion: 'explosion', frost: 'frost', arcane: 'arcane', holy: 'holy', poison: 'poison', earth: 'bash', boulder: 'bash' };
    const TOWER_SOUND = { arrow: 'bow', fire: 'magic', frost: 'magic', boulder: 'crossbow', gale: 'bow', roller: 'crossbow' };
    ev.on('towerAttack', ({ tower }) => sfx.play(TOWER_SOUND[tower.type], 0.6));
    ev.on('towerBuilt', () => sfx.play('build', 1.2));
    ev.on('towerUpgraded', () => sfx.play('repair', 1.3));
    ev.on('towerRemoved', () => sfx.play('gold'));
    ev.on('impactFx', ({ fx }) => { const s = IMPACT[fx.split('-')[0]]; if (s) sfx.play(s, 0.7); });
    ev.on('zombieKilled', ({ zombie }) => { sfx.play('death', zombie.scale); sfx.play('gold'); });
    ev.on('zombieLeaked', () => { sfx.play('leak'); sfx.play('alarm'); });
    ev.on('houseRepaired', () => sfx.play('repair'));
    ev.on('towerRefilled', () => sfx.play('refill'));
    ev.on('runnerReloaded', () => sfx.play('refill', 0.6));
    ev.on('runnerBonked', () => sfx.play('bonk'));
    ev.on('runnerStomp', () => sfx.play('bash'));
    ev.on('spellCast', () => sfx.play('spell'));
    ev.on('zombieSlipped', () => sfx.play('slip'));
    ev.on('towerEmpty', () => sfx.play('empty'));
    ev.on('towerSmashed', () => sfx.play('wallHit', 1.3));
    ev.on('runnerLevelUp', () => sfx.play('levelUp'));
    ev.on('runnerPerkChosen', () => sfx.play('levelUp', 1.2));
    ev.on('waveStarted', ({ boss }) => sfx.play(boss ? 'boss' : 'waveStart'));
    ev.on('waveCleared', () => sfx.play('waveCleared'));
    ev.on('bossSpawned', () => sfx.play('boss'));
    ev.on('commanderAbility', ({ id }) => sfx.play({ meteor: 'explosion', frost: 'frost', judgement: 'holy', rot: 'poison', storm: 'arcane' }[id] ?? 'repair', 1.2));
    ev.on('bossAbility', () => sfx.play('boss', 0.6));
    ev.on('gameOver', () => sfx.play('gameOver'));
    ev.on('actionRejected', () => sfx.play('deny'));
  }

  /** Per-frame rendering sync (real time, independent of game speed). */
  frame(realDt) {
    const { zombieView, projectileView, effects, bars, floaters, cam, canvas, fx } = this.shared;
    const sim = this.sim;
    const gameDt = this.shared.loop.paused ? 0 : realDt * this.shared.loop.speed;
    zombieView.sync(sim.zombies.list, sim.zombies.time);
    fx.update(realDt, sim.towers.time, sim.zones.list, sim.towers.all());
    projectileView.sync(sim.projectiles.list);
    this.towerView.update(realDt);
    this.runnerView.update(gameDt);
    this.ambience.update(realDt);
    this.portalView.update(realDt);
    effects.update(realDt);
    floaters.update(realDt, cam.camera, canvas);
    const house = this.world.house;
    this.houseShake = Math.max(0, (this.houseShake ?? 0) - realDt);
    house.position.x = sim.house.x + (this.houseShake > 0 ? (Math.random() - 0.5) * 0.08 : 0);

    // Bars: damaged zombies; tower ammo (blue, red when low).
    bars.begin(cam.camera);
    for (const z of sim.zombies.list) {
      if (z.stealth && !sim.zombies.isVisible(z)) continue;
      if (z.alive && z.hp < z.maxHp) bars.add(z.x, 1.15 * z.scale + (z.air ?? 0), z.z, z.hp / z.maxHp, healthColor(z.hp / z.maxHp), z.boss ? 1.2 : 0.6);
    }
    const low = sim.config.TOWER_RULES.lowAmmo;
    for (const t of sim.towers.all()) {
      const r = t.ammo / t.stats.maxAmmo;
      bars.add(t.cx, this.towerView.topOf(t.id), t.cz, r, r < low ? 0xd0453a : 0x5aa8ff, 0.7);
    }
    bars.end();
    this.input.tick();
    this.hud.tick(realDt);
  }

  dispose() {
    this.abort.abort();
    this.sim.events.clear();
    this.towerView.dispose();
    this.runnerView.dispose();
    this.hud.dispose();
    this.overlay.dispose();
    this.ambience.dispose();
    this.portalView.dispose();
    this.world.dispose();
    const s = this.shared;
    s.loop.paused = false;
    s.zombieView.clear();
    s.projectileView.sync([]);
    s.effects.clear();
    s.fx.clear();
    s.floaters.clear();
    s.bars.begin(s.cam.camera);
    s.bars.end();
  }
}
