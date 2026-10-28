// Defender roster on the left edge: the champion and every tower, one row each, with level,
// health (champion) and damage per second over the last finished wave. Click selects (and
// highlights) the unit, double click also moves the camera to it. Rows can be sorted by
// last-wave DPS, level or kind. Rows are rebuilt only on roster changes; values update in place.

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};

const SORTS = {
  dps: { label: 'DPS', fn: (a, b) => b.unit.lastWaveDps - a.unit.lastWaveDps || b.unit.level - a.unit.level },
  level: { label: 'Level', fn: (a, b) => b.unit.level - a.unit.level || b.unit.lastWaveDps - a.unit.lastWaveDps },
  class: { label: 'Kind', fn: (a, b) => a.sortKey.localeCompare(b.sortKey) || b.unit.level - a.unit.level },
};

export class HeroRoster {
  /**
   * @param {HTMLElement} parent
   * @param {import('../core/simulation.js').Simulation} sim
   * @param {{select: (sel: object) => void, focus: (sel: object) => void}} actions
   */
  constructor(parent, sim, actions) {
    this.sim = sim;
    this.actions = actions;
    this.sort = 'dps';
    this.selectedId = 0;
    this.rows = new Map(); // unit id -> {el, entry, hp, dps, star}
    this.el = h('div', 'roster');
    const head = h('div', 'rhead', '<span class="label">Defenders</span>');
    this.sortBtns = {};
    for (const [key, s] of Object.entries(SORTS)) {
      const b = h('button', 'rsort', s.label);
      b.title = `Sort by ${s.label}`;
      b.addEventListener('click', () => { this.sort = key; this.rebuild(); });
      head.append(b);
      this.sortBtns[key] = b;
    }
    this.list = h('div', 'rlist');
    this.el.append(head, this.list);
    parent.append(this.el);

    const ev = sim.events;
    for (const t of ['heroRecruited', 'heroLevelUp', 'heroFell', 'heroRevived', 'heroDeployed',
      'heroUnseated', 'waveCleared', 'talentBought', 'heroEquipped', 'heroAbilityChosen', 'towerBuilt', 'towerRemoved', 'towerUpgraded']) {
      ev.on(t, () => this.rebuild());
    }
    this.rebuild();
  }

  setSelected(id) {
    this.selectedId = id;
    for (const [rid, r] of this.rows) r.el.classList.toggle('selected', rid === id);
    this.rows.get(id)?.el.scrollIntoView({ block: 'nearest' });
  }

  /** Champion first-class entries plus one per tower, in a common shape for sorting. */
  #entries() {
    const cfg = this.sim.config;
    const out = [];
    for (const hero of this.sim.heroes.all()) {
      out.push({
        unit: hero, kind: 'hero', sortKey: `0${hero.type}`,
        badge: `<span class="portrait mini c-${hero.type}">${cfg.WEAPON_STYLES?.[hero.type]?.icon ?? cfg.HEROES[hero.type].name[0]}</span>`,
        title: hero.name, sub: `${hero.weapon?.name ?? cfg.HEROES[hero.type].name} · Lv ${hero.level}`,
      });
    }
    for (const t of this.sim.towers.all()) {
      const w = this.sim.walls.get(t.wallId);
      out.push({
        unit: t, kind: 'tower', sortKey: `1${t.type}`,
        badge: `<span class="portrait mini e-${t.type}">${cfg.TOWERS[t.type].element[0]}</span>`,
        title: cfg.TOWERS[t.type].name, sub: `Lv ${t.level} · ${w?.x},${w?.y}`,
      });
    }
    return out;
  }

  rebuild() {
    const entries = this.#entries().sort(SORTS[this.sort].fn);
    for (const [k, b] of Object.entries(this.sortBtns)) b.classList.toggle('active', k === this.sort);
    this.el.hidden = !entries.length;
    this.list.innerHTML = '';
    this.rows.clear();
    entries.forEach((e, i) => {
      const u = e.unit;
      const row = h('div', `rrow ${e.kind}${u.id === this.selectedId ? ' selected' : ''}${u.fallen ? ' fallen' : ''}`,
        `<span class="rank">${this.sort === 'dps' ? i + 1 : ''}</span>${e.badge}`
        + `<span class="rname"><b>${e.title}</b><i>${e.sub}</i></span>`
        + '<span class="rdps"></span><span class="rstar" title="Upgrade available">★</span>'
        + (e.kind === 'hero' ? '<div class="rhp"><div></div></div>' : ''));
      row.title = 'Click to select · double-click to move the camera there';
      const sel = { kind: e.kind, id: u.id };
      row.addEventListener('click', () => this.actions.select(sel));
      row.addEventListener('dblclick', () => this.actions.focus(sel));
      this.list.append(row);
      this.rows.set(u.id, {
        el: row, entry: e,
        hp: row.querySelector('.rhp > div'),
        dps: row.querySelector('.rdps'),
        star: row.querySelector('.rstar'),
      });
    });
    this.tick();
  }

  /** Per-frame values: health, DPS, status, and whether an upgrade is affordable now. */
  tick() {
    const gold = this.sim.economy.gold;
    for (const r of this.rows.values()) {
      const u = r.entry.unit;
      let upgrade;
      if (r.entry.kind === 'hero') {
        r.hp.style.width = `${((u.hp / u.maxHp) * 100).toFixed(0)}%`;
        r.hp.style.background = u.fallen || u.hp / u.maxHp <= 0.35 ? 'var(--red)' : '#6fa8ff';
        upgrade = !u.fallen && (u.pendingPicks > 0 || this.sim.heroes.talentTiers(u).some((t) => t.unlocked && !t.chosen && gold >= t.cost));
        r.el.classList.toggle('reserve', !u.wallId && !u.fallen);
      } else {
        const cost = this.sim.towers.upgradeCost(u.id);
        upgrade = cost > 0 && gold >= cost;
      }
      const dps = u.fallen ? 'fallen' : u.lastWaveDps ? `${u.lastWaveDps.toFixed(1)}` : '—';
      if (r.dps.textContent !== dps) r.dps.textContent = dps;
      r.star.style.visibility = upgrade ? 'visible' : 'hidden';
    }
  }

  dispose() {
    this.el.remove();
  }
}
