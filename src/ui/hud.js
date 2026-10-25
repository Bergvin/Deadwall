// In-run HTML HUD over the canvas: top bar (wave, gold, fortress, controls), build panel
// with Walls/Heroes tabs, selection panel, toasts and banners. One Hud per run; dispose()
// removes its DOM.
import './hud.css';
import { PHASE } from '../core/waves.js';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {import('../core/simulation.js').Simulation} sim
   * @param {{build, recruit, deploy, startWave, togglePause, setSpeed, isPaused, getSpeed}} actions
   */
  constructor(root, sim, actions) {
    this.sim = sim;
    this.actions = actions;
    this.cfg = sim.config;
    this.selection = null;
    this.tab = 'walls';
    this.el = h('div', 'hud');
    root.appendChild(this.el);
    this.#buildTopbar();
    this.#buildPanel();
    this.side = h('div', 'panel');
    this.side.hidden = true;
    this.el.append(this.side);
    this.el.append(h('div', 'help',
      '<kbd>B</kbd> build wall &nbsp; <kbd>LMB</kbd> place / select &nbsp; drag for a line<br>'
      + '<kbd>RMB</kbd> cancel &nbsp; <kbd>RMB</kbd> drag / <kbd>WASD</kbd> pan &nbsp; <kbd>Wheel</kbd> zoom<br>'
      + '<kbd>R</kbd> repair &nbsp; <kbd>Del</kbd> sell &nbsp; <kbd>M</kbd> move hero &nbsp; <kbd>Space</kbd> pause &nbsp; <kbd>Enter</kbd> next wave'));
    this.toasts = h('div', 'toasts');
    this.banner = h('div', 'banner');
    this.vignette = h('div', 'vignette');
    this.el.append(this.toasts, this.banner, this.vignette);

    const ev = sim.events;
    const refresh = () => this.refresh();
    for (const t of ['goldChanged', 'wallAdded', 'wallRemoved', 'heroRecruited', 'heroDeployed',
      'heroDismissed', 'heroUnseated', 'wallRepaired']) ev.on(t, refresh);
    ev.on('wallDamaged', ({ wall }) => { if (this.#isSelected('wall', wall.id)) this.showSelection(this.selection); });
    ev.on('waveStarted', ({ wave }) => this.showBanner(`Wave ${wave}`, 'The dead are coming'));
    ev.on('waveCleared', ({ wave, bonus }) => this.showBanner(`Wave ${wave} cleared`, `+${bonus} gold`));
    ev.on('heroUnseated', ({ hero, cause }) => {
      if (cause === 'destroyed') this.toast(`${hero.name}'s wall fell. ${hero.name} retreats to the reserve.`);
    });
    ev.on('wallRemoved', ({ wall, cause }) => {
      if (cause === 'destroyed') this.toast(`Breach! Wall at ${wall.x},${wall.y} destroyed`, 'alert');
    });
    this.lastGateWarn = false;
    this.setMode({ kind: 'select' });
    this.refresh();
  }

  #isSelected(kind, id) {
    return this.selection?.kind === kind && this.selection.id === id;
  }

  #buildTopbar() {
    const top = h('div', 'topbar');
    top.append(h('div', 'logo', 'DEAD<span>WALL</span>'));
    const stat = (cls, label) => {
      const s = h('div', `stat ${cls}`, `<span class="label">${label}</span><span class="value"></span>`);
      top.append(s);
      return s.querySelector('.value');
    };
    this.vWave = stat('wave', 'Wave');
    this.vEnemies = stat('enemies', 'Enemies');
    this.vGold = stat('gold', 'Gold');
    this.goldStat = this.vGold.parentElement;
    const fort = h('div', 'stat fortress', '<span class="label">Gate</span><div class="bar wide"><div></div></div><span class="value"></span>');
    top.append(fort);
    this.vGateBar = fort.querySelector('.bar > div');
    this.vGate = fort.querySelector('.value');
    this.vBreaches = stat('breaches', 'Breaches');
    this.vHeroes = stat('heroes', 'Heroes');
    this.modeEl = h('div', 'mode');
    top.append(this.modeEl);

    const controls = h('div', 'controls');
    this.waveBtn = h('button', 'btn wavebtn');
    this.waveBtn.addEventListener('click', () => this.actions.startWave());
    this.pauseBtn = h('button', 'btn icon', '❚❚');
    this.pauseBtn.title = 'Pause (Space)';
    this.pauseBtn.addEventListener('click', () => this.actions.togglePause());
    controls.append(this.waveBtn, this.pauseBtn);
    this.speedBtns = [1, 2, 3].map((s) => {
      const b = h('button', 'btn icon speed', `${s}×`);
      b.title = `Game speed ${s}×`;
      b.addEventListener('click', () => this.actions.setSpeed(s));
      controls.append(b);
      return b;
    });
    top.append(controls);
    this.el.append(top);
  }

  #buildPanel() {
    const bar = h('div', 'buildbar');
    const tabs = h('div', 'tabs');
    this.tabBtns = {};
    for (const [key, label, enabled] of [['walls', 'Walls', true], ['heroes', 'Heroes', true], ['upgrades', 'Upgrades', false]]) {
      const t = h('button', 'tab', label);
      t.disabled = !enabled;
      if (!enabled) t.title = 'Coming in a later phase';
      t.addEventListener('click', () => { this.tab = key; this.#renderCards(); });
      tabs.append(t);
      this.tabBtns[key] = t;
    }
    this.cards = h('div', 'cards');
    this.reserve = h('div', 'reserve');
    bar.append(tabs, this.cards, this.reserve);
    this.el.append(bar);
    this.#renderCards();
  }

  #renderCards() {
    for (const [k, b] of Object.entries(this.tabBtns)) b.classList.toggle('active', k === this.tab);
    this.cards.innerHTML = '';
    this.cardEls = {};
    if (this.tab === 'walls') {
      Object.entries(this.cfg.WALLS).forEach(([key, t], i) => {
        const c = h('button', 'card',
          `<span class="key">${i === 0 ? 'B' : i + 1}</span><div class="name">${t.name}</div>`
          + `<div class="cost"></div><div class="meta">${t.maxHp} HP · ${t.heroCapacity} hero slot</div>`);
        c.title = t.description;
        c.addEventListener('click', () => this.actions.build(key));
        this.cards.append(c);
        this.cardEls[key] = { el: c, cost: () => this.sim.walls.costOf(key) };
      });
    } else {
      for (const [key, t] of Object.entries(this.cfg.HEROES)) {
        const c = h('button', 'card hero',
          `<div class="name">${t.name}</div><div class="cost"></div>`
          + `<div class="meta">${t.role}</div><div class="meta">DMG ${t.damage} · ${(1 / t.attackInterval).toFixed(1)}/s · RNG ${t.range}</div>`);
        c.title = t.description;
        c.addEventListener('click', () => this.actions.recruit(key));
        this.cards.append(c);
        this.cardEls[key] = { el: c, cost: () => t.cost };
      }
    }
    this.refresh();
  }

  setMode(mode) {
    this.currentMode = mode;
    if (mode.kind === 'build') {
      this.modeEl.innerHTML = `Building <b>${this.cfg.WALLS[mode.wallType].name}</b> — click to place, drag for a line, right-click to stop`;
    } else if (mode.kind === 'deploy') {
      const hero = this.sim.heroes.get(mode.heroId);
      this.modeEl.innerHTML = `Place <b>${hero?.name ?? 'hero'}</b> on a wall with a free slot (green) — right-click to cancel`;
    } else {
      this.modeEl.innerHTML = '';
    }
    for (const [key, c] of Object.entries(this.cardEls ?? {})) {
      c.el.classList.toggle('active', mode.kind === 'build' && mode.wallType === key);
    }
  }

  setPlan(plan) {
    if (!plan) { this.setMode(this.currentMode); return; }
    this.modeEl.innerHTML = `Release to build <b>${plan.count}</b> walls for <b>${plan.cost} gold</b>`
      + (plan.blocked ? ` <span style="color:var(--red)">(${plan.blocked} blocked)</span>` : '');
  }

  showSelection(sel) {
    this.selection = sel;
    const sim = this.sim;
    const wall = sel?.kind === 'wall' ? sim.walls.get(sel.id) : null;
    const hero = sel?.kind === 'hero' ? sim.heroes.get(sel.id) : null;
    this.side.hidden = !wall && !hero;
    if (wall) this.#renderWall(wall);
    else if (hero) this.#renderHero(hero);
  }

  #renderWall(wall) {
    const sim = this.sim;
    const t = this.cfg.WALLS[wall.type];
    const pct = Math.round((wall.hp / wall.maxHp) * 100);
    const names = wall.heroes.map((id) => sim.heroes.get(id)?.name).filter(Boolean).join(', ') || '—';
    this.side.innerHTML =
      `<h3>${t.name}</h3>`
      + `<div class="row"><span>Health</span><b>${Math.ceil(wall.hp)} / ${wall.maxHp}</b></div>`
      + `<div class="bar"><div style="width:${pct}%;background:${barColor(pct / 100)}"></div></div>`
      + `<div class="row"><span>Heroes</span><b>${wall.heroes.length} / ${wall.heroCapacity}</b></div>`
      + `<div class="row"><span>Stationed</span><b>${names}</b></div>`;
    const repairCost = sim.walls.repairCost(wall.id);
    const repair = h('button', 'btn', repairCost ? `Repair for ${repairCost} gold <span class="k">R</span>` : 'Fully repaired');
    repair.disabled = !repairCost || !sim.economy.canAfford(repairCost);
    repair.addEventListener('click', () => { sim.walls.repair(wall.id); });
    const sell = h('button', 'btn danger', `Sell for ${sim.walls.sellValue(wall.id)} gold <span class="k">Del</span>`);
    sell.addEventListener('click', () => sim.walls.sell(wall.id));
    this.side.append(repair, sell);
  }

  #renderHero(hero) {
    const sim = this.sim;
    const t = this.cfg.HEROES[hero.type];
    const wall = hero.wallId ? sim.walls.get(hero.wallId) : null;
    const status = !wall ? 'In reserve' : hero.moving > 0 ? `Moving (${hero.moving.toFixed(1)}s)` : `On wall ${wall.x},${wall.y}`;
    this.side.innerHTML =
      `<h3>${hero.name}</h3><div class="sub">${t.name} · Level ${hero.level}</div>`
      + `<div class="row"><span>Health</span><b>${Math.ceil(hero.hp)} / ${hero.maxHp}</b></div>`
      + `<div class="row"><span>Experience</span><b>${Math.floor(hero.xp)} XP</b></div>`
      + `<div class="row"><span>Damage</span><b>${hero.damage}</b></div>`
      + `<div class="row"><span>Attack speed</span><b>${(1 / hero.attackInterval).toFixed(2)}/s</b></div>`
      + `<div class="row"><span>Range</span><b>${hero.range}</b></div>`
      + `<div class="row"><span>Kills</span><b>${hero.kills}</b></div>`
      + `<div class="row"><span>Status</span><b>${status}</b></div>`;
    const move = h('button', 'btn', wall ? `Reposition <span class="k">M</span>` : 'Deploy to a wall');
    move.addEventListener('click', () => this.actions.deploy(hero.id));
    const refund = sim.heroes.refundValue(hero.id);
    const dismiss = h('button', 'btn danger', `Dismiss (+${refund} gold)`);
    // Two-step confirmation so a hero is never lost to a stray click.
    dismiss.addEventListener('click', () => {
      if (dismiss.dataset.armed) { sim.heroes.dismiss(hero.id); return; }
      dismiss.dataset.armed = '1';
      dismiss.textContent = `Confirm: dismiss ${hero.name}?`;
      setTimeout(() => { if (dismiss.isConnected) { delete dismiss.dataset.armed; dismiss.textContent = `Dismiss (+${refund} gold)`; } }, 3000);
    });
    this.side.append(move, dismiss);
  }

  /** Re-renders values that change with game state. Cheap enough to call on events. */
  refresh() {
    const sim = this.sim;
    const gold = sim.economy.gold;
    if (this.vGold.textContent !== String(gold)) {
      this.vGold.textContent = gold;
      this.goldStat.classList.remove('flash');
      void this.goldStat.offsetWidth;
      this.goldStat.classList.add('flash');
    }
    for (const c of Object.values(this.cardEls ?? {})) {
      const cost = c.cost();
      c.el.querySelector('.cost').textContent = `${cost} gold`;
      c.el.classList.toggle('unaffordable', gold < cost);
    }
    this.vBreaches.textContent = sim.walls.breachCount;
    this.vBreaches.parentElement.classList.toggle('alert', sim.walls.breachCount > 0);
    this.vHeroes.textContent = `${sim.heroes.deployedCount} / ${sim.heroes.count}`;
    // Reserve: recruited heroes not on a wall.
    const reserve = [...sim.heroes.all()].filter((x) => !x.wallId);
    this.reserve.hidden = !reserve.length;
    this.reserve.innerHTML = reserve.length ? '<span class="label">Reserve</span>' : '';
    for (const r of reserve) {
      const chip = h('button', 'chip', `${r.name} <span>(${this.cfg.HEROES[r.type].name})</span>`);
      chip.title = 'Click, then click a wall to deploy';
      chip.addEventListener('click', () => this.actions.deploy(r.id));
      this.reserve.append(chip);
    }
    if (this.selection) this.showSelection(this.selection);
  }

  /** Per-frame values (countdown, enemies, gate). */
  tick() {
    const sim = this.sim, w = sim.waves;
    this.vWave.textContent = w.phase === PHASE.ACTIVE ? w.wave : `${w.nextWave}`;
    this.vEnemies.textContent = w.phase === PHASE.ACTIVE ? w.remaining : '—';
    const prep = w.phase === PHASE.PREP;
    const label = prep ? `Start wave ${w.nextWave} <span class="k">${fmtTime(Math.max(0, w.countdown))}</span>` : `Wave ${w.wave} in progress`;
    if (this.waveBtn.innerHTML !== label) this.waveBtn.innerHTML = label;
    this.waveBtn.disabled = !prep;
    const f = sim.fortress;
    const r = f.hp / f.maxHp;
    this.vGateBar.style.width = `${(r * 100).toFixed(1)}%`;
    this.vGateBar.style.background = barColor(r);
    this.vGate.textContent = Math.ceil(f.hp);
    this.vignette.classList.toggle('on', f.endangered);
    if (f.endangered && !this.lastGateWarn) this.toast('The gate is failing! Defend the fortress!', 'alert');
    this.lastGateWarn = f.endangered;
    const paused = this.actions.isPaused();
    this.pauseBtn.textContent = paused ? '▶' : '❚❚';
    this.pauseBtn.classList.toggle('active', paused);
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', this.actions.getSpeed() === i + 1));
    if (this.selection?.kind === 'hero') {
      const hero = sim.heroes.get(this.selection.id);
      if (hero && hero.moving > 0) this.showSelection(this.selection);
    }
  }

  showBanner(title, sub) {
    this.banner.innerHTML = `<div class="t">${title}</div><div class="s">${sub}</div>`;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  toast(text, kind = '') {
    const t = h('div', `toast ${kind}`, text);
    this.toasts.append(t);
    setTimeout(() => t.remove(), 2600);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  dispose() {
    this.el.remove();
  }
}

function barColor(r) {
  return r > 0.6 ? 'var(--green)' : r > 0.3 ? 'var(--gold)' : 'var(--red)';
}
