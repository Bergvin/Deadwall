// In-run HTML HUD over the canvas: top bar (map, wave, gold, house, tower slots, controls),
// tower build cards, the runner bar (crates, level, spells, perk picks), the side panel for
// the selected tower / runner / house, the perk picker, ammo alerts, toasts and banners.
// One Hud per run; dispose() removes its DOM.
//
// Panels are built once per selection (or structural change) and only their values are
// updated each frame, so buttons are never replaced under the cursor mid-click.
import './hud.css';
import { PHASE } from '../core/waves.js';
import { GAME_SPEEDS } from '../config/game.js';
import { TOWER_KEYS, SPELL_KEYS, keyLabel } from '../input/interaction.js';
import { DamageMeter } from './damageMeter.js';
import { towerStats } from '../core/towers.js';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmt = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toString();

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {import('../core/simulation.js').Simulation} sim
   * @param {object} actions see Session
   */
  constructor(root, sim, actions) {
    this.sim = sim;
    this.actions = actions;
    this.cfg = sim.config;
    this.selection = null;
    this.dyn = null; // per-frame updater for the open panel
    this.spellHover = false;
    this.el = h('div', 'hud td');
    root.appendChild(this.el);
    this.#buildTopbar();
    this.#buildCards();
    this.#buildRunnerBar();
    this.side = h('div', 'panel');
    this.side.hidden = true;
    this.el.append(this.side);
    this.el.append(h('div', 'help',
      '<kbd>1</kbd>-<kbd>0</kbd> <kbd>-</kbd> build a tower &nbsp; <kbd>LMB</kbd> place / select<br>'
      + '<kbd>U</kbd> upgrade &nbsp; <kbd>R</kbd> send the runner &nbsp; <kbd>Del</kbd> sell<br>'
      + '<kbd>Q</kbd><kbd>E</kbd><kbd>F</kbd><kbd>G</kbd> spells &nbsp; double-click a tower: send the runner<br>'
      + '<kbd>RMB</kbd> cancel &nbsp; <kbd>RMB</kbd> drag / <kbd>WASD</kbd> pan &nbsp; <kbd>Wheel</kbd> zoom<br>'
      + '<kbd>Space</kbd> pause &nbsp; <kbd>Enter</kbd> next wave'));
    this.toasts = h('div', 'toasts');
    this.banner = h('div', 'banner');
    this.vignette = h('div', 'vignette');
    this.bossBar = h('div', 'bossbar', '<div class="bname"></div><div class="bar"><div></div></div>');
    this.bossBar.hidden = true;
    this.preview = h('div', 'preview');
    this.alerts = h('div', 'ammoalerts');
    this.el.append(this.toasts, this.banner, this.vignette, this.bossBar, this.preview, this.alerts);
    this.picker = new PerkPicker(this);
    this.meter = new DamageMeter(this.el, sim, { select: (sel) => this.actions.select(sel) });
    // The first time a new kind of enemy turns up: what it is and what beats it.
    this.seenTypes = new Set();
    sim.events.on('zombieSpawned', (z) => {
      if (this.seenTypes.has(z.type)) return;
      this.seenTypes.add(z.type);
      const t = this.cfg.ZOMBIES[z.type];
      if (t.stealth || t.immune || t.immuneTags || t.regen) this.toast(`<b>${t.name}</b>: ${t.description}`, 'long');
    });

    const ev = sim.events;
    const refresh = () => this.refresh();
    for (const t of ['goldChanged', 'towerBuilt', 'towerRemoved', 'towerUpgraded', 'waveStarted', 'waveCleared', 'towerSlotOpened']) ev.on(t, refresh);
    const rebuild = () => this.showSelection(this.selection);
    for (const t of ['towerUpgraded', 'towerUpgradeQueued', 'runnerPerkChosen', 'runnerLevelUp', 'waveStarted', 'waveCleared', 'houseRepaired']) ev.on(t, rebuild);
    ev.on('runnerPerkChosen', () => this.#buildSpells());
    ev.on('bossSpawned', (z) => this.showBanner(this.cfg.ZOMBIES[z.type].name, this.cfg.ZOMBIES[z.type].description));
    ev.on('waveStarted', ({ wave, variant, early }) => {
      const v = sim.waves.variantInfo(variant);
      this.showBanner(v.label ? `${v.name} · Wave ${wave}` : `Wave ${wave}`, early ? 'Called early!' : v.banner || 'The dead are coming');
    });
    ev.on('waveCleared', ({ wave, bonus }) => this.showBanner(`Wave ${wave} cleared`, `+${bonus} gold`));
    ev.on('waveCleared', () => {
      const r = sim.runner;
      if (r.pendingPicks > 0) this.toast(`${r.name} can learn ${r.pendingPicks > 1 ? `${r.pendingPicks} new tricks` : 'a new trick'}!`, 'good');
    });
    ev.on('towerSlotOpened', ({ slots }) => this.toast(`A new tower slot opened! (${slots} towers)`, 'good'));
    ev.on('hordeEnraged', ({ count }) => this.toast(`The last ${count > 1 ? `${count} stragglers are` : 'straggler is'} enraged: faster and unstoppable!`, 'alert'));
    ev.on('runnerBonked', ({ runner, lost }) => this.toast(`${runner.name} got knocked over${lost ? ' and lost a crate' : ''}!`, 'alert'));
    ev.on('towerEmpty', (t) => this.toast(`${this.cfg.TOWERS[t.type].name} is out of ammo!`, 'alert'));
    ev.on('runnerLevelUp', ({ level }) => this.toast(`${sim.runner.name} reached level ${level}!`, 'good'));
    ev.on('zombieLeaked', ({ damage }) => {
      this.houseFlash = 0.4;
      if (sim.house.hp - damage > 0 && sim.house.hp / sim.house.maxHp > 0.5) return;
      this.toast(`Something got into the house! (-${Math.round(damage)})`, 'alert');
    });
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
    stat('mapname', 'Map').textContent = this.sim.map.name;
    this.vWave = stat('wave', 'Wave');
    this.vEnemies = stat('enemies', 'Enemies');
    this.vGold = stat('gold', 'Gold');
    this.goldStat = this.vGold.parentElement;
    const house = h('div', 'stat fortress', '<span class="label">House</span><div class="bar wide"><div></div></div><span class="value"></span>');
    top.append(house);
    this.houseStat = house;
    this.vHouseBar = house.querySelector('.bar > div');
    this.vHouse = house.querySelector('.value');
    this.vSlots = stat('slots', 'Towers');
    this.vSlots.parentElement.title = 'Towers built / tower slots. More slots open as you survive longer.';
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
    this.speedBtns = GAME_SPEEDS.map((s) => {
      const b = h('button', 'btn icon speed', `${s}×`);
      b.title = `Game speed ${s}×`;
      b.addEventListener('click', () => this.actions.setSpeed(s));
      controls.append(b);
      return b;
    });
    top.append(controls);
    this.el.append(top);
  }

  #buildCards() {
    const bar = h('div', 'buildbar');
    this.cards = h('div', 'cards');
    this.cardEls = {};
    Object.entries(this.cfg.TOWERS).forEach(([key, t], i) => {
      const c = h('button', 'card tcard',
        `<span class="key">${keyLabel(TOWER_KEYS[i])}</span><div class="name"><span class="ticon" style="color:#${t.color.toString(16).padStart(6, '0')}">${t.icon}</span> ${t.name}</div>`
        + `<div class="cost"></div>`
        + `<div class="meta">${t.damage} ${t.damageType} · ${fmt(1 / t.interval, 1)}/s · rng ${t.range}</div>`
        + `<div class="meta">Ammo ${t.ammo}</div>`);
      c.title = `${t.description}\nStrong: ${t.strengths}\nWeak: ${t.weaknesses}\nSpecialisations at level ${this.cfg.TOWER_RULES.specLevel}: ${t.specs.a.name} or ${t.specs.b.name}`;
      c.addEventListener('click', () => this.actions.buildTower(key));
      this.cards.append(c);
      this.cardEls[key] = { el: c, cost: () => this.sim.towers.costOf(key) };
    });
    bar.append(this.cards);
    this.el.append(bar);
  }

  // --- runner bar ------------------------------------------------------
  #buildRunnerBar() {
    const r = this.sim.runner;
    const bar = h('div', 'runnerbar');
    const head = h('button', 'rhead',
      `<div class="rface">☺</div><div class="rinfo"><div class="rname">${r.name}</div>`
      + '<div class="rsub"><span class="v-lvl"></span> · <span class="v-state"></span></div>'
      + '<div class="bar xp"><div class="v-xp"></div></div><div class="crates v-crates"></div></div>');
    head.title = 'Your ammo runner. Click to select him.';
    head.addEventListener('click', () => this.actions.select({ kind: 'runner', id: r.main.id }));
    this.pickBtn = h('button', 'btn pickbtn', '');
    this.pickBtn.addEventListener('click', () => this.picker.open());
    this.spellRow = h('div', 'spells');
    this.autoAllBtn = h('button', 'btn autoall', 'AUTO');
    this.autoAllBtn.title = 'Auto-cast every spell on/off (right-click a spell to choose for that spell only)';
    this.autoAllBtn.addEventListener('click', () => this.actions.toggleAutoCastAll());
    bar.append(head, this.spellRow, this.autoAllBtn, this.pickBtn);
    // Waiting perk picks also get a big button in the middle of the screen between waves.
    this.pickCallout = h('button', 'pickcallout');
    this.pickCallout.hidden = true;
    this.pickCallout.addEventListener('click', () => this.picker.open());
    this.el.append(this.pickCallout);
    this.el.append(bar);
    this.runnerBar = bar;
    this.#buildSpells();
  }

  #buildSpells() {
    const r = this.sim.runner;
    this.spellRow.innerHTML = '';
    this.spellEls = [];
    Object.keys(r.spells).forEach((id, i) => {
      const info = r.spellInfo(id);
      const b = h('button', 'ability spell',
        `<span class="key">${keyLabel(SPELL_KEYS[i] ?? '')}</span><span class="sicon">${info.def.icon}</span>`
        + `<span class="aname">${info.def.name}${info.rank > 1 ? ` <i>${'+'.repeat(info.rank - 1)}</i>` : ''}</span><span class="cd"></span><span class="auto">AUTO</span>`);
      b.title = `${info.def.text}\nRight-click: auto-cast on/off`;
      b.addEventListener('click', () => this.actions.cast(i));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); this.actions.toggleAutoCast(id); });
      b.addEventListener('pointerenter', () => { this.spellHover = true; });
      b.addEventListener('pointerleave', () => { this.spellHover = false; });
      this.spellRow.append(b);
      this.spellEls.push({ id, el: b });
    });
  }

  #tickRunnerBar() {
    const r = this.sim.runner;
    const q = (c) => this.runnerBar.querySelector(c);
    const u = r.main;
    q('.v-lvl').textContent = `Lv ${r.level}`;
    const STATE = { idle: 'waiting', toTower: 'running to a tower', toHouse: 'fetching crates', refill: 'filling a tower', reload: 'grabbing crates', build: 'building an upgrade', bonked: 'seeing stars!' };
    q('.v-state').textContent = STATE[u.state] ?? u.state;
    q('.v-xp').style.width = `${Math.min(100, (r.xp / this.cfg.RUNNER.xpToNext(r.level)) * 100).toFixed(1)}%`;
    const crates = `${'▣'.repeat(Math.min(u.crates, 8))}${'□'.repeat(Math.max(0, Math.min(r.maxCrates, 8) - u.crates))}`;
    const extra = r.units.length > 1 ? ` + ${r.units.slice(1).map((x) => `${'▣'.repeat(x.crates)}`).join(' ')}` : '';
    if (q('.v-crates').textContent !== crates + extra) q('.v-crates').textContent = crates + extra;
    for (const { id, el } of this.spellEls) {
      const info = r.spellInfo(id);
      const cd = r.cooldownOf(id);
      el.style.setProperty('--cd', (cd / info.cooldown).toFixed(3));
      const t = cd > 0 ? Math.ceil(cd) : '';
      if (el.querySelector('.cd').textContent !== String(t)) el.querySelector('.cd').textContent = t;
      el.classList.toggle('autoon', r.isAutoCast(id));
    }
    const picks = r.pendingPicks;
    const prep = this.sim.waves.phase === PHASE.PREP;
    this.pickBtn.hidden = !picks;
    const label = prep ? `★ Choose ${picks > 1 ? `${picks} perks` : 'a perk'}` : `★ ${picks} perk${picks > 1 ? 's' : ''} after the wave`;
    if (this.pickBtn.textContent !== label) this.pickBtn.textContent = label;
    this.pickBtn.disabled = !prep;
    this.pickBtn.classList.toggle('glow', prep && picks > 0);
    const call = prep && picks > 0 && this.picker.el.hidden;
    this.pickCallout.hidden = !call;
    const callHtml = `★ Choose ${picks > 1 ? `${picks} perks` : 'a perk'}<small>${r.name} reached level ${r.level}</small>`;
    if (call && this.pickCallout.innerHTML !== callHtml) this.pickCallout.innerHTML = callHtml;
    const allOn = r.autoCastAll;
    this.autoAllBtn.classList.toggle('on', allOn);
    this.autoAllBtn.textContent = allOn ? 'AUTO ✓' : 'AUTO';
  }

  setMode(mode) {
    this.currentMode = mode;
    if (mode.kind === 'tower') {
      this.modeEl.innerHTML = `Building <b>${this.cfg.TOWERS[mode.towerType].name}</b>: click free ground, right-click to stop`;
    } else if (mode.kind === 'aim') {
      this.modeEl.innerHTML = 'Aiming: <b>click where it should shoot</b>, right-click to cancel';
    } else {
      this.modeEl.innerHTML = '';
    }
    for (const [key, c] of Object.entries(this.cardEls ?? {})) c.el.classList.toggle('active', mode.kind === 'tower' && mode.towerType === key);
  }

  /** Builds the panel for the selection (or hides it). */
  showSelection(sel) {
    this.selection = sel;
    const sim = this.sim;
    const tower = sel?.kind === 'tower' ? sim.towers.get(sel.id) : null;
    const runner = sel?.kind === 'runner';
    const house = sel?.kind === 'house';
    this.side.hidden = !tower && !runner && !house;
    this.side.innerHTML = '';
    this.side.classList.toggle('wide', !!tower || runner);
    this.dyn = null;
    if (tower) this.#buildTowerPanel(tower);
    else if (runner) this.#buildRunnerPanel();
    else if (house) this.#buildHousePanel();
    this.dyn?.();
  }

  #buildTowerPanel(tower) {
    const sim = this.sim;
    const type = this.cfg.TOWERS[tower.type];
    const R = this.cfg.TOWER_RULES;
    const s = tower.stats;
    const effect = [
      s.aoe ? `area ${fmt(s.aoe, 1)}` : '',
      s.burn ? `burn ${fmt(s.burn.dps, 1)}/s` : '',
      s.stun ? `stun ${fmt(s.stun, 2)}s` : '',
      s.armorPen ? `armor pierce ${Math.round(s.armorPen * 100)}%` : '',
      s.targets > 1 ? `${s.targets} targets` : '',
      s.slow ? `slow ${Math.round((1 - s.slow.factor) * 100)}%` : '',
      s.knock ? `push ${fmt(s.knock, 1)}` : '',
      s.balls > 1 ? `${s.balls} balls` : '',
      s.freezeChance ? `freeze ${Math.round(s.freezeChance * 100)}%` : '',
      s.bossMult ? `x${fmt(s.bossMult, 1)} vs elites and bosses` : '',
    ].filter(Boolean).join(' · ');
    const spec = tower.spec ? type.specs[tower.spec] : null;
    this.side.innerHTML =
      `<div class="hero-head"><div class="portrait t-${tower.type}">${type.icon}</div>`
      + `<div><h3>${type.name}</h3><div class="sub">Level ${tower.level} / ${R.maxLevel}${spec ? ` · <b class="spec-${tower.spec}">${spec.name}</b>` : ''}</div></div></div>`
      + '<div class="row"><span>Ammo</span><b class="v-ammo"></b></div><div class="bar ammo"><div class="v-ammobar"></div></div>'
      + `<div class="row"><span>Damage</span><b>${fmt(s.damage, 1)} ${s.damageType}</b></div>`
      + `<div class="row"><span>Attacks / s</span><b>${fmt(1 / s.interval, 2)}</b></div>`
      + '<div class="row"><span>Range</span><b class="v-range"></b></div>'
      + (effect ? `<div class="row"><span>Effect</span><b>${effect}</b></div>` : '')
      + '<div class="row v-buffrow"><span>Boosted</span><b class="v-buff"></b></div>'
      + '<div class="row"><span>DPS last wave</span><b class="v-dps"></b></div>'
      + '<div class="row"><span>Kills</span><b class="v-kills"></b></div>';
    // Who it can hurt: stealth, ghosts (no physical), ironclads (no sharp).
    const Z = this.cfg.ZOMBIES;
    const can = (zt) => !(Z[zt].immune?.includes(s.damageType)) && !(s.tags && Z[zt].immuneTags?.some((x) => s.tags.includes(x)));
    const mark = (ok) => (ok ? '<b class="yes">✓</b>' : '<b class="no">✗</b>');
    this.side.insertAdjacentHTML('beforeend',
      `<div class="row hits"><span>Hits</span><span>${mark(s.detect)} stealth${s.reveal ? ' (reveals)' : ''} · ${mark(can('ghost'))} ghosts · ${mark(can('ironclad'))} ironclads</span></div>`);
    if (s.aimed) {
      const aim = h('button', 'btn', 'Aim: choose where it shoots');
      aim.addEventListener('click', () => this.actions.aim(tower.id));
      this.side.append(aim);
    }
    const send = h('button', 'btn sendbtn', 'Send the runner with a crate <span class="k">R</span>');
    send.addEventListener('click', () => this.actions.order(tower.id));
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
    // Aimed towers shoot along their line: no target choice.
    this.side.append(send);
    if (!s.aimed) this.side.append(tRow);
    // Upgrade: a plain button, or the two specialisations side by side at the spec level.
    const upWrap = h('div', 'upwrap');
    this.side.append(upWrap);
    const specBtns = [];
    let upgrade = null;
    let building = null;
    if (tower.pending) {
      building = h('div', 'buildbox',
        `<div class="row"><span>Upgrading to level ${tower.pending.level}</span><b class="v-bstate"></b></div>`
        + '<div class="bar build"><div class="v-bbar"></div></div>');
      upWrap.append(building);
    } else if (sim.towers.needsSpec(tower.id)) {
      upWrap.append(h('div', 'section', `Level ${tower.level + 1}: choose a specialisation`));
      const row = h('div', 'specrow');
      for (const k of ['a', 'b']) {
        const sp = type.specs[k];
        const b = h('button', `btn specbtn spec-${k}`, `<b>${sp.name}</b><span>${sp.text}</span><span class="c"></span>`);
        b.addEventListener('click', () => {
          const r = sim.towers.canUpgrade(tower.id, k);
          if (r.ok) sim.towers.upgrade(tower.id, k); else this.toast(r.reason === 'insufficient_gold' ? 'Not enough gold' : 'Cannot upgrade');
        });
        row.append(b);
        specBtns.push(b);
      }
      upWrap.append(row);
    } else {
      upgrade = h('button', 'btn');
      upgrade.addEventListener('click', () => {
        const r = sim.towers.canUpgrade(tower.id);
        if (r.ok) sim.towers.upgrade(tower.id);
        else this.toast(r.reason === 'max_level' ? 'Already at maximum level' : 'Not enough gold');
      });
      upWrap.append(upgrade);
    }
    const sell = h('button', 'btn danger');
    sell.addEventListener('click', () => this.confirmSell(tower.id, sell));
    this.side.append(sell);
    const next = tower.level < R.maxLevel && !sim.towers.needsSpec(tower.id) ? towerStats(type, tower.level + 1, tower.spec, R) : null;
    const q = (c) => this.side.querySelector(c);
    this.dyn = () => {
      const frac = tower.ammo / tower.stats.maxAmmo;
      q('.v-ammo').textContent = `${Math.floor(tower.ammo)} / ${tower.stats.maxAmmo}${sim.towers.time < tower.jammedUntil ? ' (jammed!)' : ''}`;
      q('.v-ammobar').style.width = `${(frac * 100).toFixed(1)}%`;
      q('.v-ammobar').style.background = frac < R.lowAmmo ? 'var(--red)' : '#5aa8ff';
      q('.v-range').textContent = fmt(sim.towers.rangeOf(tower), 1);
      q('.v-dps').textContent = tower.lastWaveDps ? fmt(tower.lastWaveDps, 1) : '—';
      q('.v-kills').textContent = tower.kills;
      const m = sim.towers.modsOf(tower);
      const boosts = [
        m.attackSpeedPct ? `+${Math.round(m.attackSpeedPct)}% speed` : '',
        m.damagePct ? `+${Math.round(m.damagePct)}% dmg` : '',
        m.critAdd ? `+${Math.round(m.critAdd)}% crit` : '',
        m.rangeAdd ? `+${fmt(m.rangeAdd, 1)} range` : '',
        m.freeAmmo ? 'free ammo' : '',
        m.gunk < 1 ? 'gummed up!' : '',
      ].filter(Boolean).join(' · ');
      q('.v-buffrow').style.display = boosts ? '' : 'none';
      q('.v-buff').textContent = boosts;
      if (building) {
        const st = sim.towers.isBuilding(tower) ? `building ${Math.round(sim.towers.buildProgress(tower) * 100)}%` : `waiting for ${sim.runner.name.split(' ')[0]}`;
        if (q('.v-bstate').textContent !== st) q('.v-bstate').textContent = st;
        q('.v-bbar').style.width = `${(sim.towers.buildProgress(tower) * 100).toFixed(1)}%`;
      }
      const cost = sim.towers.upgradeCost(tower.id);
      if (upgrade) {
        const ul = next ? `Upgrade to level ${tower.level + 1} (dmg ${fmt(next.damage, 1)}) for ${cost} gold <span class="k">U</span>` : 'Fully upgraded';
        if (upgrade.innerHTML !== ul) upgrade.innerHTML = ul;
        upgrade.disabled = !next || !sim.economy.canAfford(cost);
      }
      for (const b of specBtns) {
        const c = b.querySelector('.c');
        if (c.textContent !== `${cost} gold`) c.textContent = `${cost} gold`;
        b.disabled = !sim.economy.canAfford(cost);
      }
      if (!sell.dataset.armed) {
        const sl = `Sell for ${sim.towers.sellValue(tower.id)} gold <span class="k">Del</span>`;
        if (sell.innerHTML !== sl) sell.innerHTML = sl;
      }
    };
  }

  /** Selling a tower that cost a lot takes two clicks. */
  confirmSell(id, btn = null) {
    const sim = this.sim;
    if (this.sellArmed === id) {
      this.sellArmed = null;
      sim.towers.sell(id);
      return;
    }
    this.sellArmed = id;
    this.toast(`Sell for ${sim.towers.sellValue(id)} gold? Click Sell (or Del) again.`);
    if (btn) { btn.dataset.armed = '1'; btn.innerHTML = 'Click again to sell'; }
    setTimeout(() => { if (this.sellArmed === id) this.sellArmed = null; }, 2500);
  }

  #buildRunnerPanel() {
    const r = this.sim.runner;
    const RARITY = this.cfg.RARITY_INFO;
    const perks = Object.entries(r.perks).map(([id, rank]) => {
      const p = this.cfg.RUNNER_PERKS[id];
      return `<span class="chip" style="--rc:${RARITY[p.rarity].color}" title="${p.text(rank)}">${p.name}${rank > 1 ? ` ×${rank}` : ''}</span>`;
    }).join('');
    this.side.innerHTML =
      `<div class="hero-head"><div class="portrait runnerface">☺</div><div><h3>${r.name}</h3><div class="sub">${this.cfg.RUNNER.title} · Level ${r.level}</div></div></div>`
      + '<div class="row"><span>XP</span><b class="v-xp"></b></div>'
      + `<div class="row"><span>Crates</span><b>${r.maxCrates}${r.units.length > 1 ? ` each (${r.units.length} runners)` : ''}</b></div>`
      + `<div class="row"><span>Speed</span><b>${fmt(r.speed, 1)} cells/s</b></div>`
      + `<div class="row"><span>Spell reach</span><b>${fmt(r.spellRadius, 1)}</b></div>`
      + '<div class="row"><span>Refills / knocked over</span><b class="v-stats"></b></div>'
      + `<div class="section">Perks</div><div class="owned">${perks || '<span class="dim">None yet: every level brings a pick.</span>'}</div>`
      + '<div class="section">Spells (right-click a spell for auto-cast)</div>'
      + Object.keys(r.spells).map((id) => {
        const info = r.spellInfo(id);
        return `<div class="row"><span>${info.def.icon} ${info.def.name}${info.rank > 1 ? ` (rank ${info.rank})` : ''}</span><b>${fmt(info.cooldown, 0)}s</b></div><div class="spelltext">${info.def.text}${info.duration ? ` (${fmt(info.duration, 1)}s)` : ''}</div>`;
      }).join('');
    const q = (c) => this.side.querySelector(c);
    this.dyn = () => {
      q('.v-xp').textContent = `${Math.floor(r.xp)} / ${this.cfg.RUNNER.xpToNext(r.level)}`;
      q('.v-stats').textContent = `${r.stats.refills} / ${r.stats.bonks}`;
    };
  }

  #buildHousePanel() {
    const house = this.sim.house;
    this.side.innerHTML =
      '<h3>The House</h3><div class="sub">Every zombie that gets in hurts it. If it falls, the run is over.</div>'
      + '<div class="row"><span>Health</span><b class="v-hp"></b></div><div class="bar"><div class="v-bar"></div></div>';
    const repair = h('button', 'btn');
    repair.addEventListener('click', () => { if (!house.repair()) this.toast(this.sim.waves.phase === PHASE.PREP ? 'Not enough gold' : 'Repairs only between waves'); });
    this.side.append(repair);
    const q = (c) => this.side.querySelector(c);
    this.dyn = () => {
      const r = house.hp / house.maxHp;
      q('.v-hp').textContent = `${Math.ceil(house.hp)} / ${house.maxHp}`;
      q('.v-bar').style.width = `${(r * 100).toFixed(1)}%`;
      q('.v-bar').style.background = barColor(r);
      const cost = house.repairCost();
      const prep = this.sim.waves.phase === PHASE.PREP;
      const rl = !cost ? 'Fully repaired' : prep ? `Repair for ${cost} gold` : `Repair between waves (${cost} gold)`;
      if (repair.innerHTML !== rl) repair.innerHTML = rl;
      repair.disabled = !cost || !prep || !this.sim.economy.canAfford(cost);
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
    const t = sim.towers;
    const full = t.count >= t.slots;
    for (const c of Object.values(this.cardEls ?? {})) {
      const cost = c.cost();
      c.el.querySelector('.cost').textContent = full ? 'No free slot' : `${cost} gold`;
      c.el.classList.toggle('unaffordable', full || gold < cost);
    }
    const nextAt = t.nextSlotWave;
    this.vSlots.textContent = `${t.count} / ${t.slots}`;
    this.vSlots.parentElement.title = `Towers built / tower slots.${nextAt ? ` Next slot at wave ${nextAt}.` : ' All slots open.'}`;
    this.vSlots.parentElement.classList.toggle('alert', full);
    const sel = this.selection;
    if (sel?.kind === 'tower' && !t.get(sel.id)) this.showSelection(null);
  }

  /** Per-frame values (countdown, enemies, house, panels). */
  tick(dt = 0) {
    const sim = this.sim, w = sim.waves;
    this.vWave.textContent = w.phase === PHASE.ACTIVE ? w.wave : `${w.nextWave}`;
    this.vEnemies.textContent = w.phase === PHASE.ACTIVE ? w.remaining : '—';
    const prep = w.phase === PHASE.PREP;
    const timer = prep ? ` <span class="k">${fmtTime(Math.max(0, w.countdown))}</span>` : '';
    const label = w.wave === 0 ? `Start wave 1${timer}` : `Next wave ${w.nextWave}${timer}`;
    if (this.waveBtn.innerHTML !== label) this.waveBtn.innerHTML = label;
    this.waveBtn.title = w.wave === 0 ? 'Start the first wave (Enter)'
      : 'Call the next wave now (Enter). Called waves only count toward your record once they are cleared.';
    const house = sim.house;
    const r = house.hp / house.maxHp;
    this.vHouseBar.style.width = `${(r * 100).toFixed(1)}%`;
    this.vHouseBar.style.background = barColor(r);
    this.vHouse.textContent = Math.ceil(house.hp);
    this.houseFlash = Math.max(0, (this.houseFlash ?? 0) - dt);
    this.houseStat.classList.toggle('hit', this.houseFlash > 0);
    this.vignette.classList.toggle('on', house.endangered);
    if (house.endangered && !this.lastHouseWarn) this.toast('The house is about to fall!', 'alert');
    this.lastHouseWarn = house.endangered;
    const paused = this.actions.isPaused();
    this.pauseBtn.textContent = paused ? '▶' : '❚❚';
    this.pauseBtn.classList.toggle('active', paused);
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', this.actions.getSpeed() === GAME_SPEEDS[i]));
    const ml = this.actions.isMuted() ? 'Sound off' : 'Sound';
    if (this.muteBtn.textContent !== ml) this.muteBtn.textContent = ml;
    this.muteBtn.classList.toggle('active', this.actions.isMuted());

    const boss = sim.zombies.bosses[0];
    this.bossBar.hidden = !boss;
    if (boss) {
      const name = `${boss.elite ? 'Elite ' : ''}${this.cfg.ZOMBIES[boss.type].name}`;
      const nameEl = this.bossBar.querySelector('.bname');
      if (nameEl.textContent !== name) nameEl.textContent = name;
      this.bossBar.querySelector('.bar > div').style.width = `${((boss.hp / boss.maxHp) * 100).toFixed(1)}%`;
    }

    // Upcoming wave preview during preparation (and which roads open).
    let pv = '';
    if (prep) {
      const comp = w.preview();
      const trait = (z) => (z.stealth ? ' <b class="trait">stealth</b>' : z.immune ? ' <b class="trait">no physical</b>' : z.immuneTags ? ' <b class="trait">no sharp</b>' : z.regen ? ' <b class="trait">regrows</b>' : '');
      const parts = comp.groups.map((g) => `${g.count} ${this.cfg.ZOMBIES[g.type].name}${g.count > 1 ? 's' : ''}${trait(this.cfg.ZOMBIES[g.type])}`);
      const v = w.variantInfo(comp.variant);
      const newRoads = sim.paths.filter((p) => p.from === w.nextWave && p.from > 1).length;
      pv = `<span class="label">Next wave</span> `
        + (v.label ? `<b class="variant v-${comp.variant}">${v.label}</b> ` : '')
        + parts.join(' · ')
        + (comp.boss ? ` · <b class="boss">BOSS: ${this.cfg.ZOMBIES[comp.boss].name}</b>` : '')
        + (comp.eliteChance ? ` · <span class="elite">elites ${Math.round(comp.eliteChance * 100)}%</span>` : '')
        + (newRoads ? ` · <b class="boss">A NEW ROAD OPENS!</b>` : '');
    }
    if (this.preview.innerHTML !== pv) this.preview.innerHTML = pv;
    this.preview.hidden = !pv;

    // Towers low on ammo (click to send the runner).
    const low = [...sim.towers.all()].filter((t) => t.ammo / t.stats.maxAmmo < this.cfg.TOWER_RULES.lowAmmo)
      .sort((a, b) => a.ammo / a.stats.maxAmmo - b.ammo / b.stats.maxAmmo);
    const key = low.map((t) => `${t.id}:${t.ammo < 1 ? 0 : 1}${sim.runner.orders.includes(t.id) ? 'o' : ''}`).join(',');
    if (key !== this.alertKey) {
      this.alertKey = key;
      this.alerts.innerHTML = '';
      this.alerts.hidden = !low.length;
      if (low.length) this.alerts.append(h('span', 'label', 'Low ammo'));
      for (const t of low.slice(0, 6)) {
        const type = this.cfg.TOWERS[t.type];
        const ordered = sim.runner.orders.includes(t.id);
        const b = h('button', `chip ammochip${t.ammo < 1 ? ' empty' : ''}${ordered ? ' ordered' : ''}`, `${type.icon} ${type.name}${ordered ? ' ✓' : ''}`);
        b.title = 'Click: send the runner here first';
        b.addEventListener('click', () => { this.actions.order(t.id); this.actions.select({ kind: 'tower', id: t.id }); });
        this.alerts.append(b);
      }
    }
    this.#tickRunnerBar();
    this.picker.tick();
    this.meter.tick(false, 1 / 60);
    this.meter.setSelected(this.selection?.kind === 'tower' ? this.selection.id : 0);
    this.dyn?.();
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
    setTimeout(() => t.remove(), kind === 'long' ? 7000 : 2600);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  dispose() {
    this.picker.close();
    this.meter.dispose();
    this.el.remove();
  }
}

