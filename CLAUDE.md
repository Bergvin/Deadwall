# DeadWall

Isometric dark-fantasy zombie fortress survival game that runs in the browser. The player builds walls, recruits heroes who stand on the walls, and survives endless zombie waves. If the fortress gate falls, the run is over.

- **Full game spec:** [docs/spec.md](docs/spec.md). It is long, so read only the section you need (sections are numbered 1–20).
- **Repo:** https://github.com/Bergvin/Deadwall (branch `main`)
- **User:** Bergvin. Talk to them in **Icelandic**. Code, comments, and commit messages are in **English**.

## Technical decisions (already made)

- **Three.js + Vite**, plain JavaScript (ES modules), no backend. Three.js comes from npm, not a CDN.
- **2D logic, 3D rendering:** All gameplay (grid, pathfinding, combat, waves, economy) is plain JS on a 2D grid and does not depend on Three.js. Rendering is a separate layer: an orthographic camera at an isometric angle draws the game state.
- **Models:** CC0 low-poly glTF/GLB models from Kenney and Quaternius (see the asset map below). No procedural Canvas drawing of characters.
- **Audio:** generated in code (WebAudio), or CC0 sounds.
- **Persistent data:** `localStorage`, always validated, and the game must start even if a save is corrupted.

## Design decisions (approved by the user)

These fill gaps the spec leaves open:

- **Heroes can fall:** at 0 HP a hero is "fallen" (not deleted). They can be revived for gold during the next prep phase. Warn when a hero's HP is low.
- **Building during waves is allowed:** construction and repair cost **+25%** while a wave is active.
- **Starting layout:** only the castle and the gate. The player builds every defensive line.
- **Map:** fixed, about **30×24** cells, fits on screen with light zoom.
- **No victory condition:** endless waves, the goal is a personal best. Milestone markers at waves 10, 20, 30, …
- **Repositioning takes time:** the hero walks to the new spot for a few seconds and does not attack meanwhile.
- **Hero names:** random medieval names, e.g. "Aldric the Archer".

## Architecture rules

- All gameplay numbers (hero, wall, and zombie stats, costs, wave formulas) live in **`src/config/`**. No magic numbers in the systems.
- One system per file, kept small: e.g. `grid.js`, `pathfinding.js`, `waves.js`, `economy.js`, `combat.js`, `render/…`, `ui/…`.
- Simulation uses a fixed timestep driven by elapsed time. Pause and game speed only affect the simulation clock.
- Each entity has a unique `id`. Death and reward are triggered **once** (an `alive` flag is checked before everything).
- Every purchase goes through one function in `economy.js` that validates the balance.

## Saving tokens (important)

- **Never read binary files** (`.glb`, `.gltf`, `.png`, `.zip`). List file names with `ls` if needed.
- Read only the file or section that matters. Do not read all of `docs/spec.md` at once.
- **Test with code, not screenshots:** `window.debug` functions (spawn enemies, break a wall, add gold, jump to wave N) and Node tests for logic (`npm test`). Use screenshots only to check appearance.
- Keep a balance simulation in Node (run N waves without graphics) instead of playing manually.

## Assets

- **`assets/`** holds the raw packs (about 166 MB). It is **not committed** (see `.gitignore`).
- **`public/models/`** holds only the models the game uses. Copy them there from `assets/` and commit them.
- `src/config/assets.js` maps game names to model files plus scale, rotation, and tint. To swap a model, edit only that file.

| Role | Source in `assets/` |
|---|---|
| Walls, towers, gate, banners | `kenney-castle/Models/GLB format/` (`wall`, `wall-corner`, `gate`, `metal-gate`, `tower-*`, `flag-*`) and `quaternius-fantasy-rts/glTF/` (`Wall_*`, `WallTowers_*`, `WatchTower_*`) |
| Environment | `kenney-graveyard/Models/GLB format/` (`fire-basket`, `fence-*`, `grave*`, `debris*`, `pine-crooked`, `trunk`, `rocks*`, `lantern-*`, `stone-wall-damaged` for damaged walls), `quaternius-fantasy-rts/glTF/` (`Resource_Tree*`, `Rock*`) |
| Heroes | `quaternius-rpg-characters/glTF/`: Ranger→Archer, Wizard→Mage, Warrior→Warrior, Cleric→Paladin, Rogue→Crossbowman, Monk→Alchemist (with tint/props) |
| Zombies | `quaternius-zombie-kit/Characters/glTF/`: Zombie_Basic→Walker, Zombie_Arm→Runner, Zombie_Chubby→Brute, Zombie_Ribcage→Plague Carrier, Zombie_Chubby (larger, different tint)→Siege Zombie |
| Bosses | `quaternius-monsters/Big/glTF/` (e.g. Demon, Yeti, Orc, MushroomKing) |

Kenney GLB files may reference `Textures/` next to them, so copy that folder along when needed.

## Phases

