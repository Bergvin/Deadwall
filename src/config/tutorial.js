// The tutorial: guided steps for a first run, and an introduction card for every kind of
// enemy the first time it turns up (what it does, which towers beat it, which are useless).
// Progress is saved (save.tutorial), so each step and each enemy card shows once; turning
// "Tutorial tips" back on in the menu starts it over.

/**
 * Which towers to build against each enemy, from the matchup lab (tools/matchup.js) and the
 * enemy traits. good: towers that do well; bad: towers that do little or nothing.
 */
export const ENEMY_GUIDE = {
  walker: {
    good: ['arrow', 'fire', 'tesla', 'ballista'], bad: [],
    tip: 'Every tower handles walkers. They are most of your gold early on.',
  },
  runner: {
    good: ['arrow', 'frost', 'tesla', 'ballista'], bad: [],
    tip: 'Fast but fragile. Frost slows them so your other towers get more shots.',
  },
  brute: {
    good: ['boulder', 'alchemist', 'ballista', 'arcane', 'fire'], bad: ['arrow', 'gale'],
    tip: 'Armor shrugs off arrows. Boulders pierce armor, poison and magic ignore it.',
  },
  plague: {
    good: ['boulder', 'ballista', 'alchemist', 'gale'], bad: ['fire', 'arcane', 'tesla', 'frost'],
    tip: 'Resists fire and magic. Kill it away from your towers: its death cloud jams them.',
  },
  siege: {
    good: ['boulder', 'ballista', 'roller'], bad: ['arrow'],
    tip: 'Smashes towers right beside the road. Kill it fast, before it reaches them.',
  },
  wraith: {
    good: ['watchtower'], bad: [],
    tip: 'Invisible: build a Watchtower and every tower in its light can shoot it. Arrow Sniper and Arcane Seer see it on their own; fire and poison splash still hit.',
  },
  ghost: {
    good: ['arcane', 'fire', 'alchemist', 'tesla', 'frost'], bad: ['arrow', 'boulder', 'roller', 'ballista', 'gale'],
    tip: 'Physical attacks pass straight through it. Only magic, fire and poison work.',
  },
  ironclad: {
    good: ['boulder', 'ballista', 'roller', 'fire', 'alchemist', 'arcane'], bad: ['arrow', 'gale'],
    tip: 'Arrows and gusts bounce off its plates. Heavy hits, fire, magic and poison work.',
  },
  rotter: {
    good: ['alchemist', 'roller', 'ballista'], bad: ['arrow'],
    tip: 'Regrows when left alone. Poison stops that; otherwise kill it in a few big hits.',
  },
  behemoth: {
    good: ['boulder', 'alchemist', 'ballista'], bad: ['gale'],
    tip: 'A boss: lots of HP, and it spits out more dead. Armor-piercing and poison towers wear it down; Arrow Sniper deals triple damage to bosses.',
  },
  gravelord: {
    good: ['boulder', 'alchemist', 'ballista'], bad: ['gale'],
    tip: 'A boss that makes the dead around it faster and stronger. Kill its escort with splash and focus it with heavy hits.',
  },
};

/** Short labels for enemy traits on the cards. */
export const TRAIT_LABELS = {
  stealth: 'Invisible',
  immune: (types) => `Immune: ${types.join(', ')}`,
  immuneTags: () => 'Immune: arrows and gusts',
  regen: 'Regrows HP',
  armor: (v) => `Armor ${Math.round(v * 100)}%`,
  resist: (v) => `Resists magic/fire ${Math.round(v * 100)}%`,
  boss: 'Boss',
};

/**
 * Guided steps, shown one at a time. Each has:
 *   when(sim, tut)  shown once this holds (and every step listed in `after` is done)
 *   card            true: a centred card that holds game time until "Got it";
 *                   false: a hint box that waits for the player to do it
 *   done(sim)       for hints: checked every frame; true completes the hint (also before it
 *                   shows, so a player who is ahead never sees it)
 *   point           CSS selector of the HUD element the hint points at (it glows)
 * Steps without `after` are tips that can come in any order once their `when` holds.
 */
