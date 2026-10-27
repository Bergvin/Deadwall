// The champion: one hero per run, chosen at the start. It stands on a 2x2 block of walls
// (all four cells must be walls without towers). Handles deployment, repositioning,
// experience, levels, talents and targeting. Combat itself lives in combat.js.
// A hero is either in reserve (wallId 0), walking to a block (moving > 0) or deployed.
// h.wallIds lists the four walls of its block; h.wallId is the top-left one.
import { heroStats } from './heroStats.js';

export class HeroSystem {
  #heroes = new Map();
  #nextId = 1;

  /** @param {{walls, zombies, economy, events, rng, types, rules, economyConfig, champion?}} deps */
  constructor({ walls, zombies, economy, events, rng, types, rules, economyConfig, champion = null }) {
    Object.assign(this, { walls, zombies, economy, events, rng, types, rules, economyConfig, champion });
    this.usedNames = new Set();
    // Losing (or selling) any wall of the block drops the champion back into reserve.
    events.on('wallRemoved', ({ wall, cause }) => {
      for (const id of [...wall.heroes]) {
        const h = this.get(id);
        if (!h) continue;
        this.#leaveWalls(h);
        h.moving = 0;
        h.targetId = 0;
        this.events.emit('heroUnseated', { hero: h, cause });
      }
      wall.heroes.length = 0;
    });
  }

