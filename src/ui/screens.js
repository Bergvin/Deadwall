// Full-screen overlays: main menu, game over, commander, pause badge.
import { commanderSummary, renderCommander, artifactOfferCards, pickedText } from './commanderScreen.js';
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
   * @param {{onNewGame: () => void, onMenu: () => void, onResume: () => void, onCommander: () => void,
   *          getSettings: () => object, setSetting: (key: string, value: any) => void}} handlers
   */
  constructor(root, handlers) {
    this.handlers = handlers;
    this.menu = h('div', 'screen');
    this.over = h('div', 'screen');
    this.pause = h('div', 'pausepanel');
    this.cmd = h('div', 'screen cmdscreen');
    this.menu.hidden = this.over.hidden = this.pause.hidden = this.cmd.hidden = true;
    root.append(this.menu, this.over, this.cmd, this.pause);
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
    for (const [key, label] of [['muted', 'Mute sound'], ['shadows', 'Shadows']]) {
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
      '<h1>DEAD<span>WALL</span></h1><div class="tagline">Guard the house. Keep the towers firing. Survive the horde.</div>');
    const start = h('button', 'btn big primary', 'New Game');
    start.addEventListener('click', () => this.handlers.onNewGame());
    box.append(start);
    box.append(this.#commanderButton(save.commander));
    const classic = h('button', 'btn big classicbtn', 'DW Classic');
    classic.title = 'The original DeadWall: walls, a champion hero and elemental towers on the walls';
    classic.addEventListener('click', () => this.handlers.onClassic());
    box.append(classic);
    box.append(h('div', 'records',
      `<span>Best wave</span><b>${save.bestWave || '—'}</b>`
      + `<span>High score</span><b>${save.highScore || '—'}</b>`
      + `<span>Zombies slain</span><b>${save.totalKills}</b>`
      + `<span>Runs</span><b>${save.runs}</b>`));
    box.append(this.#settingsBlock());
    box.append(h('div', 'controlsHelp',
      'Few towers, every one counts · Upgrade them, pick a specialisation at level 5<br>'
      + 'Your runner carries the ammo · His spells boost the towers around him · Protect the house'));
    this.menu.append(box);
    start.focus();
  }

  hideMenu() {
    this.menu.hidden = true;
  }

  /**
   * Map choice. Maps unlock in order (reach their wave on the previous map).
   * @param {object[]} maps MAPS config @param {object} save @param {(m) => boolean} unlocked
   */
  showMapSelect(maps, save, unlocked) {
    this.over.hidden = true;
    this.cmd.hidden = true;
    this.menu.hidden = false;
    this.menu.innerHTML = '';
    const box = h('div', 'box wide', '<h2>Choose a battlefield</h2><div class="tagline">Every map is its own puzzle. Reach wave 10 to open the next one.</div>');
    const grid = h('div', 'maps');
    maps.forEach((m, i) => {
      const open = unlocked(m);
      const rec = save.maps?.[m.id];
      const mods = [];
      if (m.mods?.enemyHpMult > 1) mods.push(`enemies +${Math.round((m.mods.enemyHpMult - 1) * 100)}% health`);
      if (m.mods?.enemySpeedMult > 1) mods.push(`enemies +${Math.round((m.mods.enemySpeedMult - 1) * 100)}% speed`);
      if (m.roads.length > 1) mods.push(`${m.roads.length} roads`);
      const card = h('button', `mapcard${open ? '' : ' locked'}`,
        `<div class="mnum">${i + 1}</div><div class="mname">${m.name}</div>`
        + '<canvas class="mthumb" width="150" height="120"></canvas>'
        + `<div class="mdesc">${m.description}</div>`
        + (mods.length ? `<div class="mmods">${mods.join(' · ')}</div>` : '')
        + (open
          ? `<div class="mbest">${rec?.bestWave ? `Best wave <b>${rec.bestWave}</b>` : 'Not played yet'}</div>`
          : `<div class="mlock">🔒 Reach wave ${m.unlock.wave} on ${maps.find((x) => x.id === m.unlock.map)?.name}</div>`));
      drawThumb(card.querySelector('canvas'), m);
      card.disabled = !open;
      if (open) card.addEventListener('click', () => this.handlers.onPlayMap(m.id));
      grid.append(card);
    });
    const back = h('button', 'btn big', 'Back');
    back.addEventListener('click', () => this.handlers.onMenu());
    box.append(grid, back);
    this.menu.append(box);
  }

  /** Commander summary plus a button that opens the commander screen. */
  #commanderButton(cmd) {
    const wrap = h('div', 'cmdwrap');
    wrap.append(commanderSummary(cmd));
    const b = h('button', `btn big${cmd.pendingPicks ? ' glow' : ''}`, cmd.pendingPicks ? 'Choose upgrades' : 'Commander');
    b.addEventListener('click', () => this.handlers.onCommander());
    wrap.append(b);
    return wrap;
  }

  /** @param {object} cmd commander record @param {object} on see renderCommander */
  showCommander(cmd, on, ui = {}) {
    this.menu.hidden = true;
    this.over.hidden = true;
    this.cmd.hidden = false;
    renderCommander(this.cmd, cmd, on, ui);
  }

  hideCommander() {
    this.cmd.hidden = true;
  }

  /**
   * @param {object} summary Simulation.summary()
   * @param {{newBestWave:boolean, newHighScore:boolean}} rec
   * @param {{xp:number, levels:number, picked?:object}} [progress] commander XP from this run and
   *   the result of the artifact choice once made
   */
  showGameOver(summary, save, rec, progress = { xp: 0, levels: 0 }) {
    this.cmd.hidden = true;
    this.over.hidden = false;
    this.over.innerHTML = '';
    const offer = save.commander.artifactOffer?.length;
    const best = save.maps?.[summary.map]?.bestWave ?? 0;
    const box = h('div', `box${offer ? ' wide' : ''}`, '<h2>The House Has Fallen</h2><div class="tagline">The dead are inside.</div>');
    if (rec.newBestWave || rec.newHighScore) {
      box.append(h('div', 'newrec', rec.newBestWave ? 'New best wave on this map!' : 'New high score!'));
    }
    for (const id of rec.unlocked ?? []) {
      box.append(h('div', 'newrec unlock', `New battlefield unlocked: ${this.mapName?.(id) ?? id}!`));
    }
    box.append(h('div', 'records',
      `<span>Wave reached</span><b>${summary.wave}</b>`
      + `<span>Best on this map</span><b>${best}</b>`
      + `<span>Score</span><b>${summary.score}</b>`
      + `<span>Zombies slain</span><b>${summary.kills}</b>`
      + `<span>Towers built</span><b>${summary.towersBuilt}</b>`
      + `<span>Runner level</span><b>${summary.runnerLevel}</b>`
      + `<span>Crates delivered</span><b>${summary.refills}</b>`
      + `<span>Times knocked over</span><b>${summary.bonks}</b>`
      + `<span>Gold earned</span><b>${summary.goldEarned}</b>`
      + `<span>Time survived</span><b>${fmtTime(summary.time)}</b>`));
    const loot = h('div', 'runloot',
      `<div class="xpgain">+${progress.xp} commander XP${progress.levels ? ` · <b>Level up${progress.levels > 1 ? ` ×${progress.levels}` : ''}!</b>` : ''}</div>`
      + (progress.picked ? `<div class="pickedmsg">${pickedText(progress.picked)}</div>` : ''));
    box.append(loot);
    if (offer) {
      box.append(h('h3', 'offertitle', 'Choose an artifact <span class="dim">· the further you get, the better the odds</span>'));
      box.append(artifactOfferCards(save.commander, (i) => this.handlers.onChooseArtifact(i)));
    }
    box.append(this.#commanderButton(save.commander));
    const again = h('button', 'btn big primary', 'Play Again');
    again.addEventListener('click', () => this.handlers.onRetry());
    const maps = h('button', 'btn big', 'Choose Map');
    maps.addEventListener('click', () => this.handlers.onNewGame());
    const menu = h('button', 'btn big', 'Main Menu');
    menu.addEventListener('click', () => this.handlers.onMenu());
    box.append(again, maps, menu);
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
      if (restart.dataset.armed) { this.handlers.onRetry(); return; }
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

/** Small top-down sketch of a map: ground, water, rocks, roads (red dot = entrance), house. */
function drawThumb(cv, m) {
  const g = cv.getContext('2d');
  const W = 30, H = 24, sx = cv.width / W, sy = cv.height / H;
  g.fillStyle = '#2b2922';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#1e3a4e';
  for (const [x0, y0, x1, y1] of m.water ?? []) g.fillRect(x0 * sx, y0 * sy, (x1 - x0 + 1) * sx, (y1 - y0 + 1) * sy);
  g.fillStyle = '#5a5248';
  for (const [x, y] of m.blocked ?? []) g.fillRect(x * sx + 1, y * sy + 1, sx - 2, sy - 2);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const r of m.roads) {
    g.strokeStyle = '#9a7a52';
    g.lineWidth = 1.8 * sx;
    g.beginPath();
    r.points.forEach(([x, z], k) => (k ? g.lineTo(x * sx, z * sy) : g.moveTo(x * sx, z * sy)));
    g.stroke();
  }
  for (const r of m.roads) {
    const [x0, z0] = r.points[0];
    g.fillStyle = '#c0392b';
    g.beginPath();
    g.arc(Math.min(W - 0.6, Math.max(0.6, x0)) * sx, Math.min(H - 0.6, Math.max(0.6, z0)) * sy, 0.7 * sx, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#e8b64c';
  g.fillRect((m.house.x - 1) * sx, (m.house.z - 1) * sy, 2 * sx, 2 * sy);
}
