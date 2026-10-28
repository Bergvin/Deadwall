// Hero UI: the hero panel (stats, abilities, equipment, bag), the level-up pick overlay
// (three cards, chosen between waves) and the small notice that picks are waiting.
// Rendering only; every change goes through HeroSystem / CombatSystem.
import { RARITY_INFO } from '../config/rarities.js';
import { itemLines, abilityFits } from '../core/heroBuild.js';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const fmt = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toString();
const color = (r) => RARITY_INFO[r]?.color ?? '#ccc';
const rarityTag = (r) => `<span class="rarity" style="color:${color(r)}">${RARITY_INFO[r].name}</span>`;
const ABILITY_KEYS = ['Q', 'E', 'F', 'G', 'H'];

/** The weapon's display name with its style and rarity colour. */
export function weaponLabel(cfg, hero) {
  const w = hero.weapon;
  return w ? `<span style="color:${color(w.rarity)}">${w.name}</span>` : cfg.HEROES[hero.type].name;
}

/** One item as a tile (equipped slot or bag entry). */
function itemTile(cfg, item, { slotName, actions = [] } = {}) {
  const tile = h('div', `itemtile${item ? '' : ' empty'}`);
  if (!item) {
    tile.innerHTML = `<div class="iname dim">${slotName}: empty</div>`;
    return tile;
  }
  tile.style.setProperty('--rc', color(item.rarity));
  tile.innerHTML = `<div class="iname">${slotName ? `<span class="dim">${slotName}:</span> ` : ''}${item.name}</div>`
    + `<div class="ilines">${rarityTag(item.rarity)} · ${itemLines(cfg, item).join(' · ')}</div>`;
  if (actions.length) {
    const row = h('div', 'iactions');
    for (const a of actions) row.append(a);
    tile.append(row);
  }
  return tile;
}

/**
 * Builds the hero panel into hud.side and returns a per-frame updater.
 * @param {import('./hud.js').Hud} hud
 */
