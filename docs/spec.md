# DEADWALL — Game Spec

Condensed from the original design brief. Section numbers match the original. Every requirement is kept; prose is trimmed.

Core principle: **Walls control the battlefield. Heroes defend the walls. Zombies try to destroy both and overwhelm the fortress.** No automated towers — firepower comes from recruitable, upgradeable heroes. Three pillars: Construction, Heroes, Survival. Must be a complete, polished, playable game — no placeholders, no fake buttons.

## 1. World and battlefield
- Isometric, elevated three-quarter view; consistent projection, believable depth, clear grid, readable combat.
- Fortress on the **south** edge; main gate near center of the southern line. Zombie spawn area in the **north**; zombies advance south.
- Buildable grid between spawn and fortress, with room for multiple layouts and several simultaneous enemy groups.
- Set dressing: roads, ruins, dead trees, abandoned carts, broken fences, rocks, debris, torches, braziers, fog, smoke, atmospheric lighting.
- Castle is a landmark: stone towers, battlements, banners, fortified gate, visible damage when attacked.
- Clear indicators for: spawn locations, valid build cells, occupied wall positions, hero deployment spots, damaged structures, breaches, main gate.
- Accurate screen ↔ world ↔ iso-grid conversion; clicks hit the right cell at any zoom/pan/resolution. Hover feedback on walls, heroes, enemies, build cells. Camera can inspect the whole defensive line.

## 2. Walls and fortification
- Select wall type → transparent preview (green valid / red invalid) → click to build. Segments connect visually and mechanically (lines, corners, endpoints, enclosures, gates).
- Prevent overlap, blocked terrain, and purchases over current gold.
- Select a segment to inspect health, repair, upgrade, or sell. Selling returns a balanced portion; selling critical structures needs safeguards.
- Every segment has: unique id, type, current/max health, build cost, upgrade level, repair cost, hero capacity, grid position, collision, damage/destruction states.

| Type | Role | Notes | Look |
|---|---|---|---|
| Stone | Basic | Cheap, moderate HP, balanced resistance, limited hero capacity, repair/upgrade | Gray stone, mortar, battlements, some wood |
| Reinforced | Long sieges | Higher HP, resists heavy attacks, pricier, holds heroes, upgradeable | Thick stone, timber, metal braces, plating |
| Spiked | Anti-horde | Moderate HP, contact damage to attackers, weaker than Reinforced, upgrade raises contact dmg | Stakes, iron spikes, barricades |
| Arcane | Magic control | Expensive, moderate–high HP, visible aura, slows nearby zombies, periodic magic damage, upgradeable | Dark stone, glowing blue runes, crystals |
| Fortress Gate | Critical | Own HP and damage states, repair/reinforce, pricier upgrades; **destroyed = immediate defeat**; visibly degrades | Fortified gate |

## 3. Heroes
Six classes, each with distinct silhouette, role, animations, stats, progression. Stand on battlements facing the enemy, auto-attack, use abilities, gain XP. No class universally best.

| Class | Role | Stats | Basic | Abilities | Look |
|---|---|---|---|---|---|
| Archer | Fast ranged | Fast speed, moderate dmg, long range, moderate HP, low–mod cost. Strong vs Walkers/Runners, weak vs armor | Arrows | **Multishot** (rapid arrows at several targets), **Piercing Arrow** (passes through a line) | Hooded, bow, quiver, green/brown leather |
| Mage | AoE + crowd control | Moderate speed, high AoE, moderate range, fragile, expensive. Weak vs isolated magic-resistant | Glowing projectile | **Fireball** (blast radius), **Arcane Blast** (heavy concentrated burst), **Frost Nova** (slow pulse) | Dark robes, crystal staff, blue/violet/fire FX |
| Warrior | Frontline tank | High HP, strong melee, short range, slow–mod speed, high physical resist, **reduces damage to its wall**, fights inside after breaches | Sword | **Shield Bash** (dmg + stun), **Rally** (temp defense buff to nearby heroes) | Heavy armor, sword & shield, broad |
| Crossbowman | Heavy single-target | Very high dmg/shot, slow, long range, moderate HP, expensive. Great vs Brutes/Siege/bosses, weak vs swarms | Heavy bolt | **Armor-Piercing Bolt** (ignores armor, bonus vs armored) | Heavy crossbow, leather+metal |
| Paladin | Support/protection | High HP, moderate melee and speed, moderate cost, buffs nearby heroes, slowly repairs nearby walls | Holy strike | **Holy Shield** (reduce dmg to a wall + nearby heroes), **Consecration** (holy DoT area) | Gold/silver armor, warm light |
| Alchemist | DoT + area control | Moderate speed/direct dmg, strong DoT, AoE, moderate range, fragile | Flask | **Toxic Flask** (poison cloud), **Explosive Mixture** (large burst) | Apron, belt, flasks, green clouds, orange blasts |

