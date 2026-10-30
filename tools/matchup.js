// Matchup lab: how good is each tower against each kind of enemy? For every tower type and
// specialisation it builds one tower at `level` beside a straight stretch of The Old Road,
// sends a stream of one enemy type past it (fixed HP multiplier, no runner help needed: free
// ammo) and measures the share of the stream's total HP it destroyed. 100% = it killed
// everything; 0% = it could not touch them (immune, or stealth it cannot see).
// Usage: node tools/matchup.js [level=5] [count=12] [hpMult=3]
import { Simulation } from '../src/core/simulation.js';
import * as CFG from '../src/config/game.js';
import { runConfig, commanderDefaults } from '../src/core/commander.js';
import { pointAt } from '../src/core/paths.js';

const level = Number(process.argv[2] ?? 5);
const count = Number(process.argv[3] ?? 12);
const hpMult = Number(process.argv[4] ?? 3);
const enemies = Object.keys(CFG.ZOMBIES).filter((k) => !CFG.ZOMBIES[k].boss);
const DT = 1 / 30;

/** Free cell nearest a point on road 0 at distance s (the same spot for every tower). */
function spot(sim, s) {
  const p = pointAt(sim.paths[0], s);
  let best = null, bd = Infinity;
  for (let y = 0; y < sim.grid.height; y++) {
    for (let x = 0; x < sim.grid.width; x++) {
      if (!sim.grid.isBuildable(x, y)) continue;
      const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.z);
      if (d < bd) { bd = d; best = { x, y }; }
    }
  }
  return best;
}

function trial(type, spec, enemy) {
  const sim = new Simulation({ seed: 77, config: runConfig(CFG, commanderDefaults()), mapId: 'oldroad' });
  sim.economy.earn(1e9);
  sim.house.hp = sim.house.maxHp = 1e9;
  const c = spot(sim, 14);
  const t = sim.towers.build(type, c.x, c.y);
  for (let l = 1; l < level; l++) { sim.towers.upgrade(t.id, spec); sim.towers.finishUpgrade(t.id); }
  sim.towers.extra = () => ({ freeAmmo: true });
  let total = 0, dealt = 0;
  sim.events.on('zombieDamaged', ({ amount, sourceId }) => { if (sourceId === t.id) dealt += amount; });
  let spawned = 0, timer = 0;
  for (let step = 0; step < 240 / DT; step++) {
    timer -= DT;
    if (spawned < count && timer <= 0) {
      const z = sim.zombies.spawn(enemy, 0, hpMult);
      total += z.maxHp;
      spawned++;
      timer = 1.2;
    }
    sim.zombies.step(DT);
    sim.towers.step(DT);
    sim.projectiles.step(DT);
    sim.zones.step(DT);
    if (spawned >= count && !sim.zombies.list.some((z) => z.alive)) break;
  }
  return dealt / total;
}

const rows = [];
for (const [type, def] of Object.entries(CFG.TOWERS)) {
  const specs = level >= CFG.TOWER_RULES.specLevel ? Object.keys(def.specs) : [null];
  for (const spec of specs) {
    const r = { name: spec ? `${def.name.replace(' Tower', '')}: ${def.specs[spec].name}` : def.name, vals: {} };
    for (const e of enemies) r.vals[e] = trial(type, spec, e);
    rows.push(r);
  }
}
console.log(`Share of the stream's HP destroyed (level ${level}, ${count} enemies at x${hpMult} HP, free ammo)`);
console.log(`${'tower'.padEnd(28)}${enemies.map((e) => e.slice(0, 8).padStart(9)).join('')}`);
for (const r of rows) console.log(`${r.name.padEnd(28)}${enemies.map((e) => `${Math.round(r.vals[e] * 100)}%`.padStart(9)).join('')}`);
