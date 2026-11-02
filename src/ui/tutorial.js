// The tutorial in a run: guided steps (centred cards that hold game time, or a hint box that
// waits for the player and makes the HUD element it talks about glow), an introduction card
// the first time each kind of enemy turns up, and the guide (? button) with every enemy and
// tower. Steps and texts live in config/tutorial.js; progress is saved through `store`.
import { ENEMY_GUIDE, TRAIT_LABELS, TUTORIAL_STEPS } from '../config/tutorial.js';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

export class Tutorial {
  /**
   * @param {import('./hud.js').Hud} hud
   * @param {{enabled: boolean, steps: string[], enemies: string[], mark: (kind: 'steps'|'enemies', id: string) => void}} store
   */
  constructor(hud, store) {
    this.hud = hud;
    this.sim = hud.sim;
    this.cfg = hud.cfg;
    this.store = store;
    this.enabled = !!store?.enabled;
    this.done = new Set(store?.steps ?? []);
    this.seen = new Set(store?.enemies ?? []);
    this.ctx = { specLevel: this.cfg.TOWER_RULES.specLevel };
    this.queue = []; // modal cards waiting: {title, html}
    this.modal = null;
    this.hint = null; // {step, el, pointed, off}

    this.layer = h('div', 'tutlayer');
    this.layer.hidden = true;
    this.coach = h('div', 'coach');
    this.coach.hidden = true;
    hud.el.append(this.layer, this.coach);
    this.layer.addEventListener('pointerdown', (e) => { if (e.target === this.layer) this.#closeModal(); });
    // While a card is up, Enter / Space / Esc close it instead of reaching the game.
    this.abort = new AbortController();
    addEventListener('keydown', (e) => {
      if (!this.modal || !['Enter', 'NumpadEnter', 'Space', 'Escape'].includes(e.code)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.#closeModal();
    }, { capture: true, signal: this.abort.signal });

    // The run is over: nothing more to explain.
    this.sim.events.on('gameOver', () => {
      this.queue = [];
      this.#closeModal();
      this.coach.hidden = true;
      this.enabled = false;
    });
    this.sim.events.on('zombieSpawned', (z) => {
      if (!this.enabled || this.sim.over || this.seen.has(z.type)) return;
      this.seen.add(z.type);
      this.store.mark('enemies', z.type);
      this.queue.push(this.enemyCard(z.type, true));
    });
  }

  // --- guided steps ------------------------------------------------------
  tick() {
    if (this.sim.over) return;
    if (!this.modal && this.queue.length && this.hud.picker.el.hidden) this.#openModal(this.queue.shift());
    if (!this.enabled || this.modal) return;
    if (this.hint) {
      if (this.hint.step.done?.(this.sim)) this.#finishHint();
      return;
    }
    const step = TUTORIAL_STEPS.find((s) => !this.done.has(s.id)
      && (s.after ?? []).every((a) => this.done.has(a)) && s.when(this.sim, this.ctx));
    if (!step) return;
    if (step.done?.(this.sim)) {
      this.#complete(step.id);
    } else if (step.card) {
      this.#complete(step.id);
      this.#openModal({ title: step.title, html: `<p>${step.text}</p>`, skip: true });
    } else {
      this.#showHint(step);
    }
  }

  #complete(id) {
    if (this.done.has(id)) return;
    this.done.add(id);
    this.store.mark('steps', id);
  }

  #showHint(step) {
    this.coach.innerHTML = `<div class="ctitle">${step.title}</div><div class="ctext">${step.text}</div>`;
    const row = h('div', 'cbtns');
    const ok = h('button', 'btn', 'Got it');
    ok.addEventListener('click', () => this.#finishHint());
    const skip = h('button', 'btn ghost', 'Skip tutorial');
    skip.addEventListener('click', () => this.skipAll());
    row.append(ok, skip);
    this.coach.append(row);
    this.coach.hidden = false;
    const pointed = step.point ? this.hud.el.querySelector(step.point) : null;
    pointed?.classList.add('tutpoint');
    this.hint = { step, pointed };
  }

  #finishHint() {
    const hint = this.hint;
    if (!hint) return;
    this.hint = null;
    hint.pointed?.classList.remove('tutpoint');
    this.coach.hidden = true;
    this.#complete(hint.step.id);
  }

  /** Marks every step done (enemy cards keep coming). */
  skipAll() {
    this.#finishHint();
    for (const s of TUTORIAL_STEPS) this.#complete(s.id);
    if (this.modal) this.#closeModal();
  }

  // --- cards ---------------------------------------------------------------
  #openModal(card) {
    this.modal = card;
    this.hud.actions.holdTime(true, 'tutorial');
    this.layer.hidden = false;
    this.layer.innerHTML = '';
    const box = h('div', `tutbox${card.wide ? ' wide' : ''}`, `${card.kicker ? `<div class="kicker">${card.kicker}</div>` : ''}<h2>${card.title}</h2>`);
    const body = h('div', 'tutbody', card.html);
    const row = h('div', 'cbtns');
    const ok = h('button', 'btn primary', card.button ?? 'Got it');
    ok.addEventListener('click', () => this.#closeModal());
    row.append(ok);
    if (card.skip) {
      const skip = h('button', 'btn ghost', 'Skip tutorial');
      skip.addEventListener('click', () => this.skipAll());
      row.append(skip);
    }
    box.append(body, row);
    card.mount?.(body);
    this.layer.append(box);
    ok.focus();
  }

  #closeModal() {
    if (!this.modal) return;
    this.modal = null;
    this.layer.hidden = true;
    this.layer.innerHTML = '';
    this.hud.actions.holdTime(false, 'tutorial');
  }