Stats per hero (configurable, centralized): max/current HP, damage, attack speed, range, repositioning rules, recruit cost, XP, level, upgrade cost, ability cooldowns, special modifiers.

## 4. Recruitment and deployment
- Heroes menu: inspect classes, compare, recruit with gold. Then select hero → click valid wall position.
- Only eligible positions; walls have limited capacity; special platforms hold several. One hero = one position. Reject invalid; never duplicate a hero. Account for iso geometry; face the enemy.
- Highlight eligible/occupied positions while deploying. Allow repositioning when capacity exists; show any time/gold cost first.
- Hero panel: name, class, portrait, level, HP, damage, speed, range, XP bar, upgrade cost, abilities + cooldowns, upgrades, reposition, dismiss/sell. Confirm before dismissing expensive/high-level heroes. Balanced refund, no recruit/sell gold exploit.
- Heroes auto-target; the player never has to order basic attacks.

## 5. Combat and abilities
- Targeting considers distance to fortress, HP, armor, type, range, ability fit, alive/reachable. Default: biggest immediate threat to the line. Optional per-hero preference: closest to fortress, highest HP, lowest HP, strongest, nearest — consistent across classes.
- Implement: projectile movement, cooldowns, hit detection, damage calc, crits, AoE, armor/resistance, poison & burning, slow & stun, damage numbers, enemy HP bars, hit reactions, death animations, audio/visual feedback.
- Every projectile tied to attacker + effect; no duplicate damage. Dead enemies immediately invalid targets.
- Abilities activated from UI; targeted ones show a preview and confirm. Cooldown timers on buttons. Blocked when hero dead/unavailable. Abilities must have real effects.

## 6. XP and upgrades
- XP for damaging/killing, shared fairly among contributors. Level-ups improve class-relevant stats (Archer speed/accuracy/dmg; Mage spell dmg/AoE; Warrior HP/armor/melee; Crossbow armor pen/heavy dmg; Paladin healing/support/durability; Alchemist poison duration/explosions).
- Upgrade UI: level, XP, XP to next, current stats, projected stats, cost, unlocks, skill improvements.
- Gold upgrades with rising costs. Include behavior-changing choices, not just %: extra pierce, bigger fireball radius, Warrior protects adjacent walls, more armor pen, Paladin aura resist, longer poison clouds.
- If heroes can die: warn clearly, provide balanced revive/replace; high-level heroes never vanish without warning.

## 7. Zombie types
| Type | Traits |
|---|---|
| Walker | Slow, low–mod HP, moderate wall dmg, large numbers, baseline |
| Runner | Fast, low HP, finds weak sections, dangerous through breaches |
| Brute | High HP, slow, heavy melee, big wall dmg, resistant; weak to armor-piercing |
| Plague Carrier | Moderate HP, poison around attacked spots, weakens nearby heroes, leaves hazard zones |
| Siege Zombie | Very high wall dmg, mod–high HP, targets critical structures, strong vs reinforced walls |
| Boss | Big HP bar, unique look, unique attack patterns + abilities, high resistance, big gold reward, battle-changing (e.g. smash adjacent walls, summon, charge weak spots, empower undead). Needs walls + composition + abilities to beat |

