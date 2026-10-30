# DeadWall

Isometric dark-fantasy zombie **tower defense** that runs in the browser. The player protects a **house** on hand-made maps: zombies walk the roads, the player places a **few** towers beside them (and upgrades them a lot), and a silly little **runner** carries ammo crates from the house to the towers and casts spells that boost the towers around him. If the house falls, the run is over.

There are two games in this repo:
- **DeadWall** (the current game): `index.html` → `src/`, tests in `tests/*.test.js`, `tools/simulate.js`. This file describes it.
- **DW Classic** (the original wall-building mode with a champion hero, **frozen**): `classic.html` → `src-classic/`, tests in `tests/classic/`, `tools/simulate-classic.js`. Its guide is [docs/classic.md](docs/classic.md). The main menu has a **DW Classic** button. Do not change Classic unless the user asks for a Classic fix; new gameplay work goes into `src/`.

- **Full original spec:** [docs/spec.md](docs/spec.md) (written for Classic; sections 1–20). Read only the section you need.
- **Repo:** https://github.com/Bergvin/Deadwall (branch `main`)
- **User:** Bergvin. Talk to them in **Icelandic**. Code, comments, and commit messages are in **English**.

## Technical decisions (already made)

- **Three.js + Vite**, plain JavaScript (ES modules), no backend. Three.js comes from npm, not a CDN.
- **2D logic, 3D rendering:** All gameplay (grid, pathfinding, combat, waves, economy) is plain JS on a 2D grid and does not depend on Three.js. Rendering is a separate layer: an orthographic camera at an isometric angle draws the game state.
- **Models:** CC0 low-poly glTF/GLB models from Kenney and Quaternius (see the asset map below). No procedural Canvas drawing of characters.
- **Audio:** generated in code (WebAudio), or CC0 sounds.
- **Persistent data:** `localStorage`, always validated, and the game must start even if a save is corrupted.

## Design decisions (approved by the user)

