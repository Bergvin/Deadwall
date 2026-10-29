// Balance check: plays headless runs with scripted strategies and reports how far they get.
// Usage: node tools/simulate.js [runs=4] [strategy|all] [maxMinutes=150]
// LEVELS=1 also prints the champion's level after every cleared wave (XP pacing check).
// BUILDS=1 prints each run's final hero build and which abilities show up in deep runs
// (a quick way to spot overpowered combos).
// COMMANDER=fresh|mid|strong plays with a commander profile (perks, skills, artifacts);
// targets: fresh dies around wave 5, a mid commander gets clearly further, strong far.
// Every strategy except "none" builds rings of walls around the gate, repairs, revives the
// champion and reinforces the gate. They differ in what they build on the walls:
//   none       - does nothing (baseline: should fall in wave 1-2)
//   walls      - walls and the champion only, no towers
//   fire|earth|wind|water - champion plus only that tower type
//   mixed      - champion plus a rotation of all four elements, with upgrades and talents
import { Simulation } from '../src-classic/core/simulation.js';
import { PHASE } from '../src-classic/core/waves.js';
import * as CFG from '../src-classic/config/game.js';
import { MAP, TOWERS } from '../src-classic/config/game.js';
import { commanderDefaults, addArtifact, runConfig } from '../src-classic/core/commander.js';

/** Commander profiles: what a player might have after some (mid) or many (strong) runs. */
const PROFILES = {
  fresh: { level: 1, perks: [], artifacts: [] },
  mid: {
    level: 12,
    perks: [['sharpSteel', 'uncommon'], ['quickHands', 'common'], ['masonry', 'common'], ['warChest', 'uncommon'],
      ['oakenGate', 'common'], ['skillMeteor', 'uncommon'], ['plunder', 'common'], ['engineers', 'common'],
      ['sharpSteel', 'common'], ['skillJudgement', 'uncommon'], ['tribute', 'rare']],
    artifacts: [['bloodstone', 'rare'], ['mortar', 'uncommon'], ['windcaller', 'uncommon'], ['gateWard', 'common']],
  },
  strong: {
    level: 25,
    perks: [['sharpSteel', 'rare'], ['sharpSteel', 'uncommon'], ['quickHands', 'rare'], ['quickHands', 'uncommon'],
      ['masonry', 'rare'], ['warChest', 'legendary'], ['oakenGate', 'rare'], ['skillMeteor', 'rare'], ['plunder', 'rare'],
      ['engineers', 'rare'], ['skillJudgement', 'legendary'], ['tribute', 'rare'], ['skillFrost', 'uncommon'],
      ['eagleEyes', 'rare'], ['hardened', 'uncommon'], ['quarry', 'uncommon'], ['skillStorm', 'rare'], ['skillMasonry', 'uncommon'],
      ['witheringCurse', 'legendary'], ['ironSpikes', 'common'], ['mentor', 'uncommon'], ['skillBulwark', 'uncommon'],
      ['luckyStrikes', 'uncommon'], ['skillTithe', 'rare']],
    artifacts: [['bloodstone', 'legendary', 3], ['mortar', 'rare', 2], ['windcaller', 'legendary', 2],
      ['gateWard', 'rare', 2], ['heartOfWinter', 'rare', 2], ['kingslayer', 'legendary']],
  },
};

function commanderConfig(name) {
  const p = PROFILES[name];
  if (!p) throw new Error(`unknown COMMANDER profile ${name}`);
  const cmd = { ...commanderDefaults(), level: p.level };
  cmd.perks = p.perks.map(([id, rarity]) => ({ id, rarity }));
  for (const [id, rarity, level = 1] of p.artifacts) {
    const a = addArtifact(cmd, { id, rarity }).artifact;
    a.level = level;
  }
  return runConfig(CFG, cmd);
}
const runCfg = process.env.COMMANDER ? commanderConfig(process.env.COMMANDER) : undefined;

const runs = Number(process.argv[2] ?? 4);
const which = process.argv[3] ?? 'all';
const maxMinutes = Number(process.argv[4] ?? 150);
const DT = 1 / 30;

const STRATEGIES = {
  none: { walls: false, towers: [] },
  walls: { walls: true, towers: [] },
  ...Object.fromEntries(Object.keys(TOWERS).map((t) => [t, { walls: true, towers: [t], upgrades: true }])),
  mixed: { walls: true, towers: ['wind', 'fire', 'earth', 'roller', 'water'], upgrades: true, talents: true, special: true },
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
  if (champ) heroBuild(sim, champ);
  if (sim.fortress.nextReinforcement() && economy.gold > 700) sim.fortress.reinforce();
}

const R = (r) => CFG.RARITIES.indexOf(r);

/** Between waves: take every ability pick (best rarity, synergy first) and wear the best drops. */
function heroBuild(sim, h) {
  const { heroes } = sim;
  while (h.pendingPicks > 0) {
    const offer = heroes.abilityOffer(h.id);
    if (!offer?.length) break;
    const best = offer.map((o, i) => ({ o, i })).sort((a, b) => R(b.o.rarity) - R(a.o.rarity) || b.o.synergy - a.o.synergy)[0];
    if (!heroes.chooseAbility(h.id, best.i)) break;
  }
  for (const item of [...h.bag].sort((a, b) => R(b.rarity) - R(a.rarity))) {
    const cur = item.slot === 'weapon' ? h.weapon : h.gear[item.slot];
    if (!cur || R(item.rarity) > R(cur.rarity)) heroes.equipItem(h.id, item.uid);
  }
  for (const item of [...h.bag]) heroes.sellItem(h.id, item.uid);
}

function play(seed, name, heroType) {
  const st = STRATEGIES[name];
  const sim = new Simulation({ seed, config: runCfg });
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
  const hero = [...sim.heroes.all()][0];
  return {
    ...sim.summary(), bossesKilled, levels, heroType, towers: sim.towers.count, timedOut: !sim.over,
    weapon: hero ? `${hero.weapon.rarity} ${hero.weapon.name}` : '', abilities: hero ? { ...hero.abilities } : {},
  };
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
  if (process.env.BUILDS) {
    for (const r of res) console.log(`  wave ${String(r.wave).padStart(2)} ${r.heroType.padEnd(11)} ${r.weapon} · ${Object.entries(r.abilities).map(([k, v]) => `${k}${v > 1 ? v : ''}`).join(' ')}`);
    const per = {};
    for (const r of res) for (const k of Object.keys(r.abilities)) (per[k] ??= []).push(r.wave);
    const avg = res.reduce((s, r) => s + r.wave, 0) / res.length;
    const top = Object.entries(per).filter(([, w]) => w.length >= 2)
      .map(([k, w]) => [k, w.reduce((s, x) => s + x, 0) / w.length, w.length]).sort((a, b) => b[1] - a[1]);
    console.log(`  abilities in runs above the average (${avg.toFixed(1)}): ${top.filter((t) => t[1] > avg).map(([k, a, n]) => `${k} ${a.toFixed(1)} (${n})`).join(', ')}`);
  }
  console.log(`${process.env.COMMANDER ? `[${process.env.COMMANDER}] ` : ''}${name.padEnd(7)} waves [${waves.join(', ')}] avg ${avg.toFixed(1)}  bosses ${(res.reduce((a, r) => a + r.bossesKilled, 0) / runs).toFixed(1)}  towers ${(res.reduce((a, r) => a + r.towers, 0) / runs).toFixed(0)}${capped ? `  (${capped} hit the ${maxMinutes}-min cap)` : ''}`);
}
