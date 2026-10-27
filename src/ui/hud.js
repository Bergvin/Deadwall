// In-run HTML HUD over the canvas: top bar (wave, gold, fortress, controls), build panel
// with Walls/Heroes tabs, selection panel, toasts and banners. One Hud per run; dispose()
// removes its DOM.
//
// Panels are built once per selection (or structural change) and only their values are
// updated each frame, so buttons are never replaced under the cursor mid-click.
import './hud.css';
import { PHASE } from '../core/waves.js';
import { heroStats, abilityList } from '../core/heroStats.js';
import { HeroRoster } from './roster.js';
import { RARITY_INFO, ARTIFACTS } from '../config/commander.js';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmt = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toString();
const ABILITY_KEYS = ['Q', 'E', 'F'];

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {import('../core/simulation.js').Simulation} sim
   * @param {{build, recruit, deploy, useAbility, startWave, togglePause, setSpeed, isPaused, getSpeed}} actions
   */
  constructor(root, sim, actions) {
    this.sim = sim;
    this.actions = actions;
    this.cfg = sim.config;
    this.selection = null;
    this.dyn = null; // per-frame updater for the open panel
    this.tab = 'walls';
    this.el = h('div', 'hud');
    root.appendChild(this.el);
    this.#buildTopbar();
    this.#buildPanel();
    this.side = h('div', 'panel');
    this.side.hidden = true;
    this.el.append(this.side);
    this.roster = new HeroRoster(this.el, sim, { select: (sel) => actions.select(sel), focus: (sel) => actions.focus(sel) });
    this.el.append(h('div', 'help',
      '<kbd>B</kbd> build wall &nbsp; <kbd>LMB</kbd> place / select &nbsp; drag for a line<br>'
      + '<kbd>RMB</kbd> cancel &nbsp; <kbd>RMB</kbd> drag / <kbd>WASD</kbd> pan &nbsp; <kbd>Wheel</kbd> zoom<br>'
      + '<kbd>5</kbd>-<kbd>8</kbd> towers &nbsp; <kbd>U</kbd> upgrade &nbsp; <kbd>R</kbd> repair &nbsp; <kbd>Del</kbd> sell<br>'
      + '<kbd>M</kbd> move champion &nbsp; <kbd>Q</kbd><kbd>E</kbd><kbd>F</kbd> abilities<br>'
      + '<kbd>Space</kbd> pause &nbsp; <kbd>Enter</kbd> next wave'));
    this.toasts = h('div', 'toasts');
    this.banner = h('div', 'banner');
    this.vignette = h('div', 'vignette');
    this.bossBar = h('div', 'bossbar', '<div class="bname"></div><div class="bar"><div></div></div>');
    this.bossBar.hidden = true;
    this.preview = h('div', 'preview');
    this.el.append(this.toasts, this.banner, this.vignette, this.bossBar, this.preview);

    const ev = sim.events;
    const refresh = () => this.refresh();
    // Wave start/clear change prices (combat surcharge), so they refresh the cards too.
    for (const t of ['goldChanged', 'wallAdded', 'wallRemoved', 'heroRecruited', 'heroDeployed',
      'heroDismissed', 'heroUnseated', 'wallRepaired', 'heroFell', 'heroRevived',
      'waveStarted', 'waveCleared']) ev.on(t, refresh);
    // Structural changes rebuild the open panel.
    const rebuild = () => this.showSelection(this.selection);
    for (const t of ['heroLevelUp', 'talentBought', 'heroDeployed', 'heroUnseated', 'heroFell',
      'heroRevived', 'wallUpgraded', 'gateReinforced', 'towerUpgraded']) ev.on(t, rebuild);
    for (const t of ['towerBuilt', 'towerRemoved']) ev.on(t, refresh);
    ev.on('heroEndangered', (hero) => this.toast(`${hero.name} is badly hurt!`, 'alert'));
    ev.on('heroFell', (hero) => this.toast(`${hero.name} has fallen! Revive them between waves.`, 'alert'));
    ev.on('bossSpawned', (z) => this.showBanner(this.cfg.ZOMBIES[z.type].name, this.cfg.ZOMBIES[z.type].description));
    ev.on('wandererSpawned', (z) => {
      this.showBanner(this.cfg.ZOMBIES[z.type].name, this.cfg.ZOMBIES[z.type].description);
      this.toast(`A ${this.cfg.ZOMBIES[z.type].name} is crossing the field from the west!`, 'good');
    });
    ev.on('wandererEscaped', ({ zombie }) => this.toast(`The ${this.cfg.ZOMBIES[zombie.type].name} escaped.`, 'alert'));
    ev.on('waveStarted', ({ wave, variant }) => {
      const v = sim.waves.variantInfo(variant);
      this.showBanner(v.label ? `${v.name} · Wave ${wave}` : `Wave ${wave}`, v.banner || 'The dead are coming');
    });
    ev.on('waveCleared', ({ wave, bonus }) => this.showBanner(`Wave ${wave} cleared`, `+${bonus} gold`));
    ev.on('heroUnseated', ({ hero, cause }) => {
      if (cause === 'destroyed') this.toast(`${hero.name}'s wall fell. ${hero.name} retreats to the reserve.`);
    });
    ev.on('heroLevelUp', (hero) => this.toast(`${hero.name} reached level ${hero.level}!`, 'good'));
    ev.on('wallRemoved', ({ wall, cause }) => {
      if (cause === 'destroyed') this.toast(`Breach! Wall at ${wall.x},${wall.y} destroyed`, 'alert');
    });
    this.lastGateWarn = false;
    this.setMode({ kind: 'select' });
    this.refresh();
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
    this.muteBtn = h('button', 'btn icon');
    this.muteBtn.title = 'Sound on/off';
    this.muteBtn.addEventListener('click', () => this.actions.toggleMute());
    controls.append(this.waveBtn, this.pauseBtn, this.muteBtn);
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
    for (const [key, label, enabled] of [['walls', 'Walls', true], ['towers', 'Towers', true], ['upgrades', 'Upgrades', false]]) {
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
        const special = t.thorns ? `${t.thorns} thorn dmg/s`
          : t.arcane ? 'Slows + magic pulse' : t.armor ? `${Math.round(t.armor * 100)}% armor` : 'Basic';
        const c = h('button', 'card',
          `<span class="key">${i + 1}</span><div class="name">${t.name}</div>`
          + `<div class="cost"></div><div class="meta">${t.maxHp} HP</div>`
          + `<div class="meta">${special}</div>`);
        c.title = t.description;
        c.addEventListener('click', () => this.actions.build(key));
        this.cards.append(c);
        this.cardEls[key] = { el: c, cost: () => this.sim.walls.costOf(key) };
      });
    } else {
      Object.entries(this.cfg.TOWERS).forEach(([key, t], i) => {
        const c = h('button', 'card hero',
          `<span class="key">${i + 5}</span><div class="name"><span class="portrait mini e-${key}">${t.element[0]}</span>${t.name}</div>`
          + `<div class="cost"></div>`
          + `<div class="meta">DMG ${t.damage} · ${fmt(1 / t.interval, 1)}/s · RNG ${t.range}</div>`
          + `<div class="meta">${towerEffect(t)}</div>`);
        c.title = `${t.description}\nStrong: ${t.strengths}\nWeak: ${t.weaknesses}\nBuilt on top of a wall.`;
        c.addEventListener('click', () => this.actions.buildTower(key));
        this.cards.append(c);
        this.cardEls[key] = { el: c, cost: () => this.sim.towers.costOf(key) };
      });
    }
    this.refresh();
  }

  setMode(mode) {
    this.currentMode = mode;
    if (mode.kind === 'build') {
      this.modeEl.innerHTML = `Building <b>${this.cfg.WALLS[mode.wallType].name}</b> — click to place, drag for a line, right-click to stop`;
    } else if (mode.kind === 'deploy') {
      const hero = this.sim.heroes.get(mode.heroId);
      this.modeEl.innerHTML = `Place <b>${hero?.name ?? 'hero'}</b> on a free 2×2 block of walls (green) — right-click to cancel`;
    } else if (mode.kind === 'tower') {
      this.modeEl.innerHTML = `Building <b>${this.cfg.TOWERS[mode.towerType].name}</b> — click a wall (green), right-click to stop`;
    } else if (mode.kind === 'ability') {
      const hero = this.sim.heroes.get(mode.heroId);
      const a = this.cfg.HEROES[hero.type].abilities[mode.abilityId];
      this.modeEl.innerHTML = `<b>${a.name}</b>: pick a target inside the ring — right-click to cancel`;
    } else {
      this.modeEl.innerHTML = '';
    }
    for (const [key, c] of Object.entries(this.cardEls ?? {})) {
      c.el.classList.toggle('active', (mode.kind === 'build' && mode.wallType === key) || (mode.kind === 'tower' && mode.towerType === key));
    }
  }

  setPlan(plan) {
    if (!plan) { this.setMode(this.currentMode); return; }
    this.modeEl.innerHTML = `Release to build <b>${plan.count}</b> walls for <b>${plan.cost} gold</b>`
      + (plan.blocked ? ` <span style="color:var(--red)">(${plan.blocked} blocked)</span>` : '');
  }

  /** Builds the panel for the selection (or hides it). */
  showSelection(sel) {
    this.selection = sel;
    this.roster?.setSelected(sel?.kind === 'hero' || sel?.kind === 'tower' ? sel.id : 0);
    const sim = this.sim;
    const wall = sel?.kind === 'wall' ? sim.walls.get(sel.id) : null;
    const hero = sel?.kind === 'hero' ? sim.heroes.get(sel.id) : null;
    const tower = sel?.kind === 'tower' ? sim.towers.get(sel.id) : null;
    const gate = sel?.kind === 'gate';
    this.side.hidden = !wall && !hero && !gate && !tower;
    this.side.innerHTML = '';
    this.side.classList.toggle('wide', !!hero);
    this.dyn = null;
    if (wall) this.#buildWallPanel(wall);
    else if (hero) this.#buildHeroPanel(hero);
    else if (tower) this.#buildTowerPanel(tower);
    else if (gate) this.#buildGatePanel();
    this.dyn?.();
  }

  #buildWallPanel(wall) {
    const sim = this.sim;
    const t = this.cfg.WALLS[wall.type];
    const names = wall.heroes.map((id) => sim.heroes.get(id)?.name).filter(Boolean).join(', ') || '—';
    const maxLevel = this.cfg.WALL_UPGRADES.maxLevel;
    let special = '';
    if (wall.armor) special += `<div class="row"><span>Armor</span><b>${Math.round(wall.armor * 100)}%</b></div>`;
    if (wall.thorns) special += `<div class="row"><span>Thorns</span><b>${fmt(wall.thorns, 1)} dmg/s to attackers</b></div>`;
    if (wall.arcane) {
      special += `<div class="row"><span>Arcane aura</span><b>r ${fmt(wall.arcane.radius, 1)} · slow ${Math.round((1 - wall.arcane.slow) * 100)}%</b></div>`
        + `<div class="row"><span>Pulse</span><b>${fmt(wall.arcane.pulseDamage, 0)} magic / ${wall.arcane.pulseInterval}s</b></div>`;
    }
    this.side.innerHTML =
      `<h3>${t.name}</h3><div class="sub">Level ${wall.level} / ${maxLevel}</div>`
      + '<div class="row"><span>Health</span><b class="v-hp"></b></div><div class="bar"><div class="v-bar"></div></div>'
      + special
      + `<div class="row"><span>Heroes</span><b>${wall.heroes.length} / ${wall.heroCapacity}</b></div>`
      + `<div class="row"><span>Champion</span><b>${names}</b></div>`
      + (wall.towerId ? `<div class="row"><span>Tower</span><b>${this.cfg.TOWERS[sim.towers.get(wall.towerId).type].name} · Lv ${sim.towers.get(wall.towerId).level}</b></div>` : '')
      + '<div class="row v-buffrow"><span>Protected</span><b class="v-buff"></b></div>';
    const repair = h('button', 'btn');
    repair.addEventListener('click', () => { if (!sim.walls.repair(wall.id)) this.toast('Not enough gold'); });
    const upgrade = h('button', 'btn');
    upgrade.addEventListener('click', () => {
      const r = sim.walls.canUpgrade(wall.id);
      if (r.ok) { sim.walls.upgrade(wall.id); this.showSelection(this.selection); } else this.toast(r.reason === 'max_level' ? 'Already at maximum level' : 'Not enough gold');
    });
    const sell = h('button', 'btn danger');
    sell.addEventListener('click', () => sim.walls.sell(wall.id));
    this.side.append(repair, upgrade, sell);
    if (wall.towerId) {
      const tb = h('button', 'btn', 'Select the tower');
      tb.addEventListener('click', () => this.actions.select({ kind: 'tower', id: wall.towerId }));
      this.side.append(tb);
    }
    const nextHp = wall.level < maxLevel
      ? Math.round(this.cfg.WALLS[wall.type].maxHp * this.cfg.WALL_UPGRADES.hpMult ** wall.level) : null;
    const q = (c) => this.side.querySelector(c);
    this.dyn = () => {
      const r = wall.hp / wall.maxHp;
      q('.v-hp').textContent = `${Math.ceil(wall.hp)} / ${wall.maxHp}`;
      q('.v-bar').style.width = `${(r * 100).toFixed(1)}%`;
      q('.v-bar').style.background = barColor(r);
      const cost = sim.walls.repairCost(wall.id);
      const label = cost ? `Repair for ${cost} gold <span class="k">R</span>` : 'Fully repaired';
      if (repair.innerHTML !== label) repair.innerHTML = label;
      repair.disabled = !cost || !sim.economy.canAfford(cost);
      const ucost = sim.walls.upgradeCost(wall.id);
      const ul = nextHp ? `Upgrade to level ${wall.level + 1} (${nextHp} HP) for ${ucost} gold <span class="k">U</span>` : 'Fully upgraded';
      if (upgrade.innerHTML !== ul) upgrade.innerHTML = ul;
      upgrade.disabled = !nextHp || !sim.economy.canAfford(ucost);
      const sl = `Sell for ${sim.walls.sellValue(wall.id)} gold <span class="k">Del</span>`;
      if (sell.innerHTML !== sl) sell.innerHTML = sl;
      const buff = wall.buffs.find((b) => b.until > sim.time);
      const mult = sim.combat.wallDamageMultiplier(wall);
      q('.v-buffrow').style.display = mult < 1 ? '' : 'none';
      q('.v-buff').textContent = `-${Math.round((1 - mult) * 100)}% damage${buff ? ` (${fmt(buff.until - sim.time)}s)` : ''}`;
    };
  }

  #buildTowerPanel(tower) {
    const sim = this.sim;
    const t = this.cfg.TOWERS[tower.type];
    const maxLevel = this.cfg.TOWER_RULES.maxLevel;
    const s = tower.stats;
    const wall = sim.walls.get(tower.wallId);
    const effect = [
      s.aoe ? `area ${fmt(s.aoe, 1)}` : '',
      s.burn ? `burn ${fmt(s.burn.dps, 1)}/s` : '',
      s.stun ? `stun ${fmt(s.stun, 1)}s, armor pierce ${Math.round(s.armorPen * 100)}%` : '',
      s.targets > 1 ? `${s.targets} targets` : '',
      s.slow ? `slow ${Math.round((1 - s.slow.factor) * 100)}%` : '',
    ].filter(Boolean).join(' · ');
    this.side.innerHTML =
      `<div class="hero-head"><div class="portrait e-${tower.type}">${t.element[0]}</div>`
      + `<div><h3>${t.name}</h3><div class="sub">Level ${tower.level} / ${maxLevel} · on wall ${wall?.x},${wall?.y}</div></div></div>`
      + `<div class="row"><span>Damage</span><b>${fmt(s.damage, 1)}</b></div>`
      + `<div class="row"><span>Attacks / s</span><b>${fmt(1 / s.interval, 2)}</b></div>`
      + `<div class="row"><span>Range</span><b>${fmt(s.range, 1)}</b></div>`
      + `<div class="row"><span>Effect</span><b>${effect}</b></div>`
      + '<div class="row"><span>DPS last wave</span><b class="v-dps"></b></div>'
      + '<div class="row"><span>Kills</span><b class="v-kills"></b></div>';
    const tgt = h('select', 'targeting');
    for (const [k, label] of Object.entries(this.cfg.TARGETING)) {
      const o = h('option', '', label);
      o.value = k;
      if (tower.targeting === k) o.selected = true;
      tgt.append(o);
    }
    tgt.addEventListener('change', () => sim.towers.setTargeting(tower.id, tgt.value));
    const tRow = h('div', 'row', '<span>Target</span>');
    tRow.append(tgt);
    const upgrade = h('button', 'btn');
    upgrade.addEventListener('click', () => {
      const r = sim.towers.canUpgrade(tower.id);
      if (r.ok) sim.towers.upgrade(tower.id);
      else this.toast(r.reason === 'max_level' ? 'Already at maximum level' : 'Not enough gold');
    });
    const sell = h('button', 'btn danger');
    sell.addEventListener('click', () => sim.towers.sell(tower.id));
    const toWall = h('button', 'btn', 'Select the wall below');
    toWall.addEventListener('click', () => this.actions.select({ kind: 'wall', id: tower.wallId }));
    this.side.append(tRow, upgrade, sell, toWall);
    const q = (c) => this.side.querySelector(c);
    this.dyn = () => {
      q('.v-dps').textContent = tower.lastWaveDps ? fmt(tower.lastWaveDps, 1) : '—';
      q('.v-kills').textContent = tower.kills;
      const cost = sim.towers.upgradeCost(tower.id);
      let ul = 'Fully upgraded';
      if (tower.level < maxLevel) {
        const next = this.cfg.TOWERS[tower.type].damage * this.cfg.TOWER_RULES.damageMult ** tower.level;
        ul = `Upgrade to level ${tower.level + 1} (DMG ${fmt(next, 1)}) for ${cost} gold <span class="k">U</span>`;
      }
      if (upgrade.innerHTML !== ul) upgrade.innerHTML = ul;
      upgrade.disabled = tower.level >= maxLevel || !sim.economy.canAfford(cost);
      const sl = `Sell for ${sim.towers.sellValue(tower.id)} gold <span class="k">Del</span>`;
      if (sell.innerHTML !== sl) sell.innerHTML = sl;
    };
  }

  #buildGatePanel() {
    const f = this.sim.fortress;
    this.side.innerHTML =
      '<h3>Fortress Gate</h3><div class="sub">If the gate falls, the run is over.</div>'
      + '<div class="row"><span>Health</span><b class="v-hp"></b></div><div class="bar"><div class="v-bar"></div></div>'
      + '<div class="row"><span>Reinforcement</span><b class="v-lvl"></b></div>';
    const repair = h('button', 'btn');
    repair.addEventListener('click', () => { if (!f.repair()) this.toast('Not enough gold'); });
    const reinforce = h('button', 'btn');
    reinforce.addEventListener('click', () => { if (!f.reinforce()) this.toast('Not enough gold'); });
    this.side.append(repair, reinforce);
    const q = (c) => this.side.querySelector(c);
    this.dyn = () => {
      const r = f.hp / f.maxHp;
      q('.v-hp').textContent = `${Math.ceil(f.hp)} / ${f.maxHp}`;
      q('.v-bar').style.width = `${(r * 100).toFixed(1)}%`;
      q('.v-bar').style.background = barColor(r);
      q('.v-lvl').textContent = `${f.reinforceLevel} / ${this.cfg.FORTRESS.reinforce.length}`;
      const cost = f.repairCost();
      const rl = cost ? `Repair for ${cost} gold <span class="k">R</span>` : 'Fully repaired';
      if (repair.innerHTML !== rl) repair.innerHTML = rl;
      repair.disabled = !cost || !this.sim.economy.canAfford(cost);
      const step = f.nextReinforcement();
      const fl = step ? `Reinforce (+${step.addHp} max HP) for ${step.cost} gold` : 'Fully reinforced';
      if (reinforce.innerHTML !== fl) reinforce.innerHTML = fl;
      reinforce.disabled = !step || !this.sim.economy.canAfford(step.cost);
    };
  }

  #buildHeroPanel(hero) {
    const sim = this.sim;
    const t = this.cfg.HEROES[hero.type];
    const s = hero.stats;
    const maxed = hero.level >= this.cfg.HERO_RULES.maxLevel;
    const next = maxed ? null : heroStats(t, hero.level + 1, hero.talents);
    const row = (label, now, nxt, d = 0, suffix = '') => {
      const up = nxt !== null && nxt !== undefined && fmt(nxt, d) !== fmt(now, d);
      return `<div class="row"><span>${label}</span><b>${fmt(now, d)}${suffix}${up ? ` <i class="up">→ ${fmt(nxt, d)}${suffix}</i>` : ''}</b></div>`;
    };
    let statRows = row('Damage', s.damage, next?.damage, 1)
      + row('Attacks / s', 1 / s.attackInterval, next && 1 / next.attackInterval, 2)
      + row('Range', s.range, next?.range, 1)
      + row('Critical', s.critChance * 100, next && next.critChance * 100, 0, '%');
    if (s.armorPen) statRows += row('Armor pierce', s.armorPen * 100, next && next.armorPen * 100, 0, '%');
    if (s.aoe) statRows += row('Blast radius', s.aoe, next?.aoe, 2);
    if (s.wallGuard) statRows += row('Wall guard', s.wallGuard * 100, next && next.wallGuard * 100, 0, '%');
    if (s.repairPerSec) statRows += row('Wall mending', s.repairPerSec, next?.repairPerSec, 1, '/s');
    if (s.poisonDps) statRows += row('Poison', s.poisonDps, next?.poisonDps, 1, '/s');

    this.side.innerHTML =
      `<div class="hero-head"><div class="portrait c-${hero.type}">${t.name[0]}</div>`
      + `<div><h3>${hero.name}</h3><div class="sub">${t.name} · Level ${hero.level}${maxed ? ' (max)' : ''}</div></div></div>`
      + '<div class="row"><span>Health</span><b class="v-hp"></b></div>'
      + '<div class="row"><span>Experience</span><b class="v-xp"></b></div><div class="bar xp"><div class="v-xpbar"></div></div>'
      + `<div class="stats">${statRows}</div>`
      + '<div class="row"><span>Kills</span><b class="v-kills"></b></div>'
      + '<div class="row"><span>Status</span><b class="v-status"></b></div>';

    // Abilities
    const abil = h('div', 'abilities');
    const abilBtns = abilityList(t, hero.level).map((a, i) => {
      const b = h('button', `ability${a.unlocked ? '' : ' locked'}`,
        `<span class="key">${ABILITY_KEYS[i]}</span><span class="aname">${a.name}</span>`
        + `<span class="cd"></span><span class="lock">Lv ${a.unlock}</span>`);
      b.title = `${a.description}\nCooldown ${a.cooldown}s${a.unlocked ? '' : `\nUnlocks at level ${a.unlock}`}`;
      b.addEventListener('click', () => this.actions.useAbility(hero.id, a.id));
      abil.append(b);
      return { b, a };
    });
    this.side.append(h('div', 'section', 'Abilities'), abil);

    // Targeting preference
    const tgt = h('select', 'targeting');
    for (const [k, label] of Object.entries(this.cfg.TARGETING)) {
      const o = h('option', '', label);
      o.value = k;
      if (hero.targeting === k) o.selected = true;
      tgt.append(o);
    }
    tgt.addEventListener('change', () => sim.heroes.setTargeting(hero.id, tgt.value));
    const tRow = h('div', 'row', '<span>Target</span>');
    tRow.append(tgt);
    const auto = h('label', 'row autocast', '<span>Use abilities automatically</span>');
    const cb = h('input');
    cb.type = 'checkbox';
    cb.checked = hero.autoCast;
    cb.addEventListener('change', () => sim.heroes.setAutoCast(hero.id, cb.checked));
    auto.append(cb);
    this.side.append(tRow, auto);

    // Talents
    this.side.append(h('div', 'section', 'Upgrades'));
    const talentBtns = [];
    for (const tier of sim.heroes.talentTiers(hero)) {
      const wrap = h('div', `tier${tier.unlocked ? '' : ' locked'}`,
        `<div class="tierhead">Level ${tier.level} · ${tier.chosen ? 'chosen' : `${tier.cost} gold`}</div>`);
      const opts = h('div', 'opts');
      for (const o of tier.options) {
        const chosen = tier.chosen === o.id;
        const b = h('button', `talent${chosen ? ' chosen' : ''}${tier.chosen && !chosen ? ' dim' : ''}`,
          `<b>${o.name}</b><span>${o.description}</span>`);
        b.disabled = !!tier.chosen || !tier.unlocked;
        b.addEventListener('click', () => {
          if (!sim.heroes.buyTalent(hero.id, tier.index, o.id)) {
            this.toast(!tier.unlocked ? `Needs level ${tier.level}` : 'Not enough gold');
          }
        });
        opts.append(b);
        if (!tier.chosen && tier.unlocked) talentBtns.push({ b, cost: tier.cost });
      }
      wrap.append(opts);
      this.side.append(wrap);
    }

    // Management
    const wall = hero.wallId ? sim.walls.get(hero.wallId) : null;
    if (hero.fallen) {
      const revive = h('button', 'btn wavebtn');
      revive.addEventListener('click', () => {
        const r = sim.heroes.canRevive(hero.id);
        if (r.ok) sim.heroes.revive(hero.id);
        else this.toast(r.reason === 'wave_active' ? 'Heroes can only be revived between waves' : 'Not enough gold');
      });
      this.side.append(revive);
      this.reviveBtn = revive;
    }
    // The champion cannot be dismissed (there is only one); it can move to another 2x2 block.
    const move = h('button', 'btn', wall ? 'Move to another 2×2 block <span class="k">M</span>' : 'Place on a 2×2 block of walls');
    move.disabled = hero.fallen;
    move.addEventListener('click', () => this.actions.deploy(hero.id));
    this.side.append(move);

    const q = (c) => this.side.querySelector(c);
    this.dyn = () => {
      q('.v-hp').textContent = `${Math.ceil(hero.hp)} / ${hero.maxHp}`;
      const need = sim.heroes.xpToNext(hero);
      q('.v-xp').textContent = Number.isFinite(need) ? `${Math.floor(hero.xp)} / ${need}` : 'MAX';
      q('.v-xpbar').style.width = Number.isFinite(need) ? `${Math.min(100, (hero.xp / need) * 100).toFixed(1)}%` : '100%';
      q('.v-kills').textContent = hero.kills;
      const w = hero.wallId ? sim.walls.get(hero.wallId) : null;
      q('.v-status').textContent = hero.fallen ? 'Fallen' : !w ? 'In reserve' : hero.moving > 0 ? `Moving (${fmt(hero.moving, 1)}s)` : `On wall ${w.x},${w.y}`;
      if (hero.fallen && this.reviveBtn?.isConnected) {
        const cost = sim.heroes.reviveCost(hero.id);
        const ok = sim.heroes.canRevive(hero.id);
        const rl = ok.reason === 'wave_active' ? `Revive (${cost} gold) after this wave` : `Revive for ${cost} gold`;
        if (this.reviveBtn.innerHTML !== rl) this.reviveBtn.innerHTML = rl;
        this.reviveBtn.disabled = !ok.ok;
      }
      for (const { b, a } of abilBtns) {
        const cd = hero.abilityCooldowns[a.id] ?? 0;
        b.classList.toggle('cooling', cd > 0);
        b.style.setProperty('--cd', a.unlocked && cd > 0 ? String(cd / (a.cooldown * hero.stats.cooldownMult)) : '0');
        b.querySelector('.cd').textContent = cd > 0 ? fmt(cd, cd < 10 ? 1 : 0) : '';
        b.disabled = !a.unlocked || !hero.wallId || hero.moving > 0;
      }
      for (const { b, cost } of talentBtns) b.classList.toggle('unaffordable', !sim.economy.canAfford(cost));
    };
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
    const key = reserve.map((r) => `${r.id}${r.fallen ? 'f' : ''}`).join(',');
    if (key !== this.reserveKey) {
      this.reserveKey = key;
      this.reserve.hidden = !reserve.length;
      this.reserve.innerHTML = reserve.length ? '<span class="label">Reserve</span>' : '';
      for (const r of reserve) {
        const chip = h('button', `chip${r.fallen ? ' fallen' : ''}`,
          `${r.name} <span>(${this.cfg.HEROES[r.type].name}${r.fallen ? ', fallen' : ''})</span>`);
        chip.title = r.fallen ? 'Fallen: open to revive between waves' : 'Click, then click a wall to deploy';
        chip.addEventListener('click', () => (r.fallen ? this.actions.select({ kind: 'hero', id: r.id }) : this.actions.deploy(r.id)));
        this.reserve.append(chip);
      }
    }
    // A removed wall or dismissed hero closes its panel.
    const sel = this.selection;
    if (sel && !(sel.kind === 'wall' ? sim.walls.get(sel.id) : sim.heroes.get(sel.id))) this.showSelection(null);
  }

  /** Per-frame values (countdown, enemies, gate, open panel). */
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
    const ml = this.actions.isMuted() ? 'Sound off' : 'Sound';
    if (this.muteBtn.textContent !== ml) this.muteBtn.textContent = ml;
    this.muteBtn.classList.toggle('active', this.actions.isMuted());

    // Boss health bar.
    // Boss health bar (a Wanderer uses it when no boss is alive).
    const boss = sim.zombies.bosses[0] ?? sim.zombies.wanderers[0];
    this.bossBar.hidden = !boss;
    this.bossBar.classList.toggle('wanderer', !!boss?.wanderer);
    if (boss) {
      const name = boss.wanderer
        ? `${this.cfg.ZOMBIES[boss.type].name} · escapes in ${Math.max(0, Math.ceil((this.cfg.MAP.width - boss.x) / boss.speed))}s`
        : `${boss.elite ? 'Elite ' : ''}${this.cfg.ZOMBIES[boss.type].name}`;
      const nameEl = this.bossBar.querySelector('.bname');
      if (nameEl.textContent !== name) nameEl.textContent = name;
      this.bossBar.querySelector('.bar > div').style.width = `${((boss.hp / boss.maxHp) * 100).toFixed(1)}%`;
    }

    // Upcoming wave preview during preparation.
    let pv = '';
    if (prep) {
      const comp = w.preview();
      const parts = comp.groups.map((g) => `${g.count} ${this.cfg.ZOMBIES[g.type].name}${g.count > 1 ? 's' : ''}`);
      const v = w.variantInfo(comp.variant);
      pv = `<span class="label">Next wave</span> `
        + (v.label ? `<b class="variant v-${comp.variant}">${v.label}</b> ` : '')
        + parts.join(' · ')
        + (comp.boss ? ` · <b class="boss">BOSS: ${this.cfg.ZOMBIES[comp.boss].name}</b>` : '')
        + (comp.eliteChance ? ` · <span class="elite">elites ${Math.round(comp.eliteChance * 100)}%</span>` : '');
    }
    if (this.preview.innerHTML !== pv) this.preview.innerHTML = pv;
    this.preview.hidden = !pv;
    this.roster.tick();
    this.dyn?.();
  }

  /** Announces an artifact drop in its rarity colour. */
  artifactFound({ id, rarity }, salvagedXp = 0) {
    const r = RARITY_INFO[rarity];
    const name = ARTIFACTS[id].name;
    this.showBanner(`<span style="color:${r.color}">${name}</span>`, `${r.name} artifact${salvagedXp ? ` · stash full, salvaged for ${salvagedXp} XP` : ' · added to your Commander'}`);
    this.toast(`Artifact found: <b style="color:${r.color}">${name}</b> (${r.name})`, 'good');
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

/** One-line summary of a tower's element effect. */
function towerEffect(t) {
  if (t.burn) return `Area ${t.aoe} · burns ${t.burn.dps}/s`;
  if (t.stun) return `Pierces ${Math.round(t.armorPen * 100)}% armor · stuns`;
  if (t.targets) return `Hits ${t.targets} at once · long range`;
  if (t.slow) return `Splash · slows ${Math.round((1 - t.slow.factor) * 100)}%`;
  return '';
}

function barColor(r) {
  return r > 0.6 ? 'var(--green)' : r > 0.3 ? 'var(--gold)' : 'var(--red)';
}