- **Oct 2026 redesign (approved): tower defense.** No walls. The player defends a **house** (2×2 cells). Zombies follow fixed **roads** (polylines) to it; one that reaches the house breaks in, takes its `damage` off the house (100 HP, so it works like lives) and is gone without a bounty. The house can be repaired between waves.
- **Few towers, each one matters:** towers stand on free ground beside the roads (one per cell, not on the road, with **one free cell between towers** (`TOWER_RULES.spacing`) so each is easy to click). **5 slots** at the start, +1 at waves 8, 16, 26, 38, 50 (max 10), plus commander bonuses. Each tower has **10 levels** with steep prices (`upgradeGrowth` 1.42 per level); an upgrade is paid at once but **built by the runner**: he walks to the tower and works `TOWER_RULES.buildTime(level)` seconds, and the tower cannot fire while he works (one pending upgrade per tower) and a choice of **two specialisations at level 5** (e.g. Arrow: Volley or Sniper). Selling refunds 60%.
- **Tower types:** Arrow (fast, long range; weak vs armor), Fire (area + burn; plague resists), Frost (slow), Boulder (armor pierce, stun on the direct target), Gale (pushes zombies **back down the road**), Rolling Stone (a ball that rolls through a line). Strategy = placement (corners cover the road twice), the mix (brutes are armored, runners fast, plague resists magic/fire, smashers attack towers near the road) and keeping the ammo flowing.
- **Ammo:** every tower has a magazine (shots); an empty tower stops. The **runner** brings crates from the house: one crate fills one tower; he carries 2 (perks add more) and runs home to reload. He supplies automatically (lowest ammo first, nearer is better); the player can order him to a tower (R, double-click, the low-ammo chips). Zombies on the road **knock him over** (stunned, may lose a crate). Plague clouds slow him and gum up towers.
- **The runner replaces the hero.** He is deliberately **silly**: the Monk model with a huge wobbling head, a tower of crates balanced on it and a floppy red hat; random names like "Barnaby Bumblecrate". He casts **spells** where he stands that boost towers within his reach (Pep Talk at start; Lucky Socks, Banana Peel, Stilts, Bottomless Pockets, Duct-Tape Overclock, Tea Break from perks). Right-click a spell for auto-cast; the **AUTO** button in the runner bar auto-casts every spell incl. ones learned later (both remembered between runs). Every level gives a pick of **3 perks** (rarities, chosen between waves): speed, crates, spell cooldown/reach, towers near him deal more damage, Twin Brother (a second runner), Perpetual Motion (towers near him need no ammo), build perks (Handyman faster building, Full Service refills on completion, Prefab Parts chance of an instant upgrade, Master Builder) etc.
- **Maps:** five hand-made 30×24 maps, each its own puzzle: The Old Road (one winding road), Crossroads (two roads merge), River Bend (river, bridges, little ground; a second road from wave 4), The Hollow (house in the middle, roads from three sides opening at waves 1/3/6), The Long March (very long road, fast and tough dead). **Reaching wave 10 on a map unlocks the next.** Records are per map.
- **Waves:** endless, boss every 5 waves (Behemoth summons, Gravelord empowers), Swarm/Chubby variants, elites, call the next wave early (Bergvin's rule, kept), stragglers enrage after 45 s. Enemy HP grows exponentially late (`WAVE_TABLE.hpGrowthExp`).
- **Difficulty (simulated with the Smart bot, `tools/simulate.js`, seeds SEED0=5000, see reports/sim-report.md):** fresh commander: The Old Road ≈ 11, Crossroads ≈ 8, River Bend ≈ 8, The Hollow ≈ 5, The Long March ≈ 5 (its first boss is a wall); the old Basic bot gets ≈ 6 on The Old Road. Mid commander ≈ 13-31; strong ≈ 35-43 (most strong runs hit the 60-minute cap). Map 2+ are meant to need some commander progress.
- **Commander and artifacts (meta progression) are kept** with the same rules as before (3 choices per commander level, run-end choice of 3 artifacts, merging, auto-salvage, six rarities); their bonuses now target towers (damage, speed, range, crit, cost, upgrade cost, ammo, **extra tower slot** at legendary+), the runner (speed, crates, spell cooldown, XP) and the house. Commander abilities: Meteor, Storm Call, Winter's Breath, Judgement, Rot Cloud, Stillness, **Supply Drop** (ammo for every tower), **Bulwark** (heals the house), War Tithe.
- **Saves:** this game uses its own key `deadwall.towers.save` (version 3, validated, per-map records); DW Classic keeps `deadwall.save`.
- Still true from earlier phases: building during waves costs +10%, endless waves with a personal best per map, no magic numbers outside `src/config/`, simulation is deterministic per seed.

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
| Towers, house, banners (walls/gate: Classic) | `kenney-castle/Models/GLB format/` (`wall`, `wall-corner`, `gate`, `metal-gate`, `tower-*`, `flag-*`) and `quaternius-fantasy-rts/glTF/` (`Wall_*`, `WallTowers_*`, `WatchTower_*`) |
| Environment | `kenney-graveyard/Models/GLB format/` (`fire-basket`, `fence-*`, `grave*`, `debris*`, `pine-crooked`, `trunk`, `rocks*`, `lantern-*`, `stone-wall-damaged` for damaged walls), `quaternius-fantasy-rts/glTF/` (`Resource_Tree*`, `Rock*`) |
| Runner (and Classic heroes) | `quaternius-rpg-characters/glTF/`: Monk→the runner (big head, crates on his head, hat; see render/runnerView.js). Classic: Ranger→Archer, Wizard→Mage, Warrior→Warrior, Cleric→Paladin, Rogue→Crossbowman, Monk→Alchemist |
| Zombies | `quaternius-zombie-kit/Characters/glTF/`: Zombie_Basic→Walker, Zombie_Arm→Runner, Zombie_Chubby→Brute, Zombie_Ribcage→Plague Carrier, Zombie_Chubby (larger, different tint)→Siege Zombie |
| Bosses | `quaternius-monsters/Big/glTF/` (e.g. Demon, Yeti, Orc, MushroomKing) |

Kenney GLB files may reference `Textures/` next to them, so copy that folder along when needed.


## Phases

| # | Phase | Status |
|---|---|---|
| 0–6 | Classic: spike, grid, game loop, heroes, walls, zombies, polish, balance | done (now DW Classic) |
| 7 | Tower defense redesign: maps and roads, ground towers with ammo and specialisations, the runner with spells and perks, DW Classic kept separately | done (Oct 2026) |

Each phase ends with: the user plays and gives feedback, then commit and push to `main`.

## Code layout (current game, `src/`)

- `src/config/`: `game.js` (ECONOMY, HOUSE, BONUS, WAVES, SCORE, PHYSICS, GAME_SPEEDS, CAMERA; re-exports the rest), `maps.js` (MAPS: house, roads `{points, from, weight}`, blocked cells, water rects, mods, unlock rule; MAP_RULES: size, road half width, lane width; `mapById`), `enemies.js` (ZOMBIES: walker, runner, brute (armor), plague (cloud on death), siege = Tower Smasher (`smasher`), bosses; `damage` = what one zombie takes off the house; ELITE; WAVE_TABLE; WAVE_VARIANTS), `towers.js` (TOWERS with ammo, projectile and `specs.a/b` mods; TOWER_RULES: levels, spec level, upgrade price curve, per-level growth, slots, sell refund, lowAmmo; TARGETING), `runner.js` (RUNNER: speed, crates, refill/reload times, bonk, spell radius, model scale/head size, XP curve, offer weights; SPELLS; SPELL_RANK; RUNNER_PERKS with `mods(rank)` or `spell`), `commander.js` (meta progression), `rarities.js`, `assets.js` (models; `quartermaster` = the runner's model, `runner` = the zombie runner).
- `src/core/` (pure logic, Node-tested): `simulation.js` (one run on one map; owns everything; `step`, `run`, `summary()` incl. map, runner level, refills, bonks), `grid.js` (`buildMap(map, rules)` → grid with OPEN/BLOCKED/ROAD/HOUSE/WATER, paths, house cells; `grid.towerAt`, `isBuildable`, `isWalkable`), `paths.js` (polyline paths: `buildPath`, `pointAt(path, s)`, `distanceToPath`, `coverage`), `zombies.js` (road walkers: `s` along a path + lane offset; `spawn(type, pathId, hp, {elite, rewardMult, s, lane})`; `damage()` once; leak at the door = house damage, no bounty (`zombieLeaked`); slow/stun/shred/dots; `push(z, force, lift)` shoves back along the road with air time and fall damage; Tower Smasher stops and `towers.smash()`; plague cloud event; boss summon/empower), `house.js`, `combat.js` (`applyPayload` = the one place impacts become damage and effects; stun hits the direct target unless `stunAll`; napalm zones), `towers.js` (`towerStats(type, level, spec, rules)` pure; TowerSystem: canBuild/build on cells, slots, upgrade(id, spec) (pays and sets `t.pending {level, spec, work, done}`), `workOn`/`finishUpgrade`/`isBuilding`/`buildProgress`, needsSpec, sell, refill, addBuff, smash, `modsOf` (buffs + `extra` hook), targeting, firing, ammo, `towerEmpty`/`towerLowAmmo`), `runner.js` (RunnerSystem: units (Twin Brother adds one), supply AI + `orderRefill` (job order: player orders, then upgrade builds via `callBuilder`, then auto refills; state `build`), A* routes over walkable ground, bonks/stomp, crates, spells (`spellInfo`, `cast`, `wantsCast`, auto-cast), XP/levels, `rollOffer`/`currentOffer`/`choose` (between waves only)/`grant`, `towerExtra` (aura, perpetual)), `zones.js` (napalm damage, banana-peel stun once per zombie, plague clouds), `waves.js` (as before plus roads: `activeRoads(n)`, preview `.roads`), `projectiles.js`, `commander.js` (`applyBonuses` → towers/runner/house), `commanderAbilities.js` (targets incl. `towers` ammo and `house` heal), `save.js` (`isMapUnlocked`, per-map `recordRun` with `unlocked`), `economy.js`, `pathfinding.js`, `rng.js`, `loop.js`, `events.js`.
- `src/render/`: `setup.js` (renderer, lights, the ground plane), `worldView.js` (per map: ground texture with roads/water, water sheen, the house keep with flag and torches, gravestones and red lights at road entrances, rocks, trees; `dispose`), `ambience.js` (`makeGroundTexture(size, paths, water, margin)`, per-run Ambience with spawn glows; `dispose`), `portalView.js` (a portal at every road start: two Kenney pillars and a swirling gate facing down the road; dormant until its road's `from` wave, stirs the wave before, flares on `zombieSpawned`; zombies spawn at `MAP_RULES.portalS`), `towerView.js` (Kenney hexagon towers that grow with level, spec band, element orb, level rings, ammo warning marker, jam blink), `runnerView.js` (the silly runner), `zombieView.js`/`bakedHorde.js` (baked instanced horde), `projectileView.js`, `fx.js` (rings, zones, buff rings under towers), `effects.js`, `healthBars.js` (zombie health, tower ammo), `overlay.js` (per run: build grid of placeable cells only (redrawn on towerBuilt/towerRemoved), hover, ghost, named range rings `setRing`), `cameraController.js`, `assets.js`.
- `src/input/interaction.js`: select/tower modes, ghost + range preview, picking towers and the runner, double-click a tower = send the runner, hotkeys (`TOWER_KEYS`, `SPELL_KEYS`), `tick()` keeps the range and spell rings up to date.
- `src/ui/`: `hud.js` (top bar with map, wave, gold, house, tower slots; tower cards; runner bar with crates, XP, spells (right-click = auto-cast) and the perk button; side panels for tower (ammo, stats, boosts, send runner, targeting, upgrade or the two spec buttons, two-click sell), runner and house; `PerkPicker` (holds game time); low-ammo chips; toasts/banners/boss bar/wave preview incl. new roads), `screens.js` (menu with **DW Classic** button, map select with thumbnails and locks, game over with per-map records and unlocks, pause), `commanderScreen.js`, `floatingText.js`, `hud.css`.
- `src/game/game.js` (menu → map select → playing → over; shared renderers), `src/game/session.js` (one run: world, ambience, overlay, views, input, HUD, event → effects and sounds), `src/audio/sfx.js` (procedural sounds incl. bonk, refill, spell, slip, leak), `src/main.js` (bootstrap + `window.debug`).
- Grid coords: cell (x, y), y grows south. Cell centre in world = (x + 0.5, 0, y + 0.5). Road points and the house centre are in world units.

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

- `npm run dev` starts the Vite dev server on http://localhost:5173 (`/classic.html` for DW Classic; the in-app browser preview config is in `.claude/launch.json`, name `deadwall`).
- `npm run build` writes the production build (both pages) to `dist/`.
- `npm test` runs every Node test (`tests/**/*.test.js`, Classic included).
- `node tools/inspect-model.cjs <file.gltf|glb>…` prints meshes, skins, textures and animation names without dumping binary data.
- `tools/patch.cjs <file>` reads `[[old, new], ...]` JSON on stdin and replaces each exactly once (fails loudly if missing). Use it via Python (`subprocess` + `json.dumps`) for multi-line edits; avoid `node -e` with template literals in Bash (backticks get eaten). `sed -i` replaces files in a way Vite's watcher on Windows can miss; if the dev server serves stale code, restart it.
- CSS class names for floaters must not collide with UI classes (e.g. `.ability` styles the ability and spell buttons).
- `node tools/simulate.js [runs] [bot,bot|all] [maxMinutes] [map,map|all]` plays headless runs in parallel (worker threads). Bots are profiles in `tools/bot.js` (like Astromage's AI profiles): `basic` (the old scripted player), `lazy`, one tower type (`arrow`, `fire`, ...), **`smart`** (rates every tower type and cell, every upgrade (minus build downtime) and every perk by effective damage per gold against the next 3 waves' armor/resist/bosses, values support as a share of the defence, spreads towers over roads, orders the runner to towers running dry, repairs below 70%), `wide`, `tall`, `smart-noorders`, `smart-nospells`. **Use `smart` for balance work.** Env: `COMMANDER=fresh|mid|strong`, `STATS=1` (damage per tower/spec, leaks per enemy, perks in the better half), `RUNNER=1`, `PICKS=1`, `OUT=file.json`, `JOBS=n`, `PARAMS='{...}'` (profile overrides), `SWEEP='{"key":[a,b]}'` (tune: every combination, best first), `SEED0` (other seeds; tune on the default, confirm on e.g. 5000). The simulation is noisy: compare with 20 runs per map. `node tools/trace.js [map] [bot] [seed]` follows one run wave by wave. Write-ups go to `reports/*.md` (Icelandic); re-run after balance changes and update the numbers here.
- In the browser console: `debug.state()`, `debug.newGame(seed, mapId)`, `debug.sim()`, `debug.tower(type, x, y)`, `debug.upgrade(id, spec)`, `debug.addGold(n)`, `debug.spawn(type, road, n)`, `debug.damageHouse(n)`, `debug.fastForward(s)`, `debug.runnerXp(n)`, `debug.grant(perkId)`, `debug.cast(spellId)`, `debug.order(towerId)`, `debug.screenOf(x, y, h)`, `debug.cellAt(cx, cy)`, `debug.commander()`, `debug.commanderXp(n)`, `debug.giveArtifact(id, rarity)`, `debug.artifactOffer(wave)`, `debug.setBest(mapId, wave)` (unlock maps). The menu is shown first; start a run before using run commands.
- Controls: `1`–`6` (or the cards) build a tower, LMB place/select, RMB cancel, RMB-drag or WASD pan, wheel zoom, `U` upgrade (the panel asks for a specialisation at level 5), `R` send the runner to the selected tower (or double-click the tower, or click a low-ammo chip), `Del` sell (two presses), `Q`/`E`/`F`/`G`/`T`/`Y`/`H` cast the runner's spells (right-click a spell button: auto-cast), Space pause (centred panel; time held by the perk picker is a separate flag, starting/calling a wave ends a pause), Enter start/call the next wave, speeds 1×/3×/5×, Esc cancel. Click the house to repair it between waves.
- `.github/workflows/deploy.yml`: on every push to `main` runs `npm ci`, `npm test`, `npm run build` and publishes `dist/` to GitHub Pages. Vite `base: './'`, two inputs (`index.html`, `classic.html`) and relative model URLs (`models/...` in config/assets.js) keep the build working under the /Deadwall/ sub-path. Never use absolute `/models/` URLs.