/** Runner perk picker: three cards, between waves only. Holds game time while open. */
class PerkPicker {
  constructor(hud) {
    this.hud = hud;
    this.el = h('div', 'picker');
    this.el.hidden = true;
    hud.el.append(this.el);
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
  }

  open() {
    const sim = this.hud.sim, r = sim.runner;
    const offer = r.currentOffer();
    if (!offer || sim.waves.phase !== PHASE.PREP) return;
    this.hud.actions.holdTime(true);
    this.el.hidden = false;
    this.el.innerHTML = '';
    const box = h('div', 'pickbox', `<h2>${r.name} learns a new trick</h2><div class="dim">Level ${r.level} · ${r.pendingPicks} pick${r.pendingPicks > 1 ? 's' : ''} waiting</div>`);
    const row = h('div', 'pickrow');
    const C = this.hud.cfg;
    offer.forEach((id, i) => {
      const p = C.RUNNER_PERKS[id];
      const rank = r.nextRank(id);
      const color = C.RARITY_INFO[p.rarity].color;
      let desc, tag;
      if (p.spell) {
        const sp = C.SPELLS[p.spell];
        desc = rank > 1 ? `${sp.icon} ${sp.name} gets stronger: longer, more powerful, faster to recharge.` : `${sp.icon} New spell: ${sp.text}`;
        tag = rank > 1 ? `Spell rank ${rank}` : 'New spell';
      } else {
        desc = p.text(rank);
        tag = rank > 1 ? `Rank ${rank} / ${p.maxRank}` : (p.maxRank > 1 ? `Up to rank ${p.maxRank}` : 'Unique');
      }
      const card = h('button', `pickcard r-${p.rarity}`,
        `<span class="rarity" style="color:${color}">${C.RARITY_INFO[p.rarity].name}</span>`
        + `<div class="pname">${p.spell ? C.SPELLS[p.spell].name : p.name}</div><div class="pdesc">${desc}</div><div class="ptags">${tag}</div>`);
      card.style.setProperty('--rc', color);
      card.addEventListener('click', () => {
        r.choose(i);
        if (r.pendingPicks > 0) this.open(); else this.close();
      });
      row.append(card);
    });
    const later = h('button', 'btn', 'Later');
    later.style.width = 'auto';
    later.addEventListener('click', () => this.close());
    box.append(row, later);
    this.el.append(box);
  }

  close() {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.hud.actions.holdTime(false);
  }

  tick() {
    // A wave started under the open picker (it cannot, time is held) or picks ran out.
    if (!this.el.hidden && (!this.hud.sim.runner.pendingPicks || this.hud.sim.waves.phase !== PHASE.PREP)) this.close();
  }
}

function barColor(r) {
  return r > 0.6 ? 'var(--green)' : r > 0.3 ? 'var(--gold)' : 'var(--red)';
}