export function buildHeroPanel(hud, hero) {
  const sim = hud.sim, cfg = hud.cfg, side = hud.side;
  const s = hero.stats;
  const between = sim.heroes.buildAllowed();
  const row = (label, v) => `<div class="row"><span>${label}</span><b>${v}</b></div>`;
  let stats = row('Damage', fmt(s.damage, 1)) + row('Attacks / s', fmt(1 / s.attackInterval, 2))
    + row('Range', fmt(s.range, 1)) + row('Critical', `${fmt(s.critChance * 100)}% · ${fmt(s.critMultiplier, 1)}x`);
  // Build mechanics, only those the hero actually has.
  const mech = [];
  const add = (cond, text) => { if (cond) mech.push(text); };
  add(s.extraProjectiles, `+${s.extraProjectiles} projectiles`);
  add(s.bounce, `Bounce ×${s.bounce}`);
  add(s.split, `Split ×${s.split}${s.splitGenerations ? ' (again)' : ''}`);
  add(s.pierce, `Pierce ${s.pierce}`);
  add(s.whirlwind, 'Whirlwind');
  add(s.cleavePct, `Cleave ${fmt(s.cleavePct * 100)}%`);
  add(s.knockback, 'Knockback');
  add(s.blastForce, s.blastForce < 0 ? 'Implosions' : 'Blasts');
  add(s.burnPct, `Burn ${fmt(s.burnPct * 100)}%`);
  add(s.poisonPct, `Poison ${fmt(s.poisonPct * 100)}%`);
  add(s.slowPct, `Slow ${fmt(s.slowPct * 100)}%`);
  add(s.chainChance, `Lightning ${fmt(s.chainChance * 100)}%`);
  add(s.critChain, 'Crit cascade');
  add(s.doubleStrike, `Double ${fmt(s.doubleStrike * 100)}%`);
  add(s.frenzyMax, 'Frenzy');
  add(s.corpseBlastPct, 'Corpse blasts');
  add(s.earthshaker, 'Earthshaker');
  add(s.phoenix, 'Phoenix');
  add(s.lifestealPct, `Life steal ${fmt(s.lifestealPct * 100)}%`);
  add(s.damageReduction, `-${fmt(s.damageReduction * 100)}% damage taken`);
  if (mech.length) stats += `<div class="mechs">${mech.map((m) => `<span>${m}</span>`).join('')}</div>`;

  side.innerHTML =
    `<div class="hero-head"><div class="portrait c-${hero.type}">${cfg.WEAPON_STYLES[hero.type].icon}</div>`
    + `<div><h3>${hero.name}</h3><div class="sub">${weaponLabel(cfg, hero)} · Level ${hero.level}</div></div></div>`
    + '<div class="row"><span>Health</span><b class="v-hp"></b></div>'
    + '<div class="row"><span>Experience</span><b class="v-xp"></b></div><div class="bar xp"><div class="v-xpbar"></div></div>'
    + `<div class="stats">${stats}</div>`
    + '<div class="row"><span>Kills</span><b class="v-kills"></b></div>'
    + '<div class="row"><span>Status</span><b class="v-status"></b></div>';

  // Level-up picks.
  if (hero.pendingPicks > 0) {
    const pick = h('button', `btn pickbtn${between ? ' glow' : ''}`,
      `★ Choose ${hero.pendingPicks > 1 ? `${hero.pendingPicks} abilities` : 'a new ability'}${between ? '' : ' (after this wave)'}`);
    pick.disabled = !between;
    pick.addEventListener('click', () => hud.picker.open(hero));
    side.append(pick);
  }

  // Abilities owned.
  const owned = Object.entries(hero.abilities);
  side.append(h('div', 'section', `Abilities <span class="dim">${owned.length ? '' : '· none yet: level up to choose'}</span>`));
  if (owned.length) {
    const list = h('div', 'owned');
    for (const [id, rank] of owned) {
      const a = cfg.HERO_ABILITIES[id];
      const off = !abilityFits(cfg, id, hero.type);
      const chip = h('span', `chip${off ? ' off' : ''}`, `${a.name}${a.maxRank > 1 ? ` ${rank}` : ''}`);
      chip.style.setProperty('--rc', color(a.rarity));
      chip.title = `${RARITY_INFO[a.rarity].name} · ${a.text(rank)}${off ? `\nInactive: needs a ${a.delivery} weapon` : ''}`;
      list.append(chip);
    }
    side.append(list);
  }

  // Active abilities: cooldowns, click to cast by hand.
  const ids = sim.combat.abilityIds(hero);
  const abilBtns = ids.map((id, i) => {
    const a = sim.combat.abilityConfig(hero, id);
    const b = h('button', 'ability', `<span class="key">${ABILITY_KEYS[i] ?? ''}</span><span class="aname">${a.name}</span><span class="cd"></span>`);
    b.title = `${a.description}\nCooldown ${fmt(a.cooldown * s.cooldownMult, 1)}s`;
    b.addEventListener('click', () => hud.actions.useAbility(hero.id, id));
    return { b, a, id };
  });
  if (abilBtns.length) {
    const abil = h('div', 'abilities');
    for (const { b } of abilBtns) abil.append(b);
    side.append(abil);
    const auto = h('label', 'row autocast', '<span>Use abilities automatically</span>');
    const cb = h('input');
    cb.type = 'checkbox';
    cb.checked = hero.autoCast;
    cb.addEventListener('change', () => sim.heroes.setAutoCast(hero.id, cb.checked));
    auto.append(cb);
    side.append(auto);
  }

  // Targeting preference.
  const tgt = h('select', 'targeting');
  for (const [k, label] of Object.entries(cfg.TARGETING)) {
    const o = h('option', '', label);
    o.value = k;
    if (hero.targeting === k) o.selected = true;
    tgt.append(o);
  }
  tgt.addEventListener('change', () => sim.heroes.setTargeting(hero.id, tgt.value));
  const tRow = h('div', 'row', '<span>Target</span>');
  tRow.append(tgt);
  side.append(tRow);

  // Equipment and bag.
  side.append(h('div', 'section', `Equipment${between ? '' : ' <span class="dim">· change between waves</span>'}`));
  side.append(itemTile(cfg, hero.weapon, { slotName: 'Weapon' }));
  side.append(itemTile(cfg, hero.gear.armor, { slotName: 'Armor' }));
  side.append(itemTile(cfg, hero.gear.trinket, { slotName: 'Trinket' }));
  if (hero.bag.length) {
    side.append(h('div', 'section', `Bag <span class="dim">${hero.bag.length} / ${cfg.LOOT.bagSize}</span>`));
    for (const item of [...hero.bag].sort((a, b) => cfg.RARITIES.indexOf(b.rarity) - cfg.RARITIES.indexOf(a.rarity))) {
      const equip = h('button', 'btn small', 'Equip');
      equip.disabled = !between;
      equip.title = between ? '' : 'Equip between waves';
      equip.addEventListener('click', () => { if (sim.heroes.equipItem(hero.id, item.uid)) hud.showSelection(hud.selection); });
      const sell = h('button', 'btn small', `Sell ${RARITY_INFO[item.rarity].salvageGold}g`);
      sell.addEventListener('click', () => { sim.heroes.sellItem(hero.id, item.uid); hud.showSelection(hud.selection); });
      side.append(itemTile(cfg, item, { actions: [equip, sell] }));
    }
  }

  // Revive / move.
  const wall = hero.wallId ? sim.walls.get(hero.wallId) : null;
  let reviveBtn = null;
  if (hero.fallen) {
    reviveBtn = h('button', 'btn wavebtn');
    reviveBtn.addEventListener('click', () => {
      const r = sim.heroes.canRevive(hero.id);
      if (r.ok) sim.heroes.revive(hero.id);
      else hud.toast(r.reason === 'wave_active' ? 'The hero can only be revived between waves' : 'Not enough gold');
    });
    side.append(reviveBtn);
  }
  const move = h('button', 'btn', wall ? 'Move to another 2×2 block <span class="k">M</span>' : 'Place on a 2×2 block of walls');
  move.disabled = hero.fallen;
  move.addEventListener('click', () => hud.actions.deploy(hero.id));
  side.append(move);

  const q = (c) => side.querySelector(c);
  return () => {
    q('.v-hp').textContent = `${Math.ceil(hero.hp)} / ${hero.maxHp}`;
    const need = sim.heroes.xpToNext(hero);
    q('.v-xp').textContent = Number.isFinite(need) ? `${Math.floor(hero.xp)} / ${need}` : 'MAX';
    q('.v-xpbar').style.width = Number.isFinite(need) ? `${Math.min(100, (hero.xp / need) * 100).toFixed(1)}%` : '100%';
    q('.v-kills').textContent = hero.kills;
    const w = hero.wallId ? sim.walls.get(hero.wallId) : null;
    q('.v-status').textContent = hero.fallen ? 'Fallen' : !w ? 'In reserve' : hero.moving > 0 ? `Moving (${fmt(hero.moving, 1)}s)` : `On wall ${w.x},${w.y}`;
    if (reviveBtn?.isConnected) {
      const cost = sim.heroes.reviveCost(hero.id);
      const ok = sim.heroes.canRevive(hero.id);
      const rl = ok.reason === 'wave_active' ? `Revive (${cost} gold) after this wave` : `Revive for ${cost} gold`;
      if (reviveBtn.innerHTML !== rl) reviveBtn.innerHTML = rl;
      reviveBtn.disabled = !ok.ok;
    }
    for (const { b, a, id } of abilBtns) {
      const cd = hero.abilityCooldowns[id] ?? 0;
      b.classList.toggle('cooling', cd > 0);
      b.style.setProperty('--cd', cd > 0 ? String(cd / (a.cooldown * hero.stats.cooldownMult)) : '0');
      b.querySelector('.cd').textContent = cd > 0 ? fmt(cd, cd < 10 ? 1 : 0) : '';
      b.disabled = !hero.wallId || hero.moving > 0;
    }
  };
}

