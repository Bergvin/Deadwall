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
//   GRANT=perk,perk  the runner starts with these perks (spells: learnX perks)
//   GRANTS=all  experiment: one set of runs per runner perk, each granted at the start,
//              against runs without; prints the average wave and the difference per perk
//   With STATS the tower table shows per type and specialisation: towers built per run, final
//   level, damage per run, damage per 100 gold invested, kills, share of the wave time out of
//   ammo and share being upgraded; then spell casts and runner work per run.
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
function play({ bot: botName, seed, map, maxMinutes, commander, params, grant }) {
  const sim = new Simulation({ seed, config: commanderConfig(commander), mapId: map });
  const bot = createBot(botName, params);
  for (const id of grant ?? []) sim.runner.grant(id);
  // Every tower that stood: what it cost, what it did, how long it sat idle.
  const records = new Map();
  const rec = (t) => {
    let r = records.get(t.id);
    if (!r) { r = { type: t.type, damage: 0, kills: 0, empty: 0, building: 0, active: 0 }; records.set(t.id, r); }
    r.spec = t.spec ? `${t.type}:${sim.config.TOWERS[t.type].specs[t.spec].name}` : null;
    r.level = t.level;
    r.invested = t.invested;
    return r;
  };
  sim.events.on('towerBuilt', (t) => rec(t));
  sim.events.on('towerRemoved', ({ tower }) => rec(tower));
  const casts = {};
  sim.events.on('spellCast', ({ id }) => { casts[id] = (casts[id] ?? 0) + 1; });
  const damage = {}, kills = {}, leaks = {};
  const towerKey = (id) => {
    const t = sim.towers.get(id);
    return t ? { type: t.type, spec: t.spec ? `${t.type}:${sim.config.TOWERS[t.type].specs[t.spec].name}` : null } : null;
  };
  sim.events.on('zombieDamaged', ({ amount, sourceId }) => {
    const t = sim.towers.get(sourceId);
    if (t) rec(t).damage += amount;
    const k = towerKey(sourceId);
    const key = k ? k.type : 'other';
    damage[key] = (damage[key] ?? 0) + amount;
    if (k?.spec) damage[k.spec] = (damage[k.spec] ?? 0) + amount;
  });
  sim.events.on('zombieKilled', ({ killerId }) => {
    const t = sim.towers.get(killerId);
    if (t) rec(t).kills++;
    const k = towerKey(killerId);
    const key = k ? k.type : 'other';
    kills[key] = (kills[key] ?? 0) + 1;
  });
  sim.events.on('zombieLeaked', ({ zombie, damage: d }) => { leaks[zombie.type] = (leaks[zombie.type] ?? 0) + d; });
  const limit = maxMinutes * 60;
  let tick = 0;
  while (!sim.over && sim.time < limit) {
    bot.step(sim, DT);
    sim.step(DT);
    // Idle time during waves, sampled every half second.
    if (++tick % 15 === 0 && sim.waves.phase === 'active') {
      for (const t of sim.towers.all()) {
        const r = rec(t);
        r.active += 0.5;
        if (t.ammo < 1) r.empty += 0.5;
        if (sim.towers.isBuilding(t)) r.building += 0.5;
      }
    }
  }
  for (const t of sim.towers.all()) rec(t);
  const rs = sim.runner.stats;
  return {
    bot: botName, map, seed, params, grant,
    towerRecords: [...records.values()], casts,
    runnerWork: { refills: rs.refills, bonks: rs.bonks, cratesLost: rs.cratesLost, upgradesBuilt: rs.upgradesBuilt ?? 0, level: sim.runner.level }, ...sim.summary(), capped: !sim.over, damage, kills, leaks,
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
  const sweepBots = process.env.SWEEP || process.env.GRANTS ? [bots[0]] : bots;
  // Perk experiment: a baseline without a grant plus one set of runs per perk.
  const grants = process.env.GRANTS ? [[], ...Object.keys(CFG.RUNNER_PERKS).map((id) => [id])]
    : [process.env.GRANT ? process.env.GRANT.split(',') : []];
  for (const g of grants) {
    for (const p of combos) for (const map of maps) for (const bot of sweepBots) for (let i = 0; i < runs; i++) {
      jobs.push({ bot, map, seed: Number(process.env.SEED0 ?? 1000) + i * 7919, maxMinutes, commander, params: p, grant: g });
    }
  }

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
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0; };
  if (process.env.GRANTS) {
    const base = avg(results.filter((r) => !r.grant.length).map((r) => r.wave));
    const rows = grants.slice(1).map((g) => {
      const res = results.filter((r) => r.grant[0] === g[0]);
      const def = CFG.RUNNER_PERKS[g[0]];
      return { id: g[0], name: def.name, rarity: def.rarity, wave: avg(res.map((r) => r.wave)), med: median(res.map((r) => r.wave)) };
    }).sort((a, b) => b.wave - a.wave);
    console.log(`baseline (no perk at start): ${base.toFixed(2)}`);
    console.log(`${'perk'.padEnd(34)}${'rarity'.padEnd(11)}${'avg'.padStart(6)}${'diff'.padStart(7)}${'median'.padStart(8)}`);
    for (const r of rows) {
      const d = r.wave - base;
      console.log(`${`${r.name} (${r.id})`.padEnd(34)}${r.rarity.padEnd(11)}${r.wave.toFixed(2).padStart(6)}${`${d >= 0 ? '+' : ''}${d.toFixed(2)}`.padStart(7)}${r.med.toFixed(1).padStart(8)}`);
    }
    if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ maxMinutes, commander, base, rows }, null, 1));
    process.exit(0);
  }
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
      // Towers: per type and per specialisation.
      const table = (keyOf, label) => {
        const g = {};
        for (const r of res) for (const t of r.towerRecords) {
          const k = keyOf(t);
          if (!k) continue;
          const a = (g[k] ??= { n: 0, level: 0, damage: 0, gold: 0, kills: 0, empty: 0, building: 0, active: 0 });
          a.n++; a.level += t.level; a.damage += t.damage; a.gold += t.invested; a.kills += t.kills;
          a.empty += t.empty; a.building += t.building; a.active += t.active;
        }
        console.log(`  ${label.padEnd(24)}${'per run'.padStart(8)}${'level'.padStart(7)}${'dmg/run'.padStart(9)}${'dmg/100g'.padStart(10)}${'kills'.padStart(7)}${'empty'.padStart(7)}${'build'.padStart(7)}`);
        for (const [k, a] of Object.entries(g).sort((x, y) => y[1].damage - x[1].damage)) {
          const pct = (x) => `${Math.round((x / Math.max(1, a.active)) * 100)}%`;
          console.log(`  ${k.padEnd(24)}${(a.n / res.length).toFixed(2).padStart(8)}${(a.level / a.n).toFixed(1).padStart(7)}${String(Math.round(a.damage / res.length)).padStart(9)}${String(Math.round((a.damage / Math.max(1, a.gold)) * 100)).padStart(10)}${(a.kills / res.length).toFixed(1).padStart(7)}${pct(a.empty).padStart(7)}${pct(a.building).padStart(7)}`);
        }
      };
      table((t) => t.type, 'tower');
      table((t) => t.spec, 'specialisation');
      const casts = sum('casts');
      console.log(`  spell casts per run: ${Object.entries(casts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / res.length).toFixed(1)}`).join(', ')}`);
      const work = sum('runnerWork');
      console.log(`  runner per run: level ${(work.level / res.length).toFixed(1)}, refills ${(work.refills / res.length).toFixed(0)}, upgrades built ${(work.upgradesBuilt / res.length).toFixed(1)}, bonks ${(work.bonks / res.length).toFixed(1)}, crates lost ${(work.cratesLost / res.length).toFixed(1)}`);
      console.log(`  perks (share of runs in the better half): ${perks.map(([k, v]) => `${k} ${Math.round((v.top / v.n) * 100)}% of ${v.n}`).join(', ')}`);
    }
  }
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ maxMinutes, commander, results }, null, 1));
}