| # | Phase | Status |
|---|---|---|
| 0 | Spike: Vite + Three.js, load models, fps test with 200 animated zombies | done |
| 1 | Grid, isometric camera (pan/zoom), mouse picking, stone wall construction, A* | done |
| 2 | Full game loop: Walker, Archer, gold, waves, breaches, gate, game over, pause/speed, restart | done |
| 3 | All 6 heroes, abilities, XP, and upgrades | done |
| 4 | All 5 wall types, all zombie types, and bosses | done |
| 5 | Effects, audio, UI polish, localStorage, atmosphere (fog, light) | |
| 6 | Balance via simulation; test everything in section 19 of the spec | |

Each phase ends with: the user plays and gives feedback, then commit and push to `main`. Update the status column here as phases finish.

## Code layout

- `src/config/`: `game.js` (MAP, ECONOMY, FORTRESS incl. gate reinforce/repair, WAVES timing, SCORE, WALLS (stone/reinforced/spiked/arcane), WALL_UPGRADES, PATHING, CAMERA; re-exports hero and enemy config), `enemies.js` (ZOMBIES: walker, runner, brute, plague, siege + bosses behemoth/gravelord with behaviour blocks; ELITE; WAVE_TABLE composition, boss every 5 waves alternating), `heroes.js` (6 classes: base stats, per-level growth, abilities, 3 talent tiers at levels 3/5/7 with two exclusive options each; HERO_RULES incl. xpToNext and maxLevel 10; TARGETING modes) and `assets.js` (model registry; hero entries carry `anims` role→clip maps).
- `src/core/simulation.js`: **one run of the whole game logic** (no rendering). Owns grid, economy, walls, fortress, zombies, heroes, projectiles, waves, seeded rng, stats; `step(dt)`, `run(seconds)`, `summary()`. Same seed + same actions = same outcome.
- `src/core/`: pure logic with no Three.js, tested in Node. `zombies.js` (flow fields per routing profile: default / siege (cheap walls → bulldozes) / charge (cost by wall HP → weakest wall); MOVE / ATTACK_WALL / ATTACK_GATE / DEAD; `damage()` kills exactly once; elites; boss summon/empower/smash-splash; zombies that end up in rocks/walls escape to the best neighbour; summons spawn on open cells), `heroes.js` (roster: recruit, deploy with capacity, reposition delay, dismiss refund, XP/levels, talents, targeting preference), `heroStats.js` (pure: stats from class + level + talents; used for live stats and "next level" previews), `combat.js` (basic attacks per class, all abilities via `use(heroId, id, target)`/`canUse`, `applyPayload` = the one place impacts become damage/DoT/slow/stun/zones, wall damage multiplier from warrior guard, paladin aura and Rally/Holy Shield buffs, paladin wall mending), `zones.js` (ground DoT areas), `wallEffects.js` (spiked thorns, arcane slow aura + pulse), `hazards.js` (plague aura + toxic puddles that damage heroes), heroes can fall at 0 HP (unseated, revive for gold only during PREP; all heroes heal on wave clear; paladin aura heals heroes), damage types physical/magic/holy/poison/fire with zombie armor/resist, `projectiles.js` (homing / point / line flight; reports impacts to combat), `waves.js` (PREP countdown / ACTIVE spawning, `startNext()` only in PREP), `fortress.js` (gate HP, `gateDestroyed`), `save.js` (validated localStorage records), `rng.js`. `grid.js` (terrain, cell→wall id), `walls.js` (WallSystem: build/sell/destroy/upgrade/repair, armor, `wallStats()`, connection masks, `zombieCostFn`), `economy.js`, `pathfinding.js` (A* `findPath` + Dijkstra `computeFlowField`, 8-dir, no corner cutting), `loop.js` (fixed-timestep loop, speed/pause), `events.js`.
- `src/render/`: `setup.js` (renderer/lights/ground), `cameraController.js`, `assets.js` (AssetLibrary), `wallView.js` (`pieceFor(mask)` picks the piece and rotation), `worldView.js` (castle + scenery), `overlay.js` (grid, hover, ghost, path line), `bakedHorde.js`.
- `src/input/interaction.js`: modes (select/build), picking, wall placement (press = start, drag = axis-locked line preview with cumulative gold check, release = build; `axisLock` + 4-connected `lineCells`), right-drag pan, keys.
- `src/ui/hud.js` + `hud.css`: HTML HUD. Canvas-only pointerdown listeners keep UI clicks off the battlefield.
- `src/game/game.js`: state machine (menu → playing → over) and everything that persists between runs (renderer, camera, assets, scenery, overlay, ZombieView, ProjectileView, Effects, HealthBars, FloatingText). `src/game/session.js`: one run = Simulation + WallView + HeroView + Interaction + Hud + event→feedback wiring; `dispose()` removes every trace (restart is a new Session).
- Render: `zombieView.js` (baked horde per model; clips Walk/Punch/Death), `heroView.js` (skinned heroes on walkway y 1.18, attack/cast one-shots, invisible pick hit boxes), `fx.js` (expanding rings, zone discs, buffed-wall glow), zombie status tints via per-instance colour in the baked horde, `projectileView.js`, `effects.js` (particle bursts), `healthBars.js` (instanced camera-facing bars). `ui/screens.js` (menu, game over, pause badge), `ui/floatingText.js` (pooled DOM damage numbers).
- `src/main.js`: bootstrap + `window.debug`.
- Grid coords: cell (x, y), y grows south, north = y 0. Cell center in world = (x + 0.5, 0, y + 0.5). Castle wall row 21, gate (15, 21), spawn rows 0–2.
- Zombie routing: walls are passable at a cost (`PATHING`), so zombies go around short walls but break through a closed line at its cheapest point.

