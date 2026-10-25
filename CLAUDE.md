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
| 1 | Grid, isometric camera (pan/zoom), mouse picking, stone wall construction, A* | |
| 2 | Full game loop: Walker, Archer, gold, waves, breaches, gate, game over, pause/speed, restart | |
| 3 | All 6 heroes, abilities, XP, and upgrades | |
| 4 | All 5 wall types, all zombie types, and bosses | |
| 5 | Effects, audio, UI polish, localStorage, atmosphere (fog, light) | |
| 6 | Balance via simulation; test everything in section 19 of the spec | |

Each phase ends with: the user plays and gives feedback, then commit and push to `main`. Update the status column here as phases finish.

## Phase 0 findings (spike in `src/spike/main.js`)

- Measured on the user's PC (RTX 3080) with `debug.bench()` (synchronous frames + GPU sync, valid when the tab is hidden):
  0 zombies 1.3 ms/frame · 50 → 5.6 ms · 200 → 16.4 ms (~60 fps) · 400 → 32 ms (~30 fps).
- Cost is ~0.075 ms per skinned zombie and is **per-object CPU/driver overhead**, not triangles or shadows (shadows on/off made no difference). Each `Zombie_Basic` clone has 2 skinned meshes (body 7.6k tris + eyelid) and 50 bones.
- Updating mixers every other frame (`?anim=2`) halves the update cost (3.2 → 1.9 ms at 200) but barely changes the total frame time.
- **Solved with a baked instanced horde** (`src/spike/bakedHorde.js`). At load, each clip is sampled at 30 fps, and skinned positions and normals go into float textures (~90 ms for 4 clips). One `InstancedMesh` per zombie type then reads the frame per instance in the vertex shader (`aFrame` attribute + `gl_VertexID`). Result: 200 zombies **2.0 ms** (was 16.4), 1000 → 3.1 ms, 2000 → 5.2 ms. **Use this for all zombie types.** Heroes stay normal skinned meshes (few of them, and they need blended animations).
- Baked limits: no blending between clips (instant switch), one frame per instance (no interpolation; fine at 30 fps), the eyelid mesh is dropped. Shadows work via a patched `customDepthMaterial`.
- **Model units:** Kenney castle pieces are about 1 unit per cell, so scale the whole kit by one factor taken from `wall.glb`. Quaternius RPG heroes are ~3 units tall and zombies ~1.2, so normalize each by height. Models face +z, so rotate π to face north (−z). Kenney `gate.glb` is only the door leaf, so use `wall-doorway.glb` for the gate opening.
- **Camera:** yaw 0° (walls horizontal, enemies from the top of the screen), **pitch 55°** by default. Camera angle has no measurable effect on performance. Top-down (90°) works, but characters turn into blobs. Fog must start past the map center (camera distance + 4), otherwise the whole scene goes dark.
- Spike URL params: `?n=200`, `?shadows=0`, `?horde=skinned`, `?yaw=0`, `?pitch=55`. Keys: `[` `]` pitch, `T` top-down, `V` yaw 45/0.

## Commands

- `npm run dev` starts the Vite dev server on http://localhost:5173 (the in-app browser preview config is in `.claude/launch.json`, name `deadwall`).
- `npm run build` writes the production build to `dist/`.
- `npm test` runs Node tests in `tests/` (from phase 1).
- `node tools/inspect-model.cjs <file.gltf|glb>…` prints meshes, skins, textures and animation names without dumping binary data.
- In the browser console: `debug.bench(120)`, `debug.setZombieCount(n)`, `debug.stats()`.
