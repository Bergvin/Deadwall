// Follows one bot run wave by wave: house health, gold, slots, towers (* = upgrade being
// built) and what leaked into the house so far. For understanding what a bot does.
// Usage: node tools/trace.js [map=oldroad] [bot=smart] [seed=1000]
import { Simulation } from '../src/core/simulation.js';
import { createBot } from './bot.js';
import * as CFG from '../src/config/game.js';
import { runConfig, commanderDefaults } from '../src/core/commander.js';

const [map = 'oldroad', botName = 'smart', seed = '1000'] = process.argv.slice(2);
const sim = new Simulation({ seed: Number(seed), config: runConfig(CFG, commanderDefaults()), mapId: map });
const bot = createBot(botName);
const leak = {};
sim.events.on('zombieLeaked', ({ zombie, damage }) => { leak[zombie.type] = Math.round((leak[zombie.type] ?? 0) + damage); });
let wave = 0;
while (!sim.over && sim.time < 3600) {
  bot.step(sim, 1 / 30);
  sim.step(1 / 30);
  if (sim.waves.wave !== wave) {
    wave = sim.waves.wave;
    const towers = [...sim.towers.all()].map((t) => `${t.type}${t.level}${t.pending ? '*' : ''}`).join(' ');
    console.log(`wave ${wave} t=${sim.time.toFixed(0)}s house ${sim.house.hp.toFixed(0)} gold ${sim.economy.gold} slots ${sim.towers.count}/${sim.towers.slots} | ${towers} | leaks ${JSON.stringify(leak)}`);
  }
}
console.log(`reached wave ${sim.summary().wave}`);
