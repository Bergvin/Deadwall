// The Runner: carries crates of ammo from the house to the towers (one crate fills one
// tower), casts spells that boost the towers around him and gets knocked over by zombies
// on the road. He levels up from kills and cleared waves; every level gives a pick of
// three perks, chosen between waves. Perks can add a second runner (Twin Brother), so the
// system keeps a list of runner units that share one set of perks, spells and levels.
//
// Supply logic: player orders (orderRefill) come first; otherwise each runner picks the
// tower that needs ammo most (ammo fraction below RUNNER.autoThreshold, nearer is better).
// With no crates left he runs home to reload.
import { findPath } from './pathfinding.js';
import { RARITIES } from '../config/rarities.js';

const ORDER_LIMIT = 4;
/** Seconds between re-checking the auto supply target while walking. */
const REPLAN = 0.5;

export class RunnerSystem {
  #nextId = 1;

  /** @param {{grid, house, towers, zombies, zones, events, rng, cfg, spells, spellRank, perks}} deps */
  constructor({ grid, house, towers, zombies, zones, events, rng, cfg, spells, spellRank, perks }) {
    Object.assign(this, { grid, house, towers, zombies, zones, events, rng, cfg, spellDefs: spells, spellRank, perkDefs: perks });
    this.time = 0;
    this.level = 1;
    this.xp = 0;
    this.pendingPicks = 0;
    this.offer = null;
    /** perk id -> rank */
    this.perks = {};
    /** spell id -> rank (he starts knowing Pep Talk) */
    this.spells = { pepTalk: 1 };
    /** spell id -> seconds until ready */
    this.cooldowns = {};
    /** spell id -> auto-cast on/off */
    this.autoCast = {};
    this.autoCastAll = false;
    this.orders = [];
    this.units = [];
    this.buildAllowed = () => true;
    /** Simulation hook: movement factor at a point (plague clouds slow him). */
    this.slowAt = () => 1;
    this.stats = { refills: 0, bonks: 0, casts: 0, cratesLost: 0 };
    this.#doors = this.#findDoors();
    this.#addUnit(this.rng.pick(cfg.names));
    this.autoTimer = 0;
  }

  #doors;

  /** The primary runner (spells are cast where he stands). */
  get main() {
    return this.units[0];
  }

  get name() {
    return this.main.name;
  }

