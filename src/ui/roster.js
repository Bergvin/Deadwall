// Hero roster on the left edge: one row per hero with class, level, health and damage per
// second over the last finished wave. Click selects (and highlights) the hero, double click
// also moves the camera to it. Rows can be sorted by last-wave DPS, level or class.
// Rows are rebuilt only on roster changes; health, DPS and upgrade markers update in place.

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};

const SORTS = {
  dps: { label: 'DPS', fn: (a, b) => b.lastWaveDps - a.lastWaveDps || b.level - a.level },
  level: { label: 'Level', fn: (a, b) => b.level - a.level || b.lastWaveDps - a.lastWaveDps },
  class: { label: 'Class', fn: (a, b) => a.type.localeCompare(b.type) || b.level - a.level },
};

export class HeroRoster {
  /**
   * @param {HTMLElement} parent
   * @param {import('../core/simulation.js').Simulation} sim
   * @param {{select: (sel: object) => void, focus: (heroId: number) => void}} actions
   */
  constructor(parent, sim, actions) {
    this.sim = sim;
    this.actions = actions;
    this.sort = 'dps';
    this.selectedId = 0;
    this.rows = new Map(); // heroId -> {el, hp, dps, star}
    this.el = h('div', 'roster');
    const head = h('div', 'rhead', '<span class="label">Heroes</span>');
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
    for (const t of ['heroRecruited', 'heroDismissed', 'heroLevelUp', 'heroFell', 'heroRevived',
      'heroDeployed', 'heroUnseated', 'waveCleared', 'talentBought']) ev.on(t, () => this.rebuild());
    this.rebuild();
  }

  setSelected(heroId) {
    this.selectedId = heroId;
    for (const [id, r] of this.rows) r.el.classList.toggle('selected', id === heroId);
    this.rows.get(heroId)?.el.scrollIntoView({ block: 'nearest' });
  }

  rebuild() {
    const heroes = [...this.sim.heroes.all()].sort(SORTS[this.sort].fn);
    for (const [k, b] of Object.entries(this.sortBtns)) b.classList.toggle('active', k === this.sort);
    this.el.hidden = !heroes.length;
    this.list.innerHTML = '';
    this.rows.clear();
    const cfg = this.sim.config.HEROES;
    heroes.forEach((hero, i) => {
      const row = h('div', `rrow${hero.id === this.selectedId ? ' selected' : ''}${hero.fallen ? ' fallen' : ''}`,
        `<span class="rank">${this.sort === 'dps' ? i + 1 : ''}</span>`
        + `<span class="portrait mini c-${hero.type}">${cfg[hero.type].name[0]}</span>`
        + `<span class="rname"><b>${hero.name}</b><i>${cfg[hero.type].name} · Lv ${hero.level}</i></span>`
        + '<span class="rdps"></span><span class="rstar" title="Upgrade available">★</span>'
        + '<div class="rhp"><div></div></div>');
      row.title = 'Click to select · double-click to move the camera there';
      row.addEventListener('click', () => this.actions.select({ kind: 'hero', id: hero.id }));
      row.addEventListener('dblclick', () => this.actions.focus(hero.id));
      this.list.append(row);
      this.rows.set(hero.id, {
        el: row, hero,
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
      const hero = r.hero;
      r.hp.style.width = `${((hero.hp / hero.maxHp) * 100).toFixed(0)}%`;
      r.hp.style.background = hero.fallen ? 'var(--red)' : hero.hp / hero.maxHp > 0.35 ? '#6fa8ff' : 'var(--red)';
      const dps = hero.fallen ? 'fallen' : hero.lastWaveDps ? `${hero.lastWaveDps.toFixed(1)}` : '—';
      if (r.dps.textContent !== dps) r.dps.textContent = dps;
      const upgrade = !hero.fallen && this.sim.heroes.talentTiers(hero)
        .some((t) => t.unlocked && !t.chosen && gold >= t.cost);
      r.star.style.visibility = upgrade ? 'visible' : 'hidden';
      r.el.classList.toggle('reserve', !hero.wallId && !hero.fallen);
    }
  }

  dispose() {
    this.el.remove();
  }
}
