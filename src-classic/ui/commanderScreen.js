// Commander screen: level and XP, level-up choices (perks and skills), the run-end artifact
// choice, artifact slots and stash, and the totals. Pure DOM rendering; every change goes
// through the handlers (which save and re-render).
import { RARITIES, RARITY_INFO, PERKS, ARTIFACTS, COMMANDER, ABILITIES } from '../config/commander.js';
import {
  slotCount, perkValue, artifactBonuses, artifactAbility, describeBonuses, describeAbility, totalBonuses,
  totalAbilities, rarityIndex, isSkill, mergeTarget, unkeptArtifacts,
} from '../core/commander.js';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const rarityTag = (r) => `<span class="rarity" style="color:${RARITY_INFO[r].color}">${RARITY_INFO[r].name}</span>`;
const lvl = (n) => (n > 1 ? ` <span class="alvl">Lv ${n}</span>` : '');

/** Small header block (menu and game over): level, XP bar, waiting choices. */
export function commanderSummary(cmd) {
  const need = COMMANDER.xpToNext(cmd.level);
  const box = h('div', 'cmdsum',
    `<div class="cmdline"><span>Commander</span><b>Level ${cmd.level}</b></div>`
    + `<div class="xpbar"><div style="width:${((cmd.xp / need) * 100).toFixed(1)}%"></div></div>`
    + `<div class="xptext">${cmd.xp} / ${need} XP</div>`);
  const waiting = [];
  if (cmd.pendingPicks) waiting.push(`${cmd.pendingPicks} upgrade${cmd.pendingPicks > 1 ? 's' : ''}`);
  if (cmd.artifactOffer?.length) waiting.push('an artifact');
  if (waiting.length) {
    const text = `${waiting.join(' and ')} to choose!`;
    box.append(h('div', 'picks', text[0].toUpperCase() + text.slice(1)));
  }
  return box;
}

/** Description lines of an artifact (bonuses + ability). */
function artifactLines(id, rarity, level) {
  const ab = artifactAbility(id, rarity, level);
  return describeBonuses(artifactBonuses(id, rarity, level)).join('<br>')
    + (ab ? `<div class="aabil">${describeAbility(ab.id, ab.power)}</div>` : '<div class="dim">No ability (common)</div>');
}

/** One artifact tile in the slots or stash. */
function artifactTile(a, { equipped, onClick, onSalvage, armedSalvage }) {
  const def = ARTIFACTS[a.id];
  const tile = h('div', `artifact${equipped ? ' equipped' : ''}`);
  tile.style.setProperty('--rc', RARITY_INFO[a.rarity].color);
  tile.innerHTML = `<div class="aicon">${def.icon}</div><div class="aname">${def.name}${lvl(a.level)}</div>${rarityTag(a.rarity)}`
    + `<div class="abon">${artifactLines(a.id, a.rarity, a.level)}</div>`;
  tile.title = equipped ? 'Click to unequip' : 'Click to equip';
  tile.addEventListener('click', onClick);
  if (onSalvage) {
    const xp = RARITY_INFO[a.rarity].salvageXp * a.level;
    const s = h('button', 'salvage', armedSalvage ? `Salvage? +${xp} XP` : '✕');
    s.title = `Salvage for ${xp} commander XP`;
    s.addEventListener('click', (e) => { e.stopPropagation(); onSalvage(); });
    tile.append(s);
  }
  return tile;
}

/** The three run-end artifacts as big cards (game over screen and commander screen). */
export function artifactOfferCards(cmd, onPick) {
  const row = h('div', 'offer');
  cmd.artifactOffer.forEach((o, i) => {
    const def = ARTIFACTS[o.id];
    const into = mergeTarget(cmd, o);
    const card = h('button', `offercard artcard r-${o.rarity}`);
    card.style.setProperty('--rc', RARITY_INFO[o.rarity].color);
    card.innerHTML = `${rarityTag(o.rarity)}<div class="aicon">${def.icon}</div><div class="pname">${def.name}</div>`
      + (into ? `<div class="merge">Merges: Lv ${into.level} → ${into.level + 1}</div>` : '')
      + `<div class="pdesc">${artifactLines(o.id, o.rarity, into ? into.level + 1 : 1)}</div>`;
    card.addEventListener('click', () => onPick(i));
    row.append(card);
  });
  return row;
}