## 8. AI, pathfinding, breaches
- Spawn north, path south with grid A* (or similar). Intact walls block. Choose sensible routes by distance, accessibility, wall resistance; some target weakest section, siege units target important structures.
- At a wall: move to valid attack spot → stop → attack at its rate → damage the correct segment → react to hits → resume when wall falls or a new route opens. No permanent sticking or target thrashing.
- Recompute paths when walls are built/destroyed; never recompute all paths every frame.
- Breach: destruction anim, dust/debris, collision removed immediately, navigation updated, zombies pass through, player alert, breach counter. Heroes on that wall react (stay, retreat to nearby slot, or defend inside — per rules). Rebuild possible. Multiple simultaneous breaches possible.

## 9. Damage, repair, fortress
- On wall hit: impact anim, damage number, HP bar drop, sound, progressive type-specific deterioration (cracks, missing stones, broken battlements, splinters). Warning at critical HP.
- Repair: show cost first, restore by a defined rule, never above max, partial repairs allowed. Paladins give slow auto-repair/temporary reinforcement.
- Gate: own HP/states; zombies through the outer wall attack it; repair/reinforce with gold; **0 HP = immediate game over**; escalating warnings.

## 10. Economy
- Gold only; prominent in HUD.
- Income: kills (each enemy has a defined reward, granted exactly once), wave completion, elites, bosses, optional objectives.
- Spend: walls, hero recruit/upgrades/ability unlocks, repairs, gate reinforcement, defensive improvements.
- Real trade-offs (repair vs recruit vs upgrade). Early waves fund a basic defense; later waves force careful allocation. No unlimited gold from passive income, selling, refunds or abilities. All purchases validated against the current balance.

## 11. Endless waves
- Escalate via count, HP, damage, speed/variety, more armor, more siege, bosses, pressure on multiple sections. Gradual; no extreme multipliers.
- Prep phase between waves: build, repair, recruit, reposition, upgrade, reinforce gate, preview next wave. Early-start button (never duplicates a wave).
- HUD: wave #, enemies left, countdown, gold, fortress HP, breaches, deployed heroes, boss HP when active. Elites occasionally, bosses every several waves, threat preview before major waves.

## 12. UI and controls
- Dark-fantasy, readable, never covers key combat.
- HUD: DEADWALL logo, wave, gold, fortress HP, enemy count, breaches, hero count, countdown, pause/resume, speed controls, early-start.
- Build panel with tabs: **Walls** (cost, durability, specials, upgrades), **Heroes** (cost, role, strengths/weaknesses), **Upgrades** (fortress improvements, defensive bonuses, unlock requirements). Clear feedback for unavailable actions.
- Context panels for selected wall / hero / enemy (enemy: type, HP, armor, specials, threat).
- Mouse: select, place, deploy, inspect, abilities, repair/upgrade, cancel modes, deselect. Keyboard shortcuts. UI clicks never fall through to the battlefield. Tooltips for costs, controls, stats, effects. Works at common desktop/laptop resolutions.

## 13. Visuals and animation
- Indie dark-fantasy quality. Palette: charcoal, gray stone, muted brown, dark red, toxic green, magic blue, gold. Strong silhouettes, clear feedback.
- Environment: battlements, fortress architecture, wood, torches/firelight, ruins, dead trees, fog, smoke, subtle ambient animation, shadows/depth.
- Heroes animate: idle, aim, attack, cast, hurt, die, level up. Zombies: move + attack; large enemies look more threatening.
- FX: arrows, bolts, magic projectiles, fireball explosions, frost, poison clouds, holy energy, melee impacts, damage numbers, HP bars, debris, collapse, crit indicators, level-up. Informative but not overwhelming.
- No emojis as primary visuals. Shadows, highlights, coherent proportions. (Project decision: CC0 3D models via Three.js — see CLAUDE.md.)

## 14. Audio
- Lightweight SFX: bow, crossbow, magic, melee, zombie attack, wall destroyed, construction, repair, gold, level-up, wave start, boss, fortress damage, game over.
- Generated/procedural where practical; no paid assets. Mute + volume controls. Start only after user interaction (autoplay rules). Not repetitive or distracting.