/**
 * The level-up overlay: three cards; the game pauses while it is open. Only opens between
 * waves (picks wait otherwise).
 */
export class AbilityPicker {
  constructor(hud) {
    this.hud = hud;
    this.el = h('div', 'picker');
    this.el.hidden = true;
    hud.el.append(this.el);
  }

  get isOpen() { return !this.el.hidden; }

  open(hero) {
    const { sim, cfg, actions } = this.hud;
    if (!sim.heroes.buildAllowed()) { this.hud.toast('Choose new abilities between waves'); return; }
    const offer = sim.heroes.abilityOffer(hero.id);
    if (!offer?.length) return;
    // Time stops while choosing (without the pause menu on top).
    if (!this.isOpen && !actions.isPaused()) { this.pausedByMe = true; actions.holdTime(true); }
    this.el.hidden = false;
    this.el.innerHTML = '';
    const box = h('div', 'pickbox',
      `<h2>Level up! Choose an ability</h2><div class="dim">${hero.name} · ${hero.pendingPicks} pick${hero.pendingPicks > 1 ? 's' : ''} waiting</div>`);
    const row = h('div', 'pickrow');
    offer.forEach((o, i) => {
      const a = cfg.HERO_ABILITIES[o.id];
      const card = h('button', `pickcard r-${o.rarity}`);
      card.style.setProperty('--rc', color(o.rarity));
      card.innerHTML = `${rarityTag(o.rarity)}${o.synergy ? ' <span class="syn">SYNERGY</span>' : ''}`
        + `<div class="pname">${a.name}${o.rank > 1 ? ` <span class="rankup">Rank ${o.rank}</span>` : ''}</div>`
        + `<div class="pdesc">${a.text(o.rank)}</div>`
        + `<div class="ptags">${a.tags.join(' · ')}${a.active ? ' · active' : ''}</div>`;
      card.addEventListener('click', () => {
        const res = sim.heroes.chooseAbility(hero.id, i);
        if (!res) return;
        this.hud.toast(`${hero.name} learned ${a.name}${res.rank > 1 ? ` (rank ${res.rank})` : ''}`, 'good');
        if (hero.pendingPicks > 0) this.open(hero); else this.close();
        this.hud.showSelection(this.hud.selection);
      });
      row.append(card);
    });
    const later = h('button', 'btn', 'Later');
    later.addEventListener('click', () => this.close());
    box.append(row, later);
    this.el.append(box);
  }

  close() {
    this.el.hidden = true;
    if (this.pausedByMe) this.hud.actions.holdTime(false);
    this.pausedByMe = false;
  }
}

/** Top-centre notice when the hero has picks waiting (clickable between waves). */
export class HeroNotice {
  constructor(hud) {
    this.hud = hud;
    this.el = h('button', 'heronotice');
    this.el.hidden = true;
    this.el.addEventListener('click', () => {
      const hero = [...hud.sim.heroes.all()][0];
      if (!hero) return;
      hud.actions.select({ kind: 'hero', id: hero.id });
      if (hud.sim.heroes.buildAllowed()) hud.picker.open(hero);
    });
    hud.el.append(this.el);
  }

  tick() {
    const hero = [...this.hud.sim.heroes.all()][0];
    const picks = hero?.pendingPicks ?? 0;
    const between = this.hud.sim.heroes.buildAllowed();
    const text = picks ? `★ ${picks} new abilit${picks > 1 ? 'ies' : 'y'} ${between ? 'to choose!' : 'after this wave'}` : '';
    this.el.hidden = !picks;
    if (this.el.textContent !== text) this.el.textContent = text;
    this.el.classList.toggle('ready', between);
  }
}
