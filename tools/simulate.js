// Balance check: plays N runs with a simple scripted strategy and prints how far they get.
// Usage: node tools/simulate.js [runs=5] [strategy=line|none]
import { Simulation } from '../src/core/simulation.js';
import { PHASE } from '../src/core/waves.js';
import { MAP } from '../src/config/game.js';

const runs = Number(process.argv[2] ?? 5);
const strategy = process.argv[3] ?? 'line';
const DT = 1 / 30;

function play(seed) {
  const sim = new Simulation({ seed });
  const row = 17;
  let lastPrepWave = -1;
  while (!sim.over && sim.time < 3600) {
    if (strategy === 'line' && sim.waves.phase === PHASE.PREP && lastPrepWave !== sim.waves.wave) {
      lastPrepWave = sim.waves.wave;
      // Repair, extend the wall line outward from the gate, then hire and place archers.
      for (const w of sim.walls.all()) sim.walls.repair(w.id);
      for (let d = 0; d <= 14; d++) {
        for (const x of [MAP.gateX - d, MAP.gateX + d]) {
          if (sim.economy.gold < 120) break;
          if (!sim.grid.wallAt(x, row)) sim.walls.build('stone', x, row);
        }
      }
      while (sim.economy.gold >= 80) {
        const free = [...sim.walls.all()].filter((w) => w.heroes.length < w.heroCapacity)
          .sort((a, b) => Math.abs(a.x - MAP.gateX) - Math.abs(b.x - MAP.gateX))[0];
        if (!free) break;
        const h = sim.heroes.recruit('archer');
        sim.heroes.deploy(h.id, free.id);
      }
      for (const h of sim.heroes.all()) {
        if (!h.wallId) {
          const free = [...sim.walls.all()].find((w) => w.heroes.length < w.heroCapacity);
          if (free) sim.heroes.deploy(h.id, free.id);
        }
      }
      sim.waves.startNext();
    }
    sim.step(DT);
  }
  return sim.summary();
}

const results = [];
for (let i = 1; i <= runs; i++) results.push(play(i * 7919));
for (const r of results) {
  console.log(`wave ${String(r.wave).padStart(2)}  score ${String(r.score).padStart(6)}  kills ${String(r.kills).padStart(4)}  heroes ${r.heroes}  walls lost ${r.wallsLost}  ${(r.time / 60).toFixed(1)} min`);
}
console.log('avg wave', (results.reduce((a, r) => a + r.wave, 0) / runs).toFixed(1));