## Phase 0 findings (spike, removed after phase 1 — see git history `a5e535a`/`2d9fd44`)

- Measured on the user's PC (RTX 3080) with `debug.bench()` (synchronous frames + GPU sync, valid when the tab is hidden):
  0 zombies 1.3 ms/frame · 50 → 5.6 ms · 200 → 16.4 ms (~60 fps) · 400 → 32 ms (~30 fps).
- Cost is ~0.075 ms per skinned zombie and is **per-object CPU/driver overhead**, not triangles or shadows (shadows on/off made no difference). Each `Zombie_Basic` clone has 2 skinned meshes (body 7.6k tris + eyelid) and 50 bones.
- Updating mixers every other frame (`?anim=2`) halves the update cost (3.2 → 1.9 ms at 200) but barely changes the total frame time.
- **Solved with a baked instanced horde** (`src/render/bakedHorde.js`). At load, each clip is sampled at 30 fps, and skinned positions and normals go into float textures (~90 ms for 4 clips). One `InstancedMesh` per zombie type then reads the frame per instance in the vertex shader (`aFrame` attribute + `gl_VertexID`). Result: 200 zombies **2.0 ms** (was 16.4), 1000 → 3.1 ms, 2000 → 5.2 ms. **Use this for all zombie types.** Heroes stay normal skinned meshes (few of them, and they need blended animations).
- Baked limits: no blending between clips (instant switch), one frame per instance (no interpolation; fine at 30 fps), the eyelid mesh is dropped. Shadows work via a patched `customDepthMaterial`.
- **Model units:** Kenney castle pieces are about 1 unit per cell, so scale the whole kit by one factor taken from `wall.glb`. Quaternius RPG heroes are ~3 units tall and zombies ~1.2, so normalize each by height. Models face +z, so rotate π to face north (−z). Kenney `gate.glb` is only the door leaf, so use `wall-doorway.glb` for the gate opening.
- **Camera:** yaw 0° (walls horizontal, enemies from the top of the screen), **pitch 55°** by default. Camera angle has no measurable effect on performance. Top-down (90°) works, but characters turn into blobs. Fog must start past the map center (camera distance + 4), otherwise the whole scene goes dark.

## Commands

- `npm run dev` starts the Vite dev server on http://localhost:5173 (the in-app browser preview config is in `.claude/launch.json`, name `deadwall`).
- `npm run build` writes the production build to `dist/`.
- `npm test` runs the Node tests in `tests/*.test.js` (logic only, no browser).
- `node tools/inspect-model.cjs <file.gltf|glb>…` prints meshes, skins, textures and animation names without dumping binary data.
- `tools/patch.cjs <file>` reads `[[old, new], ...]` JSON on stdin and replaces each exactly once (fails loudly if missing). Use it via Python (`subprocess` + `json.dumps`) for multi-line edits; avoid `node -e` with template literals in Bash (backticks get eaten).
- `node tools/simulate.js [runs] [line|none]` plays headless runs with a scripted strategy and prints the wave reached (balance check; archers-only line strategy: phase 2 ≈ wave 20, phase 3 ≈ wave 33 because heroes now level up; phase 4 ≈ wave 17 with mixed enemies and bosses; no defence = wave 1).
- In the browser console: `debug.state()`, `debug.newGame(seed)`, `debug.sim()`, `debug.build(x, y)`, `debug.buildLine(x0, y0, x1, y1)`, `debug.sellAt(x, y)`, `debug.addGold(n)`, `debug.spawn(type, x, y, n)`, `debug.hero(type, x, y)` (recruit + deploy), `debug.damageWall(x, y, n)`, `debug.damageGate(n)`, `debug.fastForward(seconds)`, `debug.screenOf(x, y, h)` (cell → client pixel, for simulated clicks), `debug.cellAt(cx, cy)`. Note: the menu is shown first; start a run before using run commands.
- `/tools/viewer/pieces.html?m=wall,wall-corner` shows Kenney pieces top-down at 0/90/180/270° (north up) to check orientation.
- Controls: `B`/`1`–`4` build stone/reinforced/spiked/arcane wall, `U` upgrade selected wall, click the gate to repair/reinforce it, LMB place/select (drag previews a straight line, release builds it), RMB cancel, RMB-drag or WASD pan, wheel zoom (anchored at the cursor), `R` repair / Del sell selected wall, `M` move selected hero, Space pause, Enter start next wave, Esc cancel, `P` toggle the zombie path preview. Heroes tab → recruit → click a wall (green ring = free slot). Selected hero: `Q`/`E`/`F` abilities (targeted ones show a reach ring + area preview, click to cast).