export const TUTORIAL_STEPS = [
  {
    id: 'welcome', card: true, when: () => true,
    title: 'Guard the house',
    text: 'The dead come through the portals and walk the road to your <b>house</b>. Each one that gets in takes a bite of its health. If the house falls, the run is over.<br><br>Stop them with <b>towers</b> beside the road.',
  },
  {
    id: 'build', after: ['welcome'], point: '.buildbar',
    when: () => true, done: (sim) => sim.towers.count > 0,
    title: 'Build a tower',
    text: 'Pick the <b>Arrow Tower</b> (click its card or press <kbd>1</kbd>) and click a glowing cell <b>beside the road</b>. Corners are good: the tower covers the road twice.',
  },
  {
    id: 'ammo', after: ['build'], card: true, when: () => true,
    title: 'Ammo and your runner',
    text: 'Every tower has a magazine. <b>An empty tower stops shooting.</b><br><br>Your <b>runner</b> carries ammo crates from the house: one crate fills one tower. He does it on his own, but you can send him: select a tower and press <kbd>R</kbd>, or double-click the tower.<br><br>Zombies on the road knock him over, so keep his way clear.',
  },
  {
    id: 'start', after: ['ammo'], point: '.wavebtn',
    when: () => true, done: (sim) => sim.waves.wave > 0,
    title: 'Start the wave',
    text: 'Build another tower or two if you like, then press <kbd>Enter</kbd> or this button to send in the first wave. You can call the next wave early for a bonus.',
  },
  {
    id: 'meter', after: ['start'], point: '.dmeter',
    when: () => true, done: (sim) => sim.waves.phase === 'prep',
    title: 'Who is doing the work?',
    text: 'The <b>damage meter</b> on the left ranks your towers by damage. Click a row to select that tower.',
  },
  {
    id: 'upgrade', after: ['meter'],
    when: (sim) => sim.waves.phase === 'prep' && sim.towers.count > 0,
    done: (sim) => [...sim.towers.all()].some((t) => t.level > 1 || t.pending),
    title: 'Upgrade a tower',
    text: 'You get only a few towers, so make each one count. Click a tower and press <kbd>U</kbd> (or <b>Upgrade</b> in its panel).<br>Your runner walks over and <b>builds</b> the upgrade; the tower cannot shoot while he works.',
  },
  {
    id: 'spells', after: ['upgrade'], card: true, when: () => true,
    title: 'Runner spells',
    text: 'Your runner casts <b>spells</b> where he stands. They boost the towers around him: <b>Pep Talk</b> makes them shoot faster.<br><br>Press <kbd>Q</kbd> or click the spell. Right-click it for auto-cast, or turn on <b>AUTO</b> for every spell.',
  },
  {
    id: 'counters', after: ['spells'], card: true, when: (sim) => sim.waves.wave >= 2 && sim.waves.phase === 'prep',
    title: 'The right tower for the job',
    text: 'Every tower is good against some enemies and useless against others. <b>Arrows bounce off armored Brutes</b>, physical hits pass through <b>Ghosts</b>, and only a <b>Watchtower</b> lets towers see <b>Wraiths</b>.<br><br>Hover a tower card to see what it is good at. When a new kind of enemy shows up you get a card about it, and the <b>?</b> button at the top opens the guide any time.',
  },
  {
    id: 'perks', point: '.pickbtn',
    when: (sim) => sim.runner.pendingPicks > 0 && sim.waves.phase === 'prep',
    done: (sim) => !sim.runner.pendingPicks || sim.waves.phase !== 'prep',
    title: 'Your runner levels up',
    text: 'Your runner gains experience. Every level he learns a new trick: pick one of three perks (more crates, more speed, new spells...).',
  },
  {
    id: 'boss', card: true,
    when: (sim) => sim.waves.phase === 'prep' && sim.waves.preview().boss != null,
    title: 'A boss is coming',
    text: 'Every fifth wave brings a <b>boss</b>: lots of health and a nasty trick. Heavy, armor-piercing towers (Boulder, Ballista) and poison wear it down. Upgrade before you start the wave.',
  },
  {
    id: 'spec', card: true,
    when: (sim, tut) => [...sim.towers.all()].some((t) => t.level === tut.specLevel - 1 && !t.pending),
    title: 'Specialisation',
    text: 'One of your towers can reach level 5. Then you pick one of <b>two specialisations</b> (for example Arrow: Volley or Sniper). Choose by the enemies that trouble you.',
  },
  {
    id: 'repair', point: '.fortress',
    when: (sim) => sim.waves.phase === 'prep' && sim.house.hp < sim.house.maxHp * 0.8,
    done: (sim) => sim.waves.phase !== 'prep' || sim.house.hp >= sim.house.maxHp * 0.8,
    title: 'Repair the house',
    text: 'Something got into the house. Click the house between waves to repair it for gold.',
  },
];
