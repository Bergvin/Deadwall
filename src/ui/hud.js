// HTML HUD over the canvas: top bar, build panel, selected-wall panel, toasts, help.
import './hud.css';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {{walls: import('../core/walls.js').WallSystem, economy: import('../core/economy.js').Economy,
   *          events: import('../core/events.js').Emitter, wallTypes: object}} deps
   */
  constructor(root, { walls, economy, events, wallTypes }) {
    this.walls = walls;
    this.economy = economy;
    this.wallTypes = wallTypes;
    this.handlers = { build: () => {}, sell: () => {} };
    this.shownWall = null;

    this.el = h('div', 'hud');
    root.appendChild(this.el);

    // Top bar
    const top = h('div', 'topbar');
    top.append(h('div', 'logo', 'DEAD<span>WALL</span>'));
    this.goldStat = h('div', 'stat gold', '<span class="label">Gold</span><span class="value"></span>');
    this.wallStat = h('div', 'stat', '<span class="label">Walls</span><span class="value"></span>');
    this.modeEl = h('div', 'mode');
    top.append(this.goldStat, this.wallStat, this.modeEl);
    this.el.append(top);

    // Build panel with tabs (heroes/upgrades arrive in later phases)
    const bar = h('div', 'buildbar');
    const tabs = h('div', 'tabs');
    tabs.append(h('button', 'tab active', 'Walls'));
    for (const name of ['Heroes', 'Upgrades']) {
      const t = h('button', 'tab', name);
      t.disabled = true;
      t.title = 'Coming in a later phase';
      tabs.append(t);
    }
    this.cards = h('div', 'cards');
    this.cardEls = {};
    Object.entries(wallTypes).forEach(([key, t], i) => {
      const c = h('button', 'card',
        `<span class="key">${i === 0 ? 'B' : i + 1}</span><div class="name">${t.name}</div>`
        + `<div class="cost">${t.cost} gold</div><div class="meta">${t.maxHp} HP · ${t.heroCapacity} hero</div>`);
      c.title = t.description;
      c.addEventListener('click', () => this.handlers.build(key));
      this.cards.append(c);
      this.cardEls[key] = c;
    });
    bar.append(tabs, this.cards);
    this.el.append(bar);

    // Selected wall panel
    this.panel = h('div', 'panel');
    this.panel.hidden = true;
    this.el.append(this.panel);

    // Help + toasts
    this.el.append(h('div', 'help',
      '<kbd>B</kbd> build wall &nbsp; <kbd>LMB</kbd> place / select &nbsp; drag to paint<br>'
      + '<kbd>RMB</kbd> cancel &nbsp; <kbd>RMB</kbd> drag / <kbd>WASD</kbd> pan &nbsp; <kbd>Wheel</kbd> zoom<br>'
      + '<kbd>Del</kbd> sell selected &nbsp; <kbd>Esc</kbd> cancel'));
    this.toasts = h('div', 'toasts');
    this.el.append(this.toasts);

    events.on('goldChanged', () => this.#refresh(true));
    events.on('wallAdded', () => this.#refresh());
    events.on('wallRemoved', () => this.#refresh());
    this.setMode({ kind: 'select' });
    this.#refresh();
  }

  onBuild(fn) { this.handlers.build = fn; }
  onSell(fn) { this.handlers.sell = fn; }

  setMode(mode) {
    for (const [key, el] of Object.entries(this.cardEls)) {
      el.classList.toggle('active', mode.kind === 'build' && mode.wallType === key);
    }
    this.modeEl.innerHTML = mode.kind === 'build'
      ? `Building <b>${this.wallTypes[mode.wallType].name}</b> — click or drag to place, right-click to stop`
      : 'Select a wall to inspect it';
  }

  showWall(wall) {
    this.shownWall = wall;
    this.panel.hidden = !wall;
    if (!wall) return;
    const t = this.wallTypes[wall.type];
    const pct = Math.round((wall.hp / wall.maxHp) * 100);
    this.panel.innerHTML =
      `<h3>${t.name}</h3>`
      + `<div class="row"><span>Health</span><b>${Math.ceil(wall.hp)} / ${wall.maxHp}</b></div>`
      + `<div class="bar"><div style="width:${pct}%"></div></div>`
      + `<div class="row"><span>Level</span><b>${wall.level}</b></div>`
      + `<div class="row"><span>Hero slots</span><b>${wall.heroes.length} / ${wall.heroCapacity}</b></div>`
      + `<div class="row"><span>Position</span><b>${wall.x}, ${wall.y}</b></div>`;
    const sell = h('button', 'btn danger', `Sell for ${this.walls.sellValue(wall.id)} gold <span style="opacity:.6">(Del)</span>`);
    sell.addEventListener('click', () => this.handlers.sell(wall.id));
    this.panel.append(sell);
  }

  toast(text) {
    const t = h('div', 'toast', text);
    this.toasts.append(t);
    setTimeout(() => t.remove(), 2000);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
  }

  #refresh(goldChanged = false) {
    const gold = this.economy.gold;
    this.goldStat.querySelector('.value').textContent = gold;
    if (goldChanged) {
      this.goldStat.classList.remove('flash');
      void this.goldStat.offsetWidth; // restart the animation
      this.goldStat.classList.add('flash');
    }
    this.wallStat.querySelector('.value').textContent = this.walls.count;
    for (const [key, el] of Object.entries(this.cardEls)) {
      el.classList.toggle('unaffordable', gold < this.wallTypes[key].cost);
    }
    if (this.shownWall) this.showWall(this.walls.get(this.shownWall.id));
  }
}
