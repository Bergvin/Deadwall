// Balance check: bots play headless runs and report how far they get, in parallel on all cores.
// Usage: node tools/simulate.js [runs=6] [bot,bot|all] [maxMinutes=60] [map,map|all]
//   bots: see BOT_PROFILES in tools/bot.js (none, basic, lazy, smart, wide, tall,
//         smart-noorders, smart-nospells, arrow, fire, frost, boulder, gale, roller).
//         "all" = none, basic, smart, wide, tall, smart-noorders, smart-nospells.
// Env:
//   COMMANDER=fresh|mid|strong  plays with a commander profile (perks, skills, artifacts)
//   STATS=1    also prints what worked: damage share per tower type and specialisation,
//              which enemies leaked into the house, perks in the better half of the runs
//   RUNNER=1   prints the runner's level, refills and bonks per run; PICKS=1 his perks
//   OUT=file   writes every run's result as JSON (e.g. reports/sim-results.json)
//   JOBS=n     worker threads (default: cores - 1)
//   PARAMS='{"aoeWeight":0.5}'  overrides bot profile fields (tuning)
//   SWEEP='{"aoeWeight":[0.3,0.6],"slowWeight":[0.2,0.4]}'  plays every combination with the
//              first bot and prints the average wave per combination (best first)
// Runs use seeds SEED0 + i * 7919 (SEED0 defaults to 1000), so every bot plays the same waves;
// tune on the default seeds and check the result on others (e.g. SEED0=5000).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Simulation } from '../src/core/simulation.js';
import * as CFG from '../src/config/game.js';
import { commanderDefaults, addArtifact, runConfig } from '../src/core/commander.js';
import { createBot, BOT_PROFILES } from './bot.js';

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
  if (!name) return runConfig(CFG, commanderDefaults());
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

const DT = 1 / 30;

/** One run: a bot on a map with a seed. Returns the summary plus what happened. */
function play({ bot: botName, seed, map, maxMinutes, commander, params }) {
  const sim = new Simulation({ seed, config: commanderConfig(commander), mapId: map });
  const bot = createBot(botName, params);
  const damage = {}, kills = {}, leaks = {};
  const towerKey = (id) => {
    const t = sim.towers.get(id);
    return t ? { type: t.type, spec: t.spec ? `${t.type}:${sim.config.TOWERS[t.type].specs[t.spec].name}` : null } : null;
  };
  sim.events.on('zombieDamaged', ({ amount, sourceId }) => {
    const k = towerKey(sourceId);
    const key = k ? k.type : 'other';
    damage[key] = (damage[key] ?? 0) + amount;
    if (k?.spec) damage[k.spec] = (damage[k.spec] ?? 0) + amount;
  });
  sim.events.on('zombieKilled', ({ killerId }) => {
    const k = towerKey(killerId);
    const key = k ? k.type : 'other';
    kills[key] = (kills[key] ?? 0) + 1;
  });
  sim.events.on('zombieLeaked', ({ zombie, damage: d }) => { leaks[zombie.type] = (leaks[zombie.type] ?? 0) + d; });
  const limit = maxMinutes * 60;
  while (!sim.over && sim.time < limit) {
    bot.step(sim, DT);
    sim.step(DT);
  }
  return {
    bot: botName, map, seed, params, ...sim.summary(), capped: !sim.over, damage, kills, leaks,
    perks: Object.entries(sim.runner.perks).map(([id, r]) => `${id}${r > 1 ? r : ''}`),
    spells: Object.keys(sim.runner.spells),
    towers: [...sim.towers.all()].map((x) => `${x.type}${x.level}${x.spec ?? ''}`),
  };
}

