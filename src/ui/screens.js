// Full-screen overlays: main menu, game over, pause badge.
const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Screens {
  /** @param {HTMLElement} root @param {{onNewGame: () => void, onMenu: () => void}} handlers */
  constructor(root, handlers) {
    this.handlers = handlers;
    this.menu = h('div', 'screen');
    this.over = h('div', 'screen');
    this.pause = h('div', 'pausebadge', 'PAUSED');
    this.menu.hidden = this.over.hidden = this.pause.hidden = true;
    root.append(this.menu, this.over, this.pause);
  }

  showMenu(save) {
    this.over.hidden = true;
    this.menu.hidden = false;
    this.menu.innerHTML = '';
    const box = h('div', 'box',
      '<h1>DEAD<span>WALL</span></h1><div class="tagline">Build the walls. Hold the gate. Survive the horde.</div>');
    const start = h('button', 'btn big primary', 'New Game');
    start.addEventListener('click', () => this.handlers.onNewGame());
    box.append(start);
    box.append(h('div', 'records',
      `<span>Best wave</span><b>${save.bestWave || '—'}</b>`
      + `<span>High score</span><b>${save.highScore || '—'}</b>`
      + `<span>Zombies slain</span><b>${save.totalKills}</b>`
      + `<span>Runs</span><b>${save.runs}</b>`));
    box.append(h('div', 'controlsHelp',
      'Build walls to steer the horde · Recruit heroes and station them on walls<br>'
      + 'Zombies smash walls in their way · If the gate falls, the run is over'));
    this.menu.append(box);
    start.focus();
  }

  hideMenu() {
    this.menu.hidden = true;
  }

  /** @param {object} summary Simulation.summary() @param {{newBestWave:boolean, newHighScore:boolean}} rec */
  showGameOver(summary, save, rec) {
    this.over.hidden = false;
    this.over.innerHTML = '';
    const box = h('div', 'box', '<h2>The Gate Has Fallen</h2><div class="tagline">The dead pour into the fortress.</div>');
    if (rec.newBestWave || rec.newHighScore) {
      box.append(h('div', 'newrec', rec.newHighScore ? 'New high score!' : 'New best wave!'));
    }
    box.append(h('div', 'records',
      `<span>Wave reached</span><b>${summary.wave}</b>`
      + `<span>Score</span><b>${summary.score}</b>`
      + `<span>Zombies slain</span><b>${summary.kills}</b>`
      + `<span>Waves cleared</span><b>${summary.wavesCleared}</b>`
      + `<span>Walls built / lost</span><b>${summary.wallsBuilt} / ${summary.wallsLost}</b>`
      + `<span>Heroes recruited</span><b>${summary.heroes}</b>`
      + `<span>Gold earned</span><b>${summary.goldEarned}</b>`
      + `<span>Time survived</span><b>${fmtTime(summary.time)}</b>`
      + `<span>Best wave</span><b>${save.bestWave}</b>`
      + `<span>High score</span><b>${save.highScore}</b>`));
    const again = h('button', 'btn big primary', 'Play Again');
    again.addEventListener('click', () => this.handlers.onNewGame());
    const menu = h('button', 'btn big', 'Main Menu');
    menu.addEventListener('click', () => this.handlers.onMenu());
    box.append(again, menu);
    this.over.append(box);
  }

  hideGameOver() {
    this.over.hidden = true;
  }

  setPaused(p) {
    this.pause.hidden = !p;
  }
}
