> These acceptance results are for **DW Classic** (now in `src-classic/`). The current game is balanced with `tools/simulate.js` (numbers in CLAUDE.md).

# DEADWALL — Acceptance report (spec section 19)

How each acceptance item was verified. **Node** = automated test in `tests/` (run with `npm test`; 83 tests, all passing at the end of phase 6). **Browser** = checked in the running game in the in-app browser with simulated input and `window.debug` (phases 1–6). Nothing below is marked as verified unless it was actually run.

## Construction

| Item | How verified |
|---|---|
| Build every wall type | Node: `every wall type builds with its own stats` · Browser: all four types built and rendered (phase 4) |
| Invalid placements | Node: `invalid placements are rejected without charging`, `cannot build on a cell occupied by a zombie` · Browser: toasts for spawn zone / rocks / castle (phase 1) |
| Construct without enough gold | Node: `cannot build without enough gold` · Browser: red cards and red ghosts beyond the affordable count (phase 1) |
| Corners and angles | Node: `pieceFor picks straight, corner and junction pieces` (all four corner rotations and all T/cross variants pinned) · Browser: verified top-down after the corner fix (phase 1) |
| Repair and upgrade damaged structures | Node: `repair restores to max for the quoted price`, `wall upgrades: escalating cost…`, gate repair/reinforce test · Browser: repair (R), upgrade (U), gate panel (phase 4) |
| Destroyed wall frees its cell | Node: `destroyed wall frees its cell and can be rebuilt`, breach test (rebuild clears the breach) |

## Heroes

| Item | How verified |
|---|---|
| Recruit all six classes | Node: one test per class · Browser: all six recruited from the Heroes tab (phase 3) |
| Assign to eligible positions / invalid deployment | Node: `invalid deployments are rejected and never duplicate heroes`, `hero capacity, no duplicates…` · Browser: green/red slot rings, "no free hero slot" toast (phase 2) |
| Capacity enforced | Node: capacity test (stone 1, reinforced 2) |
| Each class performs its attack | Node: `<class>: basic attack damages a zombie in range` × 6 |
| Every ability | Node: `<class>: every ability works, respects unlock level and cooldown` × 6 plus effect tests (multishot, piercing, fireball burn, frost slow, arcane, bash stun, rally, holy shield, consecration, AP bolt, poison cloud, explosion) · Browser: all 12 abilities fired in a live run (phase 3) |
| XP, levelling, upgrades | Node: `levelling raises class stats…`, `talents: need level and gold…` |
| Repositioning and dismissal | Node: reposition delay test, dismiss refund tests · Browser: M key and confirmed dismiss (phase 3) |
| No duplication / unlimited refunds | Node: `recruit/dismiss cannot generate gold`, `dismissing an upgraded hero never returns more than was spent`, `recruit prices rise… cycles always lose gold` |

## Combat and AI

| Item | How verified |
|---|---|
| Spawn every enemy type | Node: `every zombie type spawns and heads for the gate`, full-game test sees all 7 types incl. both bosses |
| Enemies move toward the fortress | Node: `a lone walker walks to the gate and damages it` |
| Intact walls block / zombies attack instead of passing | Node: `intact walls block: a closed line is attacked, not walked through` |
| Navigate through an opening | Node: `a destroyed wall becomes an opening the horde passes through`, `path reacts when a wall is removed` |
| Simultaneous breaches | Node: `simultaneous breaches: the horde pours through both openings` |
| Projectiles, DoT and AoE apply correctly | Node: `projectiles hit once each`, fireball/poison/consecration tests, armor/resist mitigation test |
| Dead units stop acting | Node: `dead enemies stop attacking and are cleaned up`; fallen heroes are unseated and cannot act or deploy |
| Never permanently stuck | Node: `zombies never stay stuck inside rocks or walls` (found via simulation in phase 4) |

## Progression

| Item | How verified |
|---|---|
| Multiple waves, difficulty increases | Node: `difficulty rises across real waves`, wave composition test |
| Elites and bosses | Node: `boss wave actually spawns its boss once; elites are tougher…`, boss ability tests · Browser: boss bar and banner (phase 4) |
| Gold and XP rewards (once only) | Node: `kills grant gold and XP exactly once`, wave clear bonus test |
| Limited resources | Balance simulation (below) and the recruit-cost / repair-cost tests |
| Countdown and early start | Node: `the prep countdown starts the next wave automatically, exactly once`, `waves: early start never duplicates` · Browser: double click on Start wave (phase 2) |

## Stability

| Item | How verified |
|---|---|
| Pause / resume during combat | Node: game-loop pause test · Browser: sim time frozen while paused, pause panel (phases 2, 5) |
| Change game speed | Node: `speed changes keep step size and totals consistent`, `cooldowns follow simulation time only` |
| Restart during combat | Browser: restart from the pause panel mid boss fight left 0 zombies, 0 projectiles, 0 zones, 0 breach markers, one HUD (phase 6) |
| Lose the fortress / game over | Node: `undefended fortress falls and the game ends exactly once` · Browser: game over screen with stats and records (phase 2) |
| Restart after game over leaves nothing behind | Browser: Play Again → 450 gold, wave 0, empty scene (phase 2, re-checked phase 6) |
| Window sizes | Browser: 1024×680, 1366×768, 1920×1080 — all top-bar controls on screen, side panel clear of the build bar, picking exact after resize (phase 6) |
| Console errors | Browser: no runtime errors during full runs (phases 2–6) |
| Bad or unavailable localStorage | Node: `save data is validated and corrupt saves fall back to defaults` (corrupt JSON, invalid fields, throwing storage) · Browser: corrupted save → game starts with defaults (phase 2) |

## Balance (tower redesign)

`node tools/simulate.js 6 all 150` after replacing recruitable heroes with elemental towers and one 2×2 champion:

| Strategy | Average wave reached | Reading |
|---|---|---|
| none | 1 | No defence falls at once |
| walls + champion only | ~5.5 | The champion alone cannot hold |
| fire / earth / wind / water only | ~18 / ~16 / ~18 / ~13 | One element stalls; water is support |
| mixed elements + upgrades + talents | ~37.5 | Combining elements is clearly strongest |

Changes made to reach this: tower price grows 5% per tower standing; enemy HP grows `1 + 0.1(n−1) + 0.02(n−1)²`; earth 62 dmg / 1.6 s / range 5, no splash.

## Balance (phase 6, before the redesign)

`node tools/simulate.js 5 all 150` plays scripted strategies headless (deterministic seeds):

| Strategy | Average wave reached | Reading |
|---|---|---|
| none | 1 | No defence falls at once |
| walls only | 1 | Walls alone cannot hold |
| archers only (+abilities) | ~22 | One class gets far but stalls |
| mages only (+abilities) | ~23 | Same; very swingy early |
| mixed classes + special walls + talents + abilities | ~37 | Combining walls and heroes is clearly strongest |

Changes made to reach this: recruit price grows 10% per hero owned; enemy HP grows `1 + 0.1(n−1) + 0.013(n−1)²`; more brutes and siege zombies per wave; starting gold 450; first bosses ~1100 HP; mage cost 120 with weaker abilities and longer cooldowns. The scripted "mixed" player uses abilities perfectly, so human runs will end earlier.

## Not verified automatically

- **How the sound actually sounds**: the browser only starts audio after a real user gesture, which simulated input cannot provide. The audio code runs without errors, but loudness and feel need a human ear.
- **Feel and readability** of combat at full speed with large hordes: judged from screenshots only.