if (!isMainThread) {
  parentPort.on('message', (job) => parentPort.postMessage(job ? play(job) : null));
} else {
  const runs = Number(process.argv[2] ?? 6);
  const botArg = process.argv[3] ?? 'all';
  const maxMinutes = Number(process.argv[4] ?? 60);
  const mapArg = process.argv[5] ?? 'oldroad';
  const bots = botArg === 'all' ? ['none', 'basic', 'smart', 'wide', 'tall', 'smart-noorders', 'smart-nospells'] : botArg.split(',');
  for (const b of bots) if (!BOT_PROFILES[b]) throw new Error(`unknown bot ${b}; known: ${Object.keys(BOT_PROFILES).join(', ')}`);
  const maps = mapArg === 'all' ? CFG.MAPS.map((m) => m.id) : mapArg.split(',');
  const commander = process.env.COMMANDER ?? null;
  const jobs = [];
  const params = process.env.PARAMS ? JSON.parse(process.env.PARAMS) : null;
  // A sweep: every combination of the listed values.
  let combos = [params];
  if (process.env.SWEEP) {
    combos = [{ ...params }];
    for (const [k, values] of Object.entries(JSON.parse(process.env.SWEEP))) {
      combos = combos.flatMap((c) => values.map((v) => ({ ...c, [k]: v })));
    }
  }
  const sweepBots = process.env.SWEEP ? [bots[0]] : bots;
  for (const p of combos) for (const map of maps) for (const bot of sweepBots) for (let i = 0; i < runs; i++) jobs.push({ bot, map, seed: Number(process.env.SEED0 ?? 1000) + i * 7919, maxMinutes, commander, params: p });

  const threads = Math.max(1, Math.min(jobs.length, Number(process.env.JOBS ?? cpus().length - 1)));
  const results = [];
  let next = 0, done = 0;
  const started = Date.now();
  await new Promise((resolve, reject) => {
    let alive = threads;
    for (let w = 0; w < threads; w++) {
      const worker = new Worker(fileURLToPath(import.meta.url));
      const feed = () => worker.postMessage(next < jobs.length ? jobs[next++] : null);
      worker.on('message', (r) => {
        if (!r) { worker.terminate(); if (--alive === 0) resolve(); return; }
        results.push(r);
        done++;
        process.stderr.write(`\r${done}/${jobs.length} runs`);
        feed();
      });
      worker.on('error', reject);
      feed();
    }
  });
  process.stderr.write(`\r${jobs.length} runs in ${((Date.now() - started) / 1000).toFixed(0)} s on ${threads} threads\n`);

  const avg = (xs) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
  if (process.env.SWEEP) {
    const rows = combos.map((p) => {
      const res = results.filter((r) => JSON.stringify(r.params) === JSON.stringify(p));
      const perMap = maps.map((m) => avg(res.filter((r) => r.map === m).map((r) => r.wave)));
      return { p, all: avg(res.map((r) => r.wave)), perMap };
    }).sort((a, b) => b.all - a.all);
    console.log(`avg   ${maps.map((m) => m.slice(0, 9).padStart(9)).join('')}  params`);
    for (const r of rows) console.log(`${r.all.toFixed(2).padStart(5)} ${r.perMap.map((x) => x.toFixed(1).padStart(9)).join('')}  ${JSON.stringify(r.p)}`);
    process.exit(0);
  }
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0; };
  console.log(`${'map'.padEnd(10)} ${'bot'.padEnd(15)} ${'avg'.padStart(5)} ${'median'.padStart(6)}  waves`);
  for (const map of maps) {
    for (const bot of bots) {
      const res = results.filter((r) => r.map === map && r.bot === bot).sort((a, b) => a.seed - b.seed);
      const waves = res.map((r) => r.wave);
      console.log(`${map.padEnd(10)} ${bot.padEnd(15)} ${avg(waves).toFixed(1).padStart(5)} ${median(waves).toFixed(1).padStart(6)}  [${res.map((r) => r.wave + (r.capped ? '+' : '')).join(', ')}]`);
      if (process.env.RUNNER) for (const r of res) console.log(`   lvl ${r.runnerLevel} refills ${r.refills} bonks ${r.bonks} towers ${r.towers.join(' ')}`);
      if (process.env.PICKS) for (const r of res) console.log(`   perks ${r.perks.join(',')} | spells ${r.spells.join(',')}`);
    }
  }

  if (process.env.STATS) {
    for (const bot of bots.filter((b) => b !== 'none')) {
      const res = results.filter((r) => r.bot === bot);
      const sum = (field) => {
        const out = {};
        for (const r of res) for (const [k, v] of Object.entries(r[field])) out[k] = (out[k] ?? 0) + v;
        return out;
      };
      const share = (o, filter) => {
        const e = Object.entries(o).filter(([k]) => filter(k));
        const total = e.reduce((a, [, v]) => a + v, 0) || 1;
        return e.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`).join(', ');
      };
      const dmg = sum('damage');
      console.log(`\n== ${bot} (${res.length} runs)`);
      console.log(`  damage by tower:  ${share(dmg, (k) => !k.includes(':'))}`);
      console.log(`  damage by spec:   ${share(dmg, (k) => k.includes(':'))}`);
      console.log(`  kills by tower:   ${share(sum('kills'), () => true)}`);
      console.log(`  house damage by:  ${share(sum('leaks'), () => true)}`);
      // Perks that show up more often in the better half of the runs (per map).
      const better = new Set(), all = {};
      for (const map of maps) {
        const m = res.filter((r) => r.map === map).sort((a, b) => b.wave - a.wave);
        m.slice(0, Math.ceil(m.length / 2)).forEach((r) => better.add(r));
      }
      for (const r of res) for (const p of r.perks) {
        const id = p.replace(/\d+$/, '');
        all[id] ??= { top: 0, n: 0 };
        all[id].n++;
        if (better.has(r)) all[id].top++;
      }
      const perks = Object.entries(all).filter(([, v]) => v.n >= 3).sort((a, b) => b[1].top / b[1].n - a[1].top / a[1].n);
      console.log(`  perks (share of runs in the better half): ${perks.map(([k, v]) => `${k} ${Math.round((v.top / v.n) * 100)}% of ${v.n}`).join(', ')}`);
    }
  }
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ maxMinutes, commander, results }, null, 1));
}
