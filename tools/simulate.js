// Balance check: plays headless runs with scripted strategies and reports how far they get.
// Usage: node tools/simulate.js [runs=4] [strategy|all] [maxMinutes=150]
// LEVELS=1 also prints the champion's level after every cleared wave (XP pacing check).
// Every strategy except "none" builds rings of walls around the gate, repairs, revives the
// champion and reinforces the gate. They differ in what they build on the walls:
//   none       - does nothing (baseline: should fall in wave 1-2)
//   walls      - walls and the champion only, no towers
//   fire|earth|wind|water - champion plus only that tower type
//   mixed      - champion plus a rotation of all four elements, with upgrades and talents
import { Simulation } from '../src/core/simulation.js';
import { PHASE } from '../src/core/waves.js';
import { MAP, TOWERS } from '../src/config/game.js';

const runs = Number(process.argv[2] ?? 4);
const which = process.argv[3] ?? 'all';
const maxMinutes = Number(process.argv[4] ?? 150);
const DT = 1 / 30;

const STRATEGIES = {
  none: { walls: false, towers: [] },
  walls: { walls: true, towers: [] },
  ...Object.fromEntries(Object.keys(TOWERS).map((t) => [t, { walls: true, towers: [t], upgrades: true }])),
  mixed: { walls: true, towers: ['wind', 'fire', 'earth', 'water'], upgrades: true, talents: true, special: true },
};

/**
 * Defensive rings around the gate, innermost first: ring k is a U whose top row is
 * 2k+2 rows north of the castle wall, closed down to the castle wall on both sides.
 */
function ringCells(k) {
  const gx = MAP.gateX, top = MAP.castleWallRow - 2 - 2 * k, half = 2 + 2 * k;
  const cells = [];
  for (let x = gx - half; x <= gx + half; x++) cells.push([x, top]);
  for (let y = top + 1; y < MAP.castleWallRow; y++) cells.push([gx - half, y], [gx + half, y]);
  return cells.filter(([x, y]) => x >= 0 && x < MAP.width && y >= MAP.spawnRows);
}

/** The champion's 2x2 block sits just north of the inner ring. */
const BLOCK = { x: MAP.gateX - 1, y: MAP.castleWallRow - 5 };

function buildRings(sim, st, reserve, maxRing = 5) {
  for (let k = 0; k <= maxRing; k++) {
    for (const [x, y] of ringCells(k)) {
      if (sim.grid.wallAt(x, y)) continue;
      const type = st.special && k === 0 ? 'reinforced' : 'stone';
      if (sim.economy.gold < sim.walls.costOf(type) + reserve) return;
      sim.walls.build(type, x, y);
    }
  }
}

function prepare(sim, st, state) {
  const { walls, heroes, towers, economy } = sim;
  for (const w of walls.all()) walls.repair(w.id);
  if (st.walls) sim.fortress.repair();
  const champ = [...heroes.all()][0];
  if (champ?.fallen) heroes.revive(champ.id);
  if (!st.walls) return;
  // Champion block first, then the inner ring, then towers, then outer rings.
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    if (!sim.grid.wallAt(BLOCK.x + dx, BLOCK.y + dy)) walls.build('stone', BLOCK.x + dx, BLOCK.y + dy);
  }
  if (champ && !champ.wallId && !champ.fallen) heroes.deploy(champ.id, sim.grid.wallAt(BLOCK.x, BLOCK.y));
  buildRings(sim, st, 0, 0);
  while (st.towers.length) {
    const type = st.towers[state.next % st.towers.length];
    if (economy.gold < towers.costOf(type) + 50) break;
    const free = [...walls.all()].filter((w) => !w.towerId && !w.heroes.length)
      .sort((a, b) => a.y - b.y || Math.abs(a.x - MAP.gateX) - Math.abs(b.x - MAP.gateX))[0];
    if (!free) break;
    towers.build(type, free.id);
    state.next++;
  }
  if (st.upgrades) {
    for (const t of [...towers.all()].sort((a, b) => a.level - b.level)) {
      if (economy.gold > towers.upgradeCost(t.id) + 150) towers.upgrade(t.id);
    }
  }
  buildRings(sim, st, 80);
  if (st.talents && champ) {
    for (const tier of heroes.talentTiers(champ)) {
      if (!tier.chosen && tier.unlocked) heroes.buyTalent(champ.id, tier.index, tier.options[tier.index % 2].id);
    }
  }
  if (sim.fortress.nextReinforcement() && economy.gold > 700) sim.fortress.reinforce();
}

function play(seed, name, heroType) {
  const st = STRATEGIES[name];
  const sim = new Simulation({ seed });
  sim.heroes.recruitChampion(heroType);
  const state = { next: 0, prepped: -1 };
  let bossesKilled = 0;
  sim.events.on('zombieKilled', ({ zombie }) => { if (zombie.boss) bossesKilled++; });
  const levels = [];
  sim.events.on('waveCleared', () => levels.push([...sim.heroes.all()][0]?.level ?? 0));
  while (!sim.over && sim.time < maxMinutes * 60) {
    if (sim.waves.phase === PHASE.PREP && state.prepped !== sim.waves.wave) {
      state.prepped = sim.waves.wave;
      prepare(sim, st, state);
      if (name !== 'none') sim.waves.startNext();
    }
    sim.step(DT);
  }
  return { ...sim.summary(), bossesKilled, levels, heroType, towers: sim.towers.count, timedOut: !sim.over };
}

const names = which === 'all' ? Object.keys(STRATEGIES) : [which];
const heroTypes = ['archer', 'mage', 'warrior', 'crossbowman', 'paladin', 'alchemist'];
for (const name of names) {
  const res = [];
  for (let i = 1; i <= runs; i++) res.push(play(i * 7919, name, heroTypes[(i - 1) % heroTypes.length]));
  const waves = res.map((r) => r.wave);
  const avg = waves.reduce((a, b) => a + b, 0) / runs;
  const capped = res.filter((r) => r.timedOut).length;
  if (process.env.LEVELS) for (const r of res) console.log(`  ${r.heroType.padEnd(11)} level after each wave: ${r.levels.join(' ')}`);
  console.log(`${name.padEnd(7)} waves [${waves.join(', ')}] avg ${avg.toFixed(1)}  bosses ${(res.reduce((a, r) => a + r.bossesKilled, 0) / runs).toFixed(1)}  towers ${(res.reduce((a, r) => a + r.towers, 0) / runs).toFixed(0)}${capped ? `  (${capped} hit the ${maxMinutes}-min cap)` : ''}`);
}
