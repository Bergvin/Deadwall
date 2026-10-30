// Damage meter on the left edge: every tower ranked by the damage it has done, with a bar
// relative to the best one. "Wave" shows the wave being fought (or the last one between
// waves), "Total" the whole run. Click a row to select that tower. Replaces damage numbers
// over the enemies. Rows are rebuilt only when the order or the set of towers changes.

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);

export class DamageMeter {
  /**
   * @param {HTMLElement} parent
   * @param {import('../core/simulation.js').Simulation} sim
   * @param {{select: (sel: object) => void}} actions
   */
  constructor(parent, sim, actions) {
    this.sim = sim;
    this.actions = actions;
    this.mode = 'wave';
    this.selectedId = 0;
    this.el = h('div', 'dmeter');
    const head = h('div', 'dhead', '<span class="label">Damage</span>');
    this.modeBtns = {};
    for (const [k, label] of [['wave', 'Wave'], ['total', 'Total']]) {
      const b = h('button', 'dsort', label);
      b.addEventListener('click', () => { this.mode = k; this.key = ''; this.tick(true); });
      head.append(b);
      this.modeBtns[k] = b;
    }
    this.list = h('div', 'dlist');
    this.el.append(head, this.list);
    parent.append(this.el);
    this.key = '';
    this.timer = 0;
    this.tick(true);
  }

  setSelected(id) {
    this.selectedId = id;
    for (const r of this.list.children) r.classList.toggle('selected', Number(r.dataset.id) === id);
  }

  #value(t) {
    if (this.mode === 'total') return t.totalDamage;
    // Between waves the wave column shows the wave that just ended.
    return this.sim.waves.phase === 'active' ? t.waveDamage : t.lastWaveDamage;
  }

  /** Call every frame; updates about four times a second. */
  tick(force = false, dt = 0) {
    this.timer -= dt;
    if (!force && this.timer > 0) return;
    this.timer = 0.25;
    const T = this.sim.config.TOWERS;
    const rows = [...this.sim.towers.all()].map((t) => ({ t, v: this.#value(t) })).sort((a, b) => b.v - a.v);
    for (const [k, b] of Object.entries(this.modeBtns)) b.classList.toggle('active', k === this.mode);
    this.el.hidden = !rows.length;
    const max = Math.max(1, rows[0]?.v ?? 1);
    const total = rows.reduce((a, r) => a + r.v, 0) || 1;
    const key = rows.map((r) => `${r.t.id}:${r.t.level}`).join(',');
    if (key !== this.key) {
      this.key = key;
      this.list.innerHTML = '';
      for (const { t } of rows) {
        const type = T[t.type];
        const row = h('div', `drow${t.id === this.selectedId ? ' selected' : ''}`,
          `<span class="dicon" style="color:#${type.color.toString(16).padStart(6, '0')}">${type.icon}</span>`
          + `<span class="dname">${type.name} <i>${t.level}</i></span><span class="dval"></span>`
          + '<div class="dbar"><div></div></div>');
        row.dataset.id = t.id;
        row.title = 'Click to select this tower';
        row.addEventListener('click', () => this.actions.select({ kind: 'tower', id: t.id }));
        this.list.append(row);
      }
    }
    rows.forEach(({ t, v }, i) => {
      const row = this.list.children[i];
      const text = `${short(v)} <span class="dpct">${Math.round((v / total) * 100)}%</span>`;
      const val = row.querySelector('.dval');
      if (val.innerHTML !== text) val.innerHTML = text;
      row.querySelector('.dbar > div').style.width = `${((v / max) * 100).toFixed(1)}%`;
      row.querySelector('.dbar > div').style.background = `#${T[t.type].color.toString(16).padStart(6, '0')}`;
    });
  }

  dispose() {
    this.el.remove();
  }
}
