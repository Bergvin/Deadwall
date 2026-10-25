// Full-screen overlays: main menu, game over, pause badge.
const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Screens {
  /**
   * @param {HTMLElement} root
   * @param {{onNewGame: () => void, onMenu: () => void, onResume: () => void,
   *          getSettings: () => object, setSetting: (key: string, value: any) => void}} handlers
   */
  constructor(root, handlers) {
    this.handlers = handlers;
    this.menu = h('div', 'screen');
    this.over = h('div', 'screen');
    this.pause = h('div', 'pausepanel');
    this.menu.hidden = this.over.hidden = this.pause.hidden = true;
    root.append(this.menu, this.over, this.pause);
  }

  /** Volume, mute, shadows and path-preview controls bound to the persistent settings. */
  #settingsBlock() {
    const s = this.handlers.getSettings();
    const box = h('div', 'settings');
    const vol = h('label', 'setting', '<span>Volume</span>');
    const slider = h('input');
    Object.assign(slider, { type: 'range', min: 0, max: 100, value: Math.round(s.volume * 100) });
    slider.addEventListener('input', () => this.handlers.setSetting('volume', slider.value / 100));
    vol.append(slider);
    box.append(vol);
    for (const [key, label] of [['muted', 'Mute sound'], ['shadows', 'Shadows'], ['showPath', 'Show zombie route (P)']]) {
      const row = h('label', 'setting check');
      const cb = h('input');
      cb.type = 'checkbox';
      cb.checked = !!s[key];
      cb.addEventListener('change', () => this.handlers.setSetting(key, cb.checked));
      row.append(cb, h('span', '', label));
      box.append(row);
    }
    return box;
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
    box.append(this.#settingsBlock());
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

  /** Compact pause menu: the battlefield stays visible and usable for planning. */
  setPaused(p) {
    this.pause.hidden = !p;
    if (!p) return;
    this.pause.innerHTML = '<div class="ptitle">Paused</div>';
    const row = h('div', 'pbtns');
    const resume = h('button', 'btn primary', 'Resume <span class="k">Space</span>');
    resume.addEventListener('click', () => this.handlers.onResume());
    const restart = h('button', 'btn', 'Restart run');
    restart.addEventListener('click', () => {
      // Confirm so a run is never thrown away by one stray click.
      if (restart.dataset.armed) { this.handlers.onNewGame(); return; }
      restart.dataset.armed = '1';
      restart.textContent = 'Click again to restart';
    });
    const menu = h('button', 'btn', 'Main menu');
    menu.addEventListener('click', () => {
      if (menu.dataset.armed) { this.handlers.onMenu(); return; }
      menu.dataset.armed = '1';
      menu.textContent = 'Click again: abandon run';
    });
    row.append(resume, restart, menu);
    this.pause.append(row, this.#settingsBlock());
  }
}