  /** Clears the hero from every wall of its block. */
  #leaveWalls(h) {
    for (const id of h.wallIds ?? []) {
      const w = this.walls.get(id);
      if (w) w.heroes = w.heroes.filter((x) => x !== h.id);
    }
    h.wallIds = [];
    h.wallId = 0;
    h.block = null;
  }

  /**
   * The 2x2 blocks of walls containing `wallId` that this hero could stand on, best first
   * (the clicked wall as top-left is preferred). Each block is {x, y, walls: [4 walls]}.
   */
  blocksAt(heroId, wallId) {
    const w = this.walls.get(wallId);
    if (!w) return [];
    const out = [];
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      const x = w.x + ox, y = w.y + oy;
      const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].map(([cx, cy]) => this.walls.at(cx, cy));
      if (cells.some((c) => !c || c.towerId || c.heroes.some((id) => id !== heroId))) continue;
      out.push({ x, y, walls: cells });
    }
    return out;
  }

  get(id) { return this.#heroes.get(id) ?? null; }
  all() { return this.#heroes.values(); }
  get count() { return this.#heroes.size; }

  get deployedCount() {
    let n = 0;
    for (const h of this.#heroes.values()) if (h.wallId) n++;
    return n;
  }

  /** Deployed, arrived heroes (able to act). */
  *active() {
    for (const h of this.#heroes.values()) if (h.wallId && h.moving <= 0) yield h;
  }

  #pickName() {
    const free = this.rules.names.filter((n) => !this.usedNames.has(n));
    const name = free.length ? this.rng.pick(free) : `${this.rng.pick(this.rules.names)} ${this.#nextId}`;
    this.usedNames.add(name);
    return name;
  }

  /** Recomputes derived stats after a level or talent change, keeping the HP ratio. */
  applyStats(h) {
    const ratio = h.maxHp ? h.hp / h.maxHp : 1;
    h.stats = heroStats(this.types[h.type], h.level, h.talents);
    const c = this.champion;
    if (c) {
      // The champion is a giant: much tougher, hits harder, reaches further.
      h.stats.maxHp = Math.round(h.stats.maxHp * c.hpMult);
      h.stats.damage = Math.round(h.stats.damage * c.damageMult * 10) / 10;
      h.stats.range += c.rangeAdd;
    }
    h.maxHp = h.stats.maxHp;
    h.hp = Math.round(h.maxHp * ratio);
  }

  /** Price of the next recruit: grows with every hero already in the company. */
  recruitCost(typeKey) {
    const t = this.types[typeKey];
    return Math.round(t.cost * (1 + this.rules.recruitCostGrowth * this.#heroes.size));
  }

  canRecruit(typeKey, { free = false } = {}) {
    const t = this.types[typeKey];
    if (!t) return { ok: false, reason: 'unknown_type' };
    if (this.#heroes.size >= (this.rules.maxHeroes ?? Infinity)) return { ok: false, reason: 'hero_limit' };
    if (!free && !this.economy.canAfford(this.recruitCost(typeKey))) return { ok: false, reason: 'insufficient_gold' };
    return { ok: true };
  }

  /** The run's champion, chosen at the start: free, and the only hero allowed. */
  recruitChampion(typeKey) {
    return this.recruit(typeKey, { free: true });
  }

  /** Creates a hero in reserve (paying unless free). Returns the hero or null. */
  recruit(typeKey, { free = false } = {}) {
    const check = this.canRecruit(typeKey, { free });
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'recruit', reason: check.reason });
      return null;
    }
    const t = this.types[typeKey];
    const price = free ? 0 : this.recruitCost(typeKey);
    if (price && !this.economy.trySpend(price, `recruit:${typeKey}`)) return null;
    const hero = {
      id: this.#nextId++,
      type: typeKey,
      name: this.#pickName(),
      level: 1,
      xp: 0, // progress toward the next level
      totalXp: 0,
      talents: [],
      hp: 0, maxHp: 0,
      stats: null,
      invested: price,
      wallId: 0,
      wallIds: [],
      block: null,
      moving: 0,
      cooldown: 0,
      abilityCooldowns: {},
      targetId: 0,
      targeting: t.defaultTargeting ?? 'threat',
      facing: Math.PI,
      kills: 0,
      fallen: false,
      lowWarned: false,
      /** Use abilities automatically (the player can still cast them by hand). */
      autoCast: true,
      /** Damage dealt in the current wave, and the result of the last finished wave. */
      waveDamage: 0,
      lastWaveDamage: 0,
      lastWaveDps: 0,
      totalDamage: 0,
    };
    this.applyStats(hero);
    hero.hp = hero.maxHp;
    this.#heroes.set(hero.id, hero);
    this.events.emit('heroRecruited', hero);
    return hero;
  }

  /** @returns {{ok: true} | {ok: false, reason: string}} */
  canDeploy(heroId, wallId) {
    const h = this.get(heroId);
    const w = this.walls.get(wallId);
    if (!h) return { ok: false, reason: 'no_hero' };
    if (h.fallen) return { ok: false, reason: 'fallen' };
    if (!w) return { ok: false, reason: 'no_wall' };
    const blocks = this.blocksAt(heroId, wallId);
    if (!blocks.length) return { ok: false, reason: 'needs_block' };
    const b = blocks[0];
    if (h.block && h.block.x === b.x && h.block.y === b.y) return { ok: false, reason: 'already_there' };
    return { ok: true, block: b };
  }

  /**
   * Places the champion on a 2x2 block of walls containing `wallId`. From reserve it appears
   * at once; moving between blocks takes rules.repositionTime seconds without attacking.
   */
  deploy(heroId, wallId) {
    const check = this.canDeploy(heroId, wallId);
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'deploy', reason: check.reason });
      return false;
    }
    const h = this.get(heroId);
    const wasDeployed = !!h.wallId;
    this.#leaveWalls(h);
    const b = check.block;
    for (const w of b.walls) w.heroes = [h.id];
    h.wallIds = b.walls.map((w) => w.id);
    h.wallId = h.wallIds[0];
    h.block = { x: b.x, y: b.y };
    h.moving = wasDeployed ? this.rules.repositionTime : 0;
    h.targetId = 0;
    this.events.emit('heroDeployed', { hero: h, wall: b.walls[0], block: h.block });
    return true;
  }

  refundValue(heroId) {
    const h = this.get(heroId);
    return h ? Math.floor(h.invested * this.economyConfig.heroRefund) : 0;
  }

  dismiss(heroId) {
    const h = this.get(heroId);
    if (!h) return false;
    const refund = this.refundValue(heroId);
    this.#leaveWalls(h);
    this.#heroes.delete(h.id);
    this.usedNames.delete(h.name);
    this.economy.earn(refund, `dismiss:${h.type}`);
    this.events.emit('heroDismissed', h);
    return true;
  }

  // --- health, falling and revival ---------------------------------------
  /**
   * Damages a deployed hero. At 0 HP the hero falls: leaves the wall and waits in the
   * reserve until revived for gold during a preparation phase. Never deleted.
   */
  damageHero(h, amount, source = null) {
    if (!h || h.fallen || !h.wallId || !(amount > 0)) return 0;
    const dealt = Math.min(h.hp, amount);
    h.hp -= dealt;
    this.events.emit('heroDamaged', { hero: h, amount: dealt, source });
    if (!h.lowWarned && h.hp > 0 && h.hp / h.maxHp <= this.rules.lowHealthWarning) {
      h.lowWarned = true;
      this.events.emit('heroEndangered', h);
    }
    if (h.hp <= 0) {
      this.#leaveWalls(h);
      h.hp = 0;
      h.fallen = true;
      h.moving = 0;
      h.targetId = 0;
      this.events.emit('heroFell', h);
    }
    return dealt;
  }

  heal(h, amount) {
    if (!h || h.fallen || !(amount > 0)) return;
    h.hp = Math.min(h.maxHp, h.hp + amount);
    if (h.hp / h.maxHp > this.rules.lowHealthWarning) h.lowWarned = false;
  }

  /** Restores every standing hero (between waves). */
  healAll() {
    for (const h of this.#heroes.values()) if (!h.fallen) { h.hp = h.maxHp; h.lowWarned = false; }
  }

  /** Set by the simulation: revival is only possible between waves. */
  reviveAllowed = () => true;

  reviveCost(heroId) {
    const h = this.get(heroId);
    return h?.fallen ? Math.ceil(h.invested * this.rules.reviveCostFactor) : 0;
  }

  /** @returns {{ok: true} | {ok: false, reason: string}} */
  canRevive(heroId) {
    const h = this.get(heroId);
    if (!h?.fallen) return { ok: false, reason: 'not_fallen' };
    if (!this.reviveAllowed()) return { ok: false, reason: 'wave_active' };
    if (!this.economy.canAfford(this.reviveCost(heroId))) return { ok: false, reason: 'insufficient_gold' };
    return { ok: true };
  }

  revive(heroId) {
    const check = this.canRevive(heroId);
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'revive', reason: check.reason });
      return false;
    }
    const h = this.get(heroId);
    if (!this.economy.trySpend(this.reviveCost(heroId), `revive:${h.type}`)) return false;
    h.fallen = false;
    h.hp = h.maxHp;
    h.lowWarned = false;
    this.events.emit('heroRevived', h);
    return true;
  }

  setAutoCast(heroId, on) {
    const h = this.get(heroId);
    if (h) h.autoCast = !!on;
  }

  setTargeting(heroId, mode) {
    const h = this.get(heroId);
    if (h) { h.targeting = mode; h.targetId = 0; }
  }

  // --- experience and upgrades -------------------------------------------
  /** Wave-clear XP: a fixed share of a level for every hero still standing. */
  awardWaveXp() {
    const f = this.rules.waveClearLevelFraction ?? 0;
    if (!f) return;
    for (const h of this.#heroes.values()) {
      if (!h.fallen && h.level < this.rules.maxLevel) this.addXp(h, this.xpToNext(h) * f);
    }
  }

  xpToNext(h) {
    return h.level >= this.rules.maxLevel ? Infinity : this.rules.xpToNext(h.level);
  }

  addXp(h, amount) {
    if (!(amount > 0) || h.level >= this.rules.maxLevel) return;
    h.xp += amount;
    h.totalXp += amount;
    while (h.level < this.rules.maxLevel && h.xp >= this.xpToNext(h)) {
      h.xp -= this.xpToNext(h);
      h.level++;
      this.applyStats(h);
      h.hp = h.maxHp; // a level-up restores the hero
      this.events.emit('heroLevelUp', h);
    }
    if (h.level >= this.rules.maxLevel) h.xp = 0;
  }

  /** Talent tiers with availability for this hero. */
  talentTiers(h) {
    return this.types[h.type].talents.map((tier, i) => ({
      index: i,
      ...tier,
      chosen: tier.options.find((o) => h.talents.includes(o.id))?.id ?? null,
      unlocked: h.level >= tier.level,
    }));
  }

  /** @returns {{ok: true} | {ok: false, reason: string}} */
  canBuyTalent(heroId, tierIndex, optionId) {
    const h = this.get(heroId);
    const tier = h && this.types[h.type].talents[tierIndex];
    if (!h || !tier) return { ok: false, reason: 'no_talent' };
    if (!tier.options.some((o) => o.id === optionId)) return { ok: false, reason: 'no_talent' };
    if (tier.options.some((o) => h.talents.includes(o.id))) return { ok: false, reason: 'tier_taken' };
    if (h.level < tier.level) return { ok: false, reason: 'level_too_low' };
    if (!this.economy.canAfford(tier.cost)) return { ok: false, reason: 'insufficient_gold' };
    return { ok: true };
  }

  buyTalent(heroId, tierIndex, optionId) {
    const check = this.canBuyTalent(heroId, tierIndex, optionId);
    if (!check.ok) {
      this.events.emit('actionRejected', { action: 'talent', reason: check.reason });
      return false;
    }
    const h = this.get(heroId);
    const tier = this.types[h.type].talents[tierIndex];
    if (!this.economy.trySpend(tier.cost, `talent:${optionId}`)) return false;
    h.talents.push(optionId);
    h.invested += tier.cost;
    this.applyStats(h);
    this.events.emit('talentBought', { hero: h, talentId: optionId });
    return true;
  }

  /** Gives XP to heroes that damaged a dead zombie, split by damage share. */
  awardKillXp(zombie) {
    let total = 0;
    for (const v of zombie.contributors.values()) total += v;
    if (!total) return;
    for (const [id, dmg] of zombie.contributors) {
      const h = this.get(id);
      if (h) this.addXp(h, zombie.xp * (dmg / total) + dmg * this.rules.xpPerDamage);
    }
  }

  // --- position and targeting --------------------------------------------
  /** World position (x, z) of a deployed hero: the centre of its 2x2 block. */
  positionOf(h) {
    return h.block ? { x: h.block.x + 1, z: h.block.y + 1 } : null;
  }

  /** Picks a target in range according to the hero's targeting preference. */
  pickTarget(h, pos, range = h.stats.range) {
    let best = null, bestScore = Infinity;
    for (const z of this.zombies.inRange(pos.x, pos.z, range)) {
      let score;
      switch (h.targeting) {
        case 'nearest': score = Math.hypot(z.x - pos.x, z.z - pos.z); break;
        case 'strongest': score = -z.hp; break;
        case 'weakest': score = z.hp; break;
        default: score = this.zombies.threatDistance(z);
      }
      if (score < bestScore) { bestScore = score; best = z; }
    }
    return best;
  }
}