/** Text describing what a pick did (merged, stored, salvaged). */
export function pickedText(res) {
  if (!res) return '';
  if (res.auto) {
    return `<b style="color:${RARITY_INFO[res.auto.rarity].color}">${ARTIFACTS[res.auto.id].name}</b>`
      + ` auto-salvaged for ${res.salvagedXp} XP.`;
  }
  if (res.salvagedXp) return `Stash full: salvaged for ${res.salvagedXp} XP.`;
  const a = res.artifact;
  const name = `<b style="color:${RARITY_INFO[a.rarity].color}">${ARTIFACTS[a.id].name}</b>`;
  return res.merged ? `${name} merged and reached level ${a.level}!` : `${name} added to your artifacts.`;
}

/**
 * Auto-salvage setting: an on/off switch and one toggle per rarity to keep. New artifacts of
 * an unkept rarity are salvaged for XP as soon as they are chosen; equipped ones are never
 * touched. A button clears unkept artifacts already in the stash (two clicks).
 */
function autoSalvageBar(cmd, on, ui) {
  const s = cmd.autoSalvage;
  const bar = h('div', `autosalv${s.on ? ' on' : ''}`);
  const toggle = h('label', 'astoggle', `<input type="checkbox"${s.on ? ' checked' : ''}> Auto-salvage`);
  toggle.title = 'Artifacts of a rarity you do not keep are salvaged for XP as soon as you choose them';
  toggle.querySelector('input').addEventListener('change', (e) => on.autoSalvage({ on: e.target.checked }));
  bar.append(toggle, h('span', 'dim', 'Keep:'));
  for (const r of RARITIES) {
    const kept = s.keep.includes(r);
    const chip = h('button', `keepchip${kept ? ' kept' : ''}`, RARITY_INFO[r].name);
    chip.style.setProperty('--rc', RARITY_INFO[r].color);
    chip.title = kept ? `Keeping ${RARITY_INFO[r].name} artifacts (click to salvage them instead)` : `Salvaging ${RARITY_INFO[r].name} artifacts (click to keep them)`;
    chip.addEventListener('click', () => on.autoSalvage({ keep: kept ? s.keep.filter((k) => k !== r) : [...s.keep, r] }));
    bar.append(chip);
  }
  const unkept = unkeptArtifacts(cmd);
  if (unkept.length) {
    const xp = unkept.reduce((sum, a) => sum + RARITY_INFO[a.rarity].salvageXp * a.level, 0);
    const b = h('button', 'btn small salvnow', ui.armedSweep ? `Salvage ${unkept.length}? +${xp} XP` : `Salvage ${unkept.length} unkept`);
    b.title = 'Salvage the stash artifacts of rarities you do not keep (equipped ones are safe)';
    b.addEventListener('click', () => on.salvageUnkept());
    bar.append(b);
  }
  return bar;
}

/**
 * @param {HTMLElement} root
 * @param {object} cmd commander record
 * @param {{choose: (i:number) => void, chooseArtifact: (i:number) => void, equip: (uid:number) => void,
 *          unequip: (uid:number) => void, salvage: (uid:number) => void, back: () => void, backLabel: string,
 *          autoSalvage: (change: {on?: boolean, keep?: string[]}) => void, salvageUnkept: () => void}} on
 * @param {{armedSalvage?: number, picked?: object}} ui transient UI state
 */