  #addUnit(name) {
    const d = this.#doors[0] ?? { x: this.house.x, y: this.house.z };
    const u = {
      id: this.#nextId++, name,
      x: d.x + 0.5, z: d.y + 0.5,
      state: 'idle', job: null, route: [], routeI: 0, timer: 0,
      crates: this.maxCrates, bonkUntil: 0, immuneUntil: 0, facing: 0, moving: false, replan: 0,
    };
    this.units.push(u);
    this.events.emit('runnerAdded', u);
    return u;
  }

  /** Walkable cells next to the house: where he picks up crates. */
  #findDoors() {
    const g = this.grid, out = [];
    const isHouse = (x, y) => this.house.cells?.some((c) => c.x === x && c.y === y);
    for (const c of this.house.cells ?? []) {
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const x = c.x + dx, y = c.y + dy;
        if (g.isWalkable(x, y) && !isHouse(x, y) && !out.some((o) => o.x === x && o.y === y)) out.push({ x, y });
      }
    }
    // Prefer open ground over the road.
    return out.sort((a, b) => (g.terrainAt(a.x, a.y) - g.terrainAt(b.x, b.y)));
  }

  // --- perks and derived stats -----------------------------------------------------

  /** Summed perk modifiers. */
  get mods() {
    const m = {};
    for (const [id, rank] of Object.entries(this.perks)) {
      const def = this.perkDefs[id];
      if (!def?.mods) continue;
      for (const [k, v] of Object.entries(def.mods(rank))) m[k] = k === 'auraRadius' ? Math.max(m[k] ?? 0, v) : (m[k] ?? 0) + v;
    }
    return m;
  }

  get maxCrates() { return this.cfg.crates + (this.mods.crates ?? 0); }
  get speed() { return this.cfg.speed * (1 + (this.mods.speedPct ?? 0) / 100); }
  get workMult() { return Math.max(0, 1 - (this.mods.refillPct ?? 0) / 100); }
  get spellRadius() { return this.cfg.spellRadius + (this.mods.radiusAdd ?? 0); }

  // --- XP, levels and picks ----------------------------------------------------------

  addXp(amount) {
    if (this.level >= this.cfg.maxLevel || !(amount > 0)) return;
    this.xp += amount * (1 + (this.mods.xpPct ?? 0) / 100);
    while (this.level < this.cfg.maxLevel && this.xp >= this.cfg.xpToNext(this.level)) {
      this.xp -= this.cfg.xpToNext(this.level);
      this.level++;
      this.pendingPicks++;
      this.events.emit('runnerLevelUp', { level: this.level, runner: this.main });
    }
  }

  awardKill(z) {
    this.addXp(z.xp * this.cfg.killXp);
  }

  awardWave() {
    this.addXp(this.cfg.xpToNext(this.level) * this.cfg.waveClearLevelFraction);
  }

  /** Rank a perk/spell pick would have after taking it. */
  nextRank(id) {
    const def = this.perkDefs[id];
    if (def.spell) return (this.spells[def.spell] ?? 0) + 1;
    return (this.perks[id] ?? 0) + 1;
  }

  #available(id) {
    const def = this.perkDefs[id];
    if (def.spell) return (this.spells[def.spell] ?? 0) < this.spellRank.maxRank;
    return (this.perks[id] ?? 0) < (def.maxRank ?? 1);
  }

  /** Three distinct picks, each rolled with its own rarity (luck grows with level). */
  rollOffer(rnd = () => this.rng.next()) {
    const luck = 1 + (this.level * this.cfg.luckPerLevel) / 100;
    const pool = Object.keys(this.perkDefs).filter((id) => this.#available(id));
    const out = [];
    for (let n = 0; n < this.cfg.offerSize && out.length < pool.length; n++) {
      const w = {};
      for (const r of RARITIES) w[r] = (this.cfg.offerWeights[r] ?? 0) * (r === 'common' ? 1 : luck);
      let rarity = pickWeighted(w, rnd);
      let options = [];
      // Fall back to lower rarities when nothing is left at the rolled one.
      for (let i = RARITIES.indexOf(rarity); i >= 0 && !options.length; i--) {
        options = pool.filter((id) => !out.includes(id) && this.perkDefs[id].rarity === RARITIES[i]);
      }
      for (let i = RARITIES.indexOf(rarity) + 1; i < RARITIES.length && !options.length; i++) {
        options = pool.filter((id) => !out.includes(id) && this.perkDefs[id].rarity === RARITIES[i]);
      }
      if (!options.length) break;
      out.push(options[Math.floor(rnd() * options.length)]);
    }
    return out;
  }

  /** The current offer (rolled on demand while picks are waiting). */
  currentOffer() {
    if (!this.pendingPicks) return null;
    this.offer ??= this.rollOffer();
    return this.offer;
  }

  /** Takes one of the offered picks (between waves only). */
  choose(index) {
    const offer = this.currentOffer();
    if (!offer || !this.buildAllowed()) return false;
    const id = offer[index];
    if (!id) return false;
    this.grant(id);
    this.pendingPicks--;
    this.offer = null;
    return true;
  }

  /** Gives a perk or spell (also used by debug and tests). */
  grant(id) {
    const def = this.perkDefs[id];
    if (!def) return false;
    if (def.spell) this.spells[def.spell] = Math.min(this.spellRank.maxRank, (this.spells[def.spell] ?? 0) + 1);
    else this.perks[id] = Math.min(def.maxRank ?? 1, (this.perks[id] ?? 0) + 1);
    if ((this.mods.twin ?? 0) >= this.units.length) {
      const names = this.cfg.names.filter((n) => !this.units.some((u) => u.name === n));
      this.#addUnit(names.length ? this.rng.pick(names) : `${this.main.name} II`);
    }
    for (const u of this.units) u.crates = Math.min(u.crates, this.maxCrates);
    this.events.emit('runnerPerkChosen', { id, rank: def.spell ? this.spells[def.spell] : this.perks[id] });
    return true;
  }

  // --- spells ----------------------------------------------------------------------

  /** A spell's numbers at its current rank with every perk applied. */
  spellInfo(id) {
    const def = this.spellDefs[id];
    const rank = this.spells[id] ?? 0;
    if (!def || !rank) return null;
    const R = this.spellRank, m = this.mods;
    const power = 1 + R.power * (rank - 1);
    const cdCut = Math.min(0.7, R.cooldown * (rank - 1) + (m.cooldownPct ?? 0) / 100);
    const info = {
      id, def, rank,
      cooldown: def.cooldown * (1 - cdCut),
      duration: (def.duration ?? 0) * (1 + R.duration * (rank - 1)) * (1 + (m.durationPct ?? 0) / 100),
      radius: this.spellRadius + (def.radiusAdd ?? 0),
      buff: null,
    };
    if (def.buff) {
      info.buff = {};
      for (const [k, v] of Object.entries(def.buff)) info.buff[k] = typeof v === 'number' && k !== 'jamAfter' ? v * power : v;
    }
    if (def.zone) info.zone = { ...def.zone, stun: def.zone.stun * power, radius: def.zone.radius * (1 + 0.15 * (rank - 1)) };
    return info;
  }

  cooldownOf(id) {
    return Math.max(0, this.cooldowns[id] ?? 0);
  }

  /** Towers within a spell's radius of the main runner. */
  towersInReach(radius, unit = this.main) {
    return [...this.towers.all()].filter((t) => Math.hypot(t.cx - unit.x, t.cz - unit.z) <= radius);
  }

  canCast(id) {
    const info = this.spellInfo(id);
    return !!info && this.cooldownOf(id) <= 0 && this.time >= this.main.bonkUntil;
  }

  cast(id) {
    if (!this.canCast(id)) {
      this.events.emit('actionRejected', { action: 'spell', reason: 'not_ready' });
      return false;
    }
    const info = this.spellInfo(id);
    const u = this.main;
    this.cooldowns[id] = info.cooldown;
    this.stats.casts++;
    const hit = this.towersInReach(info.radius);
    if (info.buff) {
      for (const t of hit) {
        this.towers.addBuff(t.id, { ...info.buff, until: this.towers.time + info.duration, source: `spell:${id}` });
      }
    }
    if (info.def.refill) for (const t of hit) this.#fill(t);
    if (info.zone) {
      this.zones.add({ x: u.x, z: u.z, radius: info.zone.radius, duration: info.duration, dps: 0, stun: info.zone.stun, kind: 'banana', ownerId: 0 });
    }
    this.events.emit('spellCast', { id, name: info.def.name, icon: info.def.icon, x: u.x, z: u.z, radius: info.radius, towers: hit });
    return true;
  }

  /** Whether auto-cast would fire this spell now (also used by the balance bot). */
  wantsCast(id) {
    const info = this.spellInfo(id);
    if (!info) return false;
    const u = this.main;
    if (info.zone) {
      let n = 0;
      for (const z of this.zombies.inRange(u.x, u.z, 2.5)) if (z.alive) n++;
      return n >= 3;
    }
    const near = this.towersInReach(info.radius);
    if (!near.length) return false;
    if (info.def.refill) return near.reduce((s, t) => s + (1 - t.ammo / t.stats.maxAmmo), 0) >= 1.2;
    const busy = near.filter((t) => t.targetId).length;
    return busy >= Math.min(2, near.length);
  }

  setAutoCast(id, on) {
    this.autoCast[id] = !!on;
  }

  /** Whether a spell auto-casts: its own choice, else the all-spells switch. */
  isAutoCast(id) {
    return this.autoCast[id] ?? this.autoCastAll;
  }

  /** Auto-cast every spell (including ones learned later); clears per-spell choices. */
  setAutoCastAll(on) {
    this.autoCastAll = !!on;
    this.autoCast = {};
  }

  // --- supply orders -----------------------------------------------------------------

  /** Sends a runner to this tower next (player order). */
  orderRefill(towerId) {
    if (!this.towers.get(towerId)) return false;
    this.orders = [towerId, ...this.orders.filter((id) => id !== towerId)].slice(0, ORDER_LIMIT);
    // The closest free runner drops its auto job for the order.
    const u = this.units.filter((x) => x.state !== 'refill' && x.state !== 'reload' && x.job?.kind !== 'order')
      .sort((a, b) => this.#distTo(a, towerId) - this.#distTo(b, towerId))[0];
    if (u) { u.job = null; u.state = 'idle'; }
    this.events.emit('runnerOrdered', { towerId });
    return true;
  }

  #distTo(u, towerId) {
    const t = this.towers.get(towerId);
    return t ? Math.hypot(t.cx - u.x, t.cz - u.z) : Infinity;
  }

  #need(t) {
    return 1 - t.ammo / t.stats.maxAmmo;
  }

  /** Next job for a runner: {kind: 'order'|'auto'|'reload', towerId?}. */
  #nextJob(u) {
    if (u.crates <= 0) return { kind: 'reload' };
    const claimed = new Set(this.units.filter((o) => o !== u && o.job?.towerId).map((o) => o.job.towerId));
    while (this.orders.length) {
      const id = this.orders[0];
      const t = this.towers.get(id);
      if (t && !claimed.has(id) && t.ammo < t.stats.maxAmmo) { this.orders.shift(); return { kind: 'order', towerId: id }; }
      if (!t || t.ammo >= t.stats.maxAmmo) { this.orders.shift(); continue; }
      break; // claimed by the other runner: leave it for him
    }
    let best = null, bestScore = Infinity;
    for (const t of this.towers.all()) {
      if (claimed.has(t.id) || this.orders.includes(t.id)) continue;
      const need = this.#need(t);
      if (need < 1 - this.cfg.autoThreshold) continue;
      const score = (1 - need) + Math.hypot(t.cx - u.x, t.cz - u.z) * 0.015;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    if (best) return { kind: 'auto', towerId: best.id };
    if (u.crates < this.maxCrates) return { kind: 'reload' };
    return null;
  }

  #routeTo(u, cell) {
    const g = this.grid;
    const start = { x: Math.min(g.width - 1, Math.max(0, Math.floor(u.x))), y: Math.min(g.height - 1, Math.max(0, Math.floor(u.z))) };
    const cost = (x, y) => (g.isWalkable(x, y) || (x === cell.x && y === cell.y) ? 1 : Infinity);
    const path = findPath(g, start, cell, { cost }) ?? [start, cell];
    u.route = path.slice(1).map((c) => ({ x: c.x + 0.5, z: c.y + 0.5 }));
    u.routeI = 0;
  }

  #nearestDoor(u) {
    let best = this.#doors[0], bd = Infinity;
    for (const d of this.#doors) {
      const dd = Math.hypot(d.x + 0.5 - u.x, d.y + 0.5 - u.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best ?? { x: Math.floor(this.house.x), y: Math.floor(this.house.z) };
  }

  #start(u, job) {
    u.job = job;
    u.state = job.kind === 'reload' ? 'toHouse' : 'toTower';
    u.replan = REPLAN;
    if (job.kind === 'reload') this.#routeTo(u, this.#nearestDoor(u));
    else {
      const t = this.towers.get(job.towerId);
      this.#routeTo(u, { x: t.x, y: t.y });
    }
  }

  #fill(t) {
    this.towers.refill(t.id);
    const m = this.mods;
    if (m.refillHaste) this.towers.addBuff(t.id, { attackSpeedPct: m.refillHaste, until: this.towers.time + 8, source: 'oiled' });
    t.golden = m.goldenAmmo ?? 0;
  }

  // --- simulation step ---------------------------------------------------------------

  step(dt) {
    this.time += dt;
    for (const id of Object.keys(this.cooldowns)) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    const m = this.mods;
    for (const u of this.units) this.#stepUnit(u, dt, m);
    // Tinkerer: towers near a runner slowly regain ammo.
    if (m.tinker) {
      for (const t of this.towers.all()) {
        if (this.units.some((u) => Math.hypot(t.cx - u.x, t.cz - u.z) <= 2)) this.towers.refill(t.id, m.tinker * dt);
      }
    }
    // Auto-cast.
    this.autoTimer -= dt;
    if (this.autoTimer <= 0) {
      this.autoTimer = 0.4;
      for (const id of Object.keys(this.spells)) {
        if (this.isAutoCast(id) && this.canCast(id) && this.wantsCast(id)) this.cast(id);
      }
    }
  }

  #stepUnit(u, dt, m) {
    u.moving = false;
    if (this.time < u.bonkUntil) { u.state = 'bonked'; return; }
    if (u.state === 'bonked') { u.state = 'idle'; u.job = null; }
    this.#checkBonk(u, m);
    if (this.time < u.bonkUntil) return;

    if (u.state === 'refill' || u.state === 'reload') {
      u.timer -= dt;
      if (u.timer > 0) return;
      if (u.state === 'reload') {
        u.crates = this.maxCrates;
        this.events.emit('runnerReloaded', u);
      } else {
        const t = this.towers.get(u.job?.towerId);
        if (t && u.crates > 0) {
          u.crates--;
          this.#fill(t);
          this.stats.refills++;
          this.events.emit('towerRefilled', { tower: t, runner: u });
        }
      }
      u.state = 'idle';
      u.job = null;
    }

    // Auto jobs are re-checked now and then, so a newly empty tower or an order wins.
    if (u.job?.kind === 'auto') {
      u.replan -= dt;
      const t = this.towers.get(u.job.towerId);
      if (!t || t.ammo >= t.stats.maxAmmo) u.job = null;
      else if (u.replan <= 0 && this.orders.length) u.job = null;
    } else if (u.job?.towerId && !this.towers.get(u.job.towerId)) u.job = null;

    if (!u.job) {
      const job = this.#nextJob(u);
      if (!job) { u.state = 'idle'; return; }
      this.#start(u, job);
    }

    // Arrived?
    if (u.job.kind === 'reload') {
      const door = this.#nearestDoor(u);
      if (Math.hypot(door.x + 0.5 - u.x, door.y + 0.5 - u.z) <= this.cfg.reach) {
        u.state = 'reload';
        u.timer = this.cfg.reloadTime * this.workMult;
        return;
      }
    } else {
      const t = this.towers.get(u.job.towerId);
      if (Math.hypot(t.cx - u.x, t.cz - u.z) <= this.cfg.reach) {
        u.state = 'refill';
        u.timer = this.cfg.refillTime * this.workMult;
        u.facing = Math.atan2(t.cx - u.x, t.cz - u.z);
        return;
      }
    }
    this.#walk(u, dt);
  }

  #walk(u, dt) {
    let left = this.speed * this.slowAt(u.x, u.z) * dt;
    while (left > 0 && u.routeI < u.route.length) {
      const p = u.route[u.routeI];
      const dx = p.x - u.x, dz = p.z - u.z, d = Math.hypot(dx, dz);
      if (d <= left) { u.x = p.x; u.z = p.z; left -= d; u.routeI++; continue; }
      u.x += (dx / d) * left;
      u.z += (dz / d) * left;
      u.facing = Math.atan2(dx, dz);
      left = 0;
    }
    u.moving = true;
    // Route finished but not in reach (target moved or was odd): plan again next step.
    if (u.routeI >= u.route.length) u.job = u.job?.kind === 'order' ? u.job : null;
    if (u.routeI >= u.route.length && u.job) this.#start(u, u.job);
  }

  #checkBonk(u, m) {
    if (this.time < u.immuneUntil) return;
    for (const z of this.zombies.inRange(u.x, u.z, this.cfg.bonkRadius)) {
      if (!z.alive || z.air > 0) continue;
      if (m.stomp && !z.boss) {
        // Stompy Boots: the zombie gets flattened instead.
        this.zombies.applyStun(z, 1.5);
        this.zombies.damage(z, z.maxHp * 0.15, 0, { type: 'physical' });
        u.immuneUntil = this.time + 0.6;
        this.events.emit('runnerStomp', { runner: u, zombie: z });
        return;
      }
      const t = this.cfg.bonkTime * Math.max(0.15, 1 - (m.bonkPct ?? 0) / 100);
      u.bonkUntil = this.time + t;
      u.immuneUntil = u.bonkUntil + this.cfg.bonkImmune;
      u.state = 'bonked';
      u.job = null;
      this.stats.bonks++;
      let lost = false;
      if (u.crates > 0 && this.rng.next() < this.cfg.crateLossChance) { u.crates--; lost = true; this.stats.cratesLost++; }
      this.events.emit('runnerBonked', { runner: u, zombie: z, lost });
      return;
    }
  }

  /** Effects of the runners on one tower (TowerSystem.extra hook). */
  towerExtra(t) {
    const m = this.mods;
    let damagePct = 0, freeAmmo = false;
    for (const u of this.units) {
      const d = Math.hypot(t.cx - u.x, t.cz - u.z);
      if (m.auraDamagePct && d <= m.auraRadius) damagePct = Math.max(damagePct, m.auraDamagePct);
      if (m.perpetual && d <= m.perpetual) freeAmmo = true;
    }
    return { damagePct, freeAmmo };
  }
}

function pickWeighted(weights, rnd) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let r = rnd() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((r -= w) < 0) return k;
  return entries[entries.length - 1][0];
}