## 15. Architecture
- Browser game, no backend, no paid assets, no mandatory external services.
- Separate modules: rendering, iso coordinates, camera/zoom, input, grid & construction, wall connectivity, hero recruit/deploy, hero stats/progression, combat/targeting, projectiles, zombie AI, pathfinding, collision, wall damage, waves, economy, UI, audio, save data, game state/restart.
- Centralized config for all gameplay stats.
- Frame-rate-independent loop on elapsed time; simulation separate from rendering. Avoid needless allocation, redundant pathfinding, full-entity scans every frame; spatial grid/partitioning for large hordes.
- States: main menu, playing, wave prep, paused, special/victory as applicable, game over. Pause freezes sim, movement, attack timers, countdowns (UI still usable). Speed changes consistent — no extra damage, duplicate rewards or broken cooldowns. Restart fully resets transient state.
- localStorage: best wave, high score, total kills, settings, other stats. Validate; corrupted/outdated save never blocks startup; saved values never corrupt the current run.

## 16. Mandatory reliability rules
- Gold never negative; one action = one purchase.
- Dead enemies never re-award gold/XP; dead heroes/enemies never act.
- A hero occupies one position; capacity never exceeded.
- Destroyed walls stop blocking; intact walls block; paths react to openings.
- A projectile hits a target once per collision unless the attack is explicitly multi-hit.
- Cooldowns consistent across pause and speed changes.
- Build previews accurately show validity.
- Gate remains the defeat condition.
- Restart removes all enemies, projectiles, effects, timers, combat state.
- Early wave start never duplicates enemies.
- Sell/repair/recruit/upgrade update UI immediately; every important button does what it says.
- Clear feedback for insufficient gold or invalid actions.

## 17. Balance and replayability
- Early game teaches walls ↔ heroes ↔ zombie movement; mid game mixes enemies and forces specialization; late game tests adaptation, economy, simultaneous breaches.
- No single class solves everything; walls matter all game; upgrades useful but costly; repairs compete with expansion/recruiting; bosses need preparation; composition and layout matter; breach recovery hard but possible; every defeat is understandable.
- Multiple viable strategies: concentrated lines, reinforced choke points, anti-horde formations, flexible positioning. Endless mode drives personal bests.

## 18. Required playable loop
1. Main menu → 2. New game → 3. Battlefield, fortress, grid, spawn shown → 4. Enough starting gold → 5. Build Stone Wall → 6. Recruit Archer → 7. Assign Archer to wall → 8. Start wave 1 → 9. Zombies spawn north and advance → 10. Archer auto-targets and fires → 11. Zombies damage walls → 12. Wall HP, damage feedback, deterioration → 13. Walls break, real openings → 14. Zombies pass through → 15. Gold + XP rewards → 16. Repair/rebuild → 17. Recruit other classes → 18. Upgrade heroes, use abilities → 19. Harder waves, eventually a boss → 20. Classes behave differently → 21. Pause/resume/speed → 22. Play until the fortress falls → 23. Game-over screen with wave, score, stats → 24. Clean restart → 25. Persistent high scores saved and shown.

Each step must work in real gameplay.

## 19. Testing / acceptance
- **Construction:** every wall type; invalid placements; insufficient gold; corners/angles; repair and upgrade; destroyed wall frees its cell.
- **Heroes:** recruit all 6; valid/invalid deployment; capacity; each class's attack; every ability; XP/levels/upgrades; reposition and dismiss; no duplication or refund exploits.
- **Combat/AI:** every enemy type; enemies head to fortress; walls block; zombies attack walls rather than pass through; navigate through openings; simultaneous breaches; projectiles/DoT/AoE apply correctly; dead units stop acting.
- **Progression:** multiple waves; difficulty rises; elites and bosses; gold/XP; limited-resource decisions; countdown and early start.
- **Stability:** pause/resume in combat; speed changes; restart in combat; lose; game over; restart after game over leaves nothing behind; window sizes; no console errors; bad/failed localStorage doesn't block startup.
- Use automated browser testing where possible. Never claim a test passed unless it ran.

## 20. Deliverable
A complete, playable browser game: menu, battlefield, construction, heroes, combat, AI, waves, economy, upgrades, defeat, restart. No placeholders or mock controls. If something secondary must be simplified, keep core mechanics and make the simplified version work.
