// Balance check: plays headless runs with scripted strategies and reports how far they get.
// Usage: node tools/simulate.js [runs=4] [strategy|all] [maxMinutes=45]
// Strategies:
//   none      - does nothing (baseline: should fall in wave 1-2)
//   walls     - walls and repairs only, no heroes (walls alone must not be enough)
//   archers   - closed wall line + only archers
//   mages     - closed wall line + only mages
//   mixed     - closed wall line with special walls + a rotation of all classes,
//               talents, abilities, revives and gate reinforcement (a competent player)
import { Simulation } from '../src/core/simulation.js';
import { PHASE } from '../src/core/waves.js';
import { MAP, HEROES } from '../src/config/game.js';

const runs = Number(process.argv[2] ?? 4);
const which = process.argv[3] ?? 'all';
const maxMinutes = Number(process.argv[4] ?? 45);
const DT = 1 / 30;

const STRATEGIES = {
  none: { walls: false, heroes: [] },
  walls: { walls: true, heroes: [] },
  archers: { walls: true, abilities: true, heroes: ['archer'] },
  mages: { walls: true, abilities: true, heroes: ['mage'] },
  mixed: {
    walls: true, special: true, talents: true, abilities: true, gate: true,
    heroes: ['archer', 'crossbowman', 'mage', 'warrior', 'archer', 'alchemist', 'paladin', 'crossbowman', 'mage'],
  },
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

/** Wall type per ring: reinforced inner ring, spiked/arcane outer rings with specials on. */
function wallTypeFor(k, x, special) {
  if (!special) return 'stone';
  if (k === 0) return 'reinforced';
  if (Math.abs(x - MAP.gateX) <= 1) return 'arcane';
  return k % 2 ? 'spiked' : 'stone';
}

/** Builds rings up to `maxRing` while gold allows, keeping `reserve` gold back. */
function buildRings(sim, st, reserve, maxRing = 5) {
  for (let k = 0; k <= maxRing; k++) {
    for (const [x, y] of ringCells(k)) {
      if (sim.grid.wallAt(x, y)) continue;
      const type = wallTypeFor(k, x, st.special);
      if (sim.economy.gold < sim.walls.costOf(type) + reserve) return;
      sim.walls.build(type, x, y);
    }
  }
}

function prepare(sim, st, state) {
  const { walls, heroes, economy } = sim;
  // Repairs first, then revive fallen heroes, then fill the line from the gate outward.
  for (const w of walls.all()) walls.repair(w.id);
  if (st.walls) sim.fortress.repair();
  for (const h of heroes.all()) if (h.fallen) heroes.revive(h.id);
  // Inner ring first (cheap), then heroes, then outer rings with what is left.
  if (st.walls) buildRings(sim, { ...st, special: st.special && state.prepped > 1 }, 0, st.heroes.length ? 0 : 5);
  // Recruit along the rotation while gold allows, keeping a repair reserve.
  while (st.heroes.length) {
    const type = st.heroes[state.next % st.heroes.length];
    if (economy.gold < heroes.recruitCost(type) + 60) break;
    const free = [...walls.all()].filter((w) => w.heroes.length < w.heroCapacity)
      .sort((a, b) => a.y - b.y || Math.abs(a.x - MAP.gateX) - Math.abs(b.x - MAP.gateX))[0];
    if (!free) break;
    const h = heroes.recruit(type);
    h.autoCast = !!st.abilities; // heroes auto-cast in the game; strategies without abilities turn it off
    heroes.deploy(h.id, free.id);
    state.next++;
  }
  for (const h of heroes.all()) {
    if (h.wallId || h.fallen) continue;
    const free = [...walls.all()].find((w) => w.heroes.length < w.heroCapacity);
    if (free) heroes.deploy(h.id, free.id);
  }
  if (st.walls) buildRings(sim, st, 60);
  if (st.talents) {
    for (const h of heroes.all()) {
      for (const tier of heroes.talentTiers(h)) {
        if (!tier.chosen && tier.unlocked) heroes.buyTalent(h.id, tier.index, tier.options[(h.id + tier.index) % 2].id);
      }
    }
  }
  if (st.gate && sim.fortress.nextReinforcement() && economy.gold > 700) sim.fortress.reinforce();
  if (st.walls && economy.gold > 400) {
    const w = [...walls.all()].filter((x) => walls.canUpgrade(x.id).ok)
      .sort((a, b) => Math.abs(a.x - MAP.gateX) - Math.abs(b.x - MAP.gateX))[0];
    if (w) walls.upgrade(w.id);
  }
}

function play(seed, name) {
  const st = STRATEGIES[name];
  const sim = new Simulation({ seed });
  const state = { next: 0, prepped: -1, castTimer: 0 };
  let bossesKilled = 0;
  sim.events.on('zombieKilled', ({ zombie }) => { if (zombie.boss) bossesKilled++; });
  while (!sim.over && sim.time < maxMinutes * 60) {
    if (sim.waves.phase === PHASE.PREP && state.prepped !== sim.waves.wave) {
      state.prepped = sim.waves.wave;
      prepare(sim, st, state);
      if (name !== 'none') sim.waves.startNext();
    }
    sim.step(DT);
  }
  return { ...sim.summary(), bossesKilled, timedOut: !sim.over };
}

const names = which === 'all' ? Object.keys(STRATEGIES) : [which];
for (const name of names) {
  const res = [];
  for (let i = 1; i <= runs; i++) res.push(play(i * 7919, name));
  const waves = res.map((r) => r.wave);
  const avg = waves.reduce((a, b) => a + b, 0) / runs;
  const extra = res.some((r) => r.timedOut) ? ` (${res.filter((r) => r.timedOut).length} hit the ${maxMinutes}-min cap)` : '';
  console.log(`${name.padEnd(8)} waves [${waves.join(', ')}] avg ${avg.toFixed(1)}  bosses killed avg ${(res.reduce((a, r) => a + r.bossesKilled, 0) / runs).toFixed(1)}  heroes avg ${(res.reduce((a, r) => a + r.heroes, 0) / runs).toFixed(0)}${extra}`);
}