export function renderCommander(root, cmd, on, ui = {}) {
  root.innerHTML = '';
  const box = h('div', 'box cmdbox');
  box.append(h('h2', '', 'Commander'));
  box.append(commanderSummary(cmd));
  if (ui.picked) box.append(h('div', 'pickedmsg', pickedText(ui.picked)));

  // Run-end artifact choice.
  if (cmd.artifactOffer?.length) {
    const sec = h('div', 'cmdsec');
    sec.append(h('h3', '', 'Choose an artifact'));
    sec.append(artifactOfferCards(cmd, on.chooseArtifact));
    box.append(sec);
  }

  // Level-up choice.
  if (cmd.pendingPicks && cmd.offer?.length) {
    const sec = h('div', 'cmdsec');
    sec.append(h('h3', '', `Level up! Choose one${cmd.pendingPicks > 1 ? ` (${cmd.pendingPicks} left)` : ''}`));
    const row = h('div', 'offer');
    cmd.offer.forEach((o, i) => {
      const p = PERKS[o.id];
      const v = perkValue(o.id, o.rarity);
      const card = h('button', `offercard r-${o.rarity}`);
      card.style.setProperty('--rc', RARITY_INFO[o.rarity].color);
      card.innerHTML = `${rarityTag(o.rarity)}${isSkill(o.id) ? ' <span class="skilltag">SKILL</span>' : ''}`
        + `<div class="pname">${isSkill(o.id) ? `${ABILITIES[p.ability].icon} ` : ''}${p.name}</div>`
        + `<div class="pdesc">${isSkill(o.id) ? ABILITIES[p.ability].text(v) : describeBonuses({ [p.bonus]: v })[0]}</div>`;
      card.addEventListener('click', () => on.choose(i));
      row.append(card);
    });
    sec.append(row);
    box.append(sec);
  }

  // Equipped artifacts.
  const slots = slotCount(cmd.level);
  const eq = h('div', 'cmdsec');
  const nextSlot = COMMANDER.slotLevels.find((l) => l > cmd.level);
  eq.append(h('h3', '', `Artifacts equipped <span class="dim">${cmd.equipped.length} / ${slots}`
    + `${nextSlot ? ` · next slot at level ${nextSlot}` : ''}</span>`));
  const slotRow = h('div', 'slots');
  for (let i = 0; i < slots; i++) {
    const a = cmd.artifacts.find((x) => x.uid === cmd.equipped[i]);
    slotRow.append(a ? artifactTile(a, { equipped: true, onClick: () => on.unequip(a.uid) }) : h('div', 'artifact empty', 'Empty slot'));
  }
  eq.append(slotRow);
  box.append(eq);

  // Stash.
  const stash = cmd.artifacts.filter((a) => !cmd.equipped.includes(a.uid))
    .sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || b.level - a.level
      || ARTIFACTS[a.id].name.localeCompare(ARTIFACTS[b.id].name));
  const st = h('div', 'cmdsec');
  st.append(h('h3', '', `Stash <span class="dim">${stash.length}</span>`));
  st.append(autoSalvageBar(cmd, on, ui));
  if (!stash.length) {
    st.append(h('div', 'dim small', 'Every finished run lets you choose one of three artifacts. The further you get, the better they are. Two identical artifacts merge into a higher level.'));
  } else {
    const grid = h('div', 'stash');
    for (const a of stash) {
      grid.append(artifactTile(a, {
        equipped: false, onClick: () => on.equip(a.uid), onSalvage: () => on.salvage(a.uid), armedSalvage: ui.armedSalvage === a.uid,
      }));
    }
    st.append(grid);
  }
  box.append(st);

  // Totals: abilities, stat bonuses, perk list.
  const tot = h('div', 'cmdsec');
  tot.append(h('h3', '', 'Your next run'));
  const abil = Object.entries(totalAbilities(cmd)).map(([id, p]) => `<div class="aabil">${describeAbility(id, p)}</div>`);
  if (abil.length) tot.append(h('div', 'abilities', abil.join('')));
  const lines = describeBonuses(totalBonuses(cmd));
  tot.append(h('div', 'totals', lines.length ? lines.map((l) => `<span>${l}</span>`).join('')
    : (abil.length ? '' : '<span class="dim">Nothing yet. Finish runs to level up and find artifacts.</span>')));
  if (cmd.perks.length) {
    const grouped = new Map();
    for (const p of cmd.perks) {
      const k = `${p.id}|${p.rarity}`;
      grouped.set(k, (grouped.get(k) ?? 0) + 1);
    }
    const list = [...grouped].sort(([a], [b]) => rarityIndex(b.split('|')[1]) - rarityIndex(a.split('|')[1]))
      .map(([k, n]) => {
        const [id, r] = k.split('|');
        return `<span style="color:${RARITY_INFO[r].color}">${PERKS[id].name}${n > 1 ? ` ×${n}` : ''}</span>`;
      });
    tot.append(h('div', 'perklist', list.join(' · ')));
  }
  box.append(tot);

  const back = h('button', 'btn big primary', on.backLabel);
  back.addEventListener('click', () => on.back());
  box.append(back);
  root.append(box);
}
