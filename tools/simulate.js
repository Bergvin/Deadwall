// Balance check: plays headless runs with scripted strategies and reports how far they get.
// Usage: node tools/simulate.js [runs=4] [strategy|all] [maxMinutes=60] [map|all]
// COMMANDER=fresh|mid|strong plays with a commander profile (perks, skills, artifacts).
// RUNNER=1 prints the runner's level, refills and bonks per run; PICKS=1 his perks.
// Strategies (all use the auto-supplying runner and cast spells when useful):
//   none     - builds nothing (baseline: falls in wave 1-2)
//   arrow|fire|frost|boulder|gale|roller - only that tower type
//   mixed    - a sensible mix: arrows first, then frost, fire, boulder, gale, roller
//   lazy     - mixed, but the runner never casts spells and never gets orders
// The bot places each tower on the free cell that covers the most road (corners!), builds
// while it has slots, then upgrades the tower with the cheapest next level, alternating
// specialisations, and repairs the house between waves.
import { Simulation } from '../src/core/simulation.js';
import { PHASE } from '../src/core/waves.js';
import { coverage } from '../src/core/paths.js';
import * as CFG from '../src/config/game.js';
import { commanderDefaults, addArtifact, runConfig } from '../src/core/commander.js';

/** Commander profiles: what a player might have after some (mid) or many (strong) runs. */
const PROFILES = {
  fresh: { level: 1, perks: [], artifacts: [] },
  mid: {
    level: 12,
    perks: [['sharpSteel', 'uncommon'], ['quickHands', 'common'], ['stoneHouse', 'common'], ['warChest', 'uncommon'],
      ['sneakers', 'common'], ['skillMeteor', 'uncommon'], ['plunder', 'common'], ['engineers', 'common'],
      ['sharpSteel', 'common'], ['skillJudgement', 'uncommon'], ['tribute', 'rare']],
    artifacts: [['bloodstone', 'rare'], ['quiver', 'uncommon'], ['windcaller', 'uncommon'], ['hearth', 'common']],
  },
  strong: {
    level: 25,
    perks: [['sharpSteel', 'rare'], ['sharpSteel', 'uncommon'], ['quickHands', 'rare'], ['quickHands', 'uncommon'],
      ['deepPockets', 'rare'], ['warChest', 'legendary'], ['stoneHouse', 'rare'], ['skillMeteor', 'rare'], ['plunder', 'rare'],
      ['engineers', 'rare'], ['skillJudgement', 'legendary'], ['tribute', 'rare'], ['skillFrost', 'uncommon'],
      ['eagleEyes', 'rare'], ['packMule', 'uncommon'], ['architects', 'uncommon'], ['skillStorm', 'rare'], ['skillSupply', 'uncommon'],
      ['witheringCurse', 'legendary'], ['extraPlot', 'legendary'], ['mentor', 'uncommon'], ['skillBulwark', 'uncommon'],
      ['luckyStrikes', 'uncommon'], ['skillTithe', 'rare']],
    artifacts: [['bloodstone', 'legendary', 3], ['quiver', 'rare', 2], ['windcaller', 'legendary', 2],
      ['hearth', 'rare', 2], ['heartOfWinter', 'rare', 2], ['kingslayer', 'legendary']],
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
const runCfg = process.env.COMMANDER ? commanderConfig(process.env.COMMANDER) : runConfig(CFG, commanderDefaults());

const runs = Number(process.argv[2] ?? 4);
const which = process.argv[3] ?? 'all';
const maxMinutes = Number(process.argv[4] ?? 60);
const mapArg = process.argv[5] ?? 'oldroad';
const DT = 1 / 30;
const MIX = ['arrow', 'frost', 'fire', 'boulder', 'gale', 'roller', 'arrow', 'fire', 'frost', 'boulder'];
const RARITY_RANK = Object.fromEntries(CFG.RARITIES.map((r, i) => [r, i]));

/** Free cell with the most road in reach of a tower of this type (closer to the house wins ties). */
function bestCell(sim, type) {
  const range = sim.config.TOWERS[type].range;
  const covered = new Map();
  for (const t of sim.towers.all()) for (const p of sim.paths) covered.set(p.id, (covered.get(p.id) ?? 0) + coverage(p, t.cx, t.cz, t.stats.range, 0.5) / 4);
  let best = null, bestScore = -1;
  for (let y = 0; y < sim.grid.height; y++) {
    for (let x = 0; x < sim.grid.width; x++) {
      if (!sim.grid.isBuildable(x, y) || sim.towers.tooClose(x, y)) continue;
      let score = 0;
      // Every road the map will use, already covered roads count less (spread the cover).
      for (const p of sim.paths) score += Math.sqrt(coverage(p, x + 0.5, y + 0.5, range, 0.5) / (1 + (covered.get(p.id) ?? 0)));
      // Short trips for the runner: prefer spots nearer the house a little.
      score -= Math.hypot(x + 0.5 - sim.house.x, y + 0.5 - sim.house.z) * 0.05;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best;
}

function act(sim, strategy) {
  const types = strategy === 'mixed' || strategy === 'lazy' ? MIX : [strategy];
  const t = sim.towers;
  // Build while there are slots.
  while (t.count < t.slots) {
    const type = types[t.count % types.length];
    if (!sim.economy.canAfford(t.costOf(type))) break;
    const c = bestCell(sim, type);
    if (!c || !t.build(type, c.x, c.y)) break;
  }
  // Save up while a slot is free; otherwise upgrade the cheapest next level, alternating
  // specialisations.
  for (let guard = 0; guard < 30 && t.count >= t.slots; guard++) {
    const list = [...t.all()].filter((x) => x.level < sim.config.TOWER_RULES.maxLevel);
    if (!list.length) break;
    const next = list.sort((a, b) => t.upgradeCost(a.id) - t.upgradeCost(b.id))[0];
    if (!sim.economy.canAfford(t.upgradeCost(next.id))) break;
    if (!t.upgrade(next.id, next.id % 2 ? 'a' : 'b')) break;
  }
  if (sim.house.hp < sim.house.maxHp * 0.6) sim.house.repair();
  // Runner picks: highest rarity first.
  const r = sim.runner;
  while (r.pendingPicks) {
    const offer = r.currentOffer();
    let bi = 0;
    offer.forEach((id, i) => { if (RARITY_RANK[CFG.RUNNER_PERKS[id].rarity] > RARITY_RANK[CFG.RUNNER_PERKS[offer[bi]].rarity]) bi = i; });
    if (!r.choose(bi)) break;
  }
}

function play(strategy, seed, mapId) {
  const sim = new Simulation({ seed, config: runCfg, mapId });
  const limit = maxMinutes * 60;
  let lastPrep = -1;
  let castTimer = 0;
  while (!sim.over && sim.time < limit) {
    if (strategy !== 'none' && sim.waves.phase === PHASE.PREP && sim.waves.wave !== lastPrep) {
      lastPrep = sim.waves.wave;
      act(sim, strategy);
      sim.waves.startNext();
    }
    if (strategy !== 'none' && strategy !== 'lazy') {
      castTimer -= DT;
      if (castTimer <= 0) {
        castTimer = 0.5;
        for (const id of Object.keys(sim.runner.spells)) if (sim.runner.canCast(id) && sim.runner.wantsCast(id)) sim.runner.cast(id);
      }
    }
    // Mid-wave building when gold piles up (a player would too).
    if (strategy !== 'none' && sim.waves.phase === PHASE.ACTIVE && Math.floor(sim.time / DT) % 300 === 0) act(sim, strategy);
    sim.step(DT);
  }
  return { ...sim.summary(), capped: !sim.over, perks: Object.keys(sim.runner.perks).join(','), spells: Object.keys(sim.runner.spells).join(','), towers: [...sim.towers.all()].map((x) => `${x.type}${x.level}${x.spec ?? ''}`).join(' ') };
}

const strategies = which === 'all' ? ['none', 'arrow', 'fire', 'frost', 'boulder', 'gale', 'roller', 'mixed', 'lazy'] : which.split(',');
const maps = mapArg === 'all' ? CFG.MAPS.map((m) => m.id) : mapArg.split(',');
for (const mapId of maps) {
  for (const s of strategies) {
    const res = [];
    for (let i = 0; i < runs; i++) res.push(play(s, 1000 + i * 7919, mapId));
    const waves = res.map((r) => r.wave + (r.capped ? '+' : ''));
    const avg = res.reduce((a, r) => a + r.wave, 0) / res.length;
    console.log(`${mapId.padEnd(10)} ${s.padEnd(8)} avg ${avg.toFixed(1).padStart(5)}  waves [${waves.join(', ')}]`);
    if (process.env.RUNNER) for (const r of res) console.log(`   lvl ${r.runnerLevel} refills ${r.refills} bonks ${r.bonks} towers ${r.towers}`);
    if (process.env.PICKS) for (const r of res) console.log(`   perks ${r.perks} | spells ${r.spells}`);
  }
}