  /** The introduction card for one enemy type. */
  enemyCard(type, fresh = false) {
    return {
      kicker: fresh ? 'New enemy' : 'Enemy',
      title: this.cfg.ZOMBIES[type].name,
      html: this.enemyHtml(type),
    };
  }

  enemyHtml(type) {
    const z = this.cfg.ZOMBIES[type];
    const g = ENEMY_GUIDE[type] ?? { good: [], bad: [], tip: '' };
    const traits = [];
    if (z.boss) traits.push(TRAIT_LABELS.boss);
    if (z.stealth) traits.push(TRAIT_LABELS.stealth);
    if (z.immune) traits.push(TRAIT_LABELS.immune(z.immune));
    if (z.immuneTags) traits.push(TRAIT_LABELS.immuneTags(z.immuneTags));
    if (z.regen) traits.push(TRAIT_LABELS.regen);
    if (z.armor >= 0.25) traits.push(TRAIT_LABELS.armor(z.armor));
    if (z.resist >= 0.25) traits.push(TRAIT_LABELS.resist(z.resist));
    const chips = (ids, cls) => ids.map((id) => {
      const t = this.cfg.TOWERS[id];
      return `<span class="tchip ${cls}"><span style="color:${hex(t.color)}">${t.icon}</span> ${t.name.replace(' Tower', '')}</span>`;
    }).join('');
    return `<p class="edesc">${z.description}</p>`
      + (traits.length ? `<div class="traits">${traits.map((t) => `<span class="trait">${t}</span>`).join('')}</div>` : '')
      + `<div class="match"><div class="mlabel good">Works well</div><div class="mchips">${chips(g.good, 'good') || '<span class="dim">Anything</span>'}</div></div>`
      + (g.bad.length ? `<div class="match"><div class="mlabel bad">Little or no effect</div><div class="mchips">${chips(g.bad, 'bad')}</div></div>` : '')
      + (g.tip ? `<p class="etip">${g.tip}</p>` : '');
  }

  // --- the guide (? button) ----------------------------------------------
  openGuide() {
    if (this.modal) return;
    const C = this.cfg;
    const enemies = Object.keys(C.ZOMBIES);
    const card = {
      title: 'Field guide', wide: true, button: 'Close',
      html: '<div class="gtabs"><button class="tab active" data-g="enemies">Enemies</button><button class="tab" data-g="towers">Towers</button></div><div class="gbody"></div>',
      mount: (body) => {
        const out = body.querySelector('.gbody');
        const show = (which) => {
          for (const b of body.querySelectorAll('.gtabs .tab')) b.classList.toggle('active', b.dataset.g === which);
          if (which === 'enemies') {
            out.innerHTML = enemies.map((id) => `<div class="gentry"><div class="gname">${C.ZOMBIES[id].name}${this.seen.has(id) || !this.enabled ? '' : ' <span class="dim">(not met yet)</span>'}</div>${this.enemyHtml(id)}</div>`).join('');
          } else {
            out.innerHTML = Object.values(C.TOWERS).map((t) => `<div class="gentry"><div class="gname"><span style="color:${hex(t.color)}">${t.icon}</span> ${t.name} <span class="dim">${t.cost} gold · ${t.damageType}</span></div>`
              + `<p class="edesc">${t.description}</p><div class="match"><div class="mlabel good">Strong</div><div>${t.strengths}</div></div>`
              + `<div class="match"><div class="mlabel bad">Weak</div><div>${t.weaknesses}</div></div>`
              + `<div class="dim">Level ${C.TOWER_RULES.specLevel}: ${t.specs.a.name} (${t.specs.a.text}) or ${t.specs.b.name} (${t.specs.b.text})</div></div>`).join('');
          }
        };
        for (const b of body.querySelectorAll('.gtabs .tab')) b.addEventListener('click', () => show(b.dataset.g));
        show('enemies');
      },
    };
    this.#openModal(card);
  }

  dispose() {
    this.abort.abort();
    if (this.modal) this.#closeModal();
    this.hint = null;
  }
}
