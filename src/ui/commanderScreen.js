// Commander screen: level and XP, level-up choices, perks, artifact slots and stash.
// Pure DOM rendering; every change goes through the handlers (which save and re-render).
import { RARITY_INFO, PERKS, ARTIFACTS, COMMANDER } from '../config/commander.js';
import { slotCount, perkValue, artifactBonuses, describeBonuses, totalBonuses, rarityIndex } from '../core/commander.js';

const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};
const rarityTag = (r) => `<span class="rarity" style="color:${RARITY_INFO[r].color}">${RARITY_INFO[r].name}</span>`;

/** Small header block (menu and game over): level, XP bar, waiting picks. */
export function commanderSummary(cmd) {
  const need = COMMANDER.xpToNext(cmd.level);
  const box = h('div', 'cmdsum',
    `<div class="cmdline"><span>Commander</span><b>Level ${cmd.level}</b></div>`
    + `<div class="xpbar"><div style="width:${((cmd.xp / need) * 100).toFixed(1)}%"></div></div>`
    + `<div class="xptext">${cmd.xp} / ${need} XP</div>`);
  if (cmd.pendingPicks) box.append(h('div', 'picks', `${cmd.pendingPicks} upgrade${cmd.pendingPicks > 1 ? 's' : ''} to choose!`));
  return box;
}

/** One artifact tile. */
function artifactTile(a, { equipped, onClick, onSalvage, armedSalvage }) {
  const def = ARTIFACTS[a.id];
  const color = RARITY_INFO[a.rarity].color;
  const tile = h('div', `artifact${equipped ? ' equipped' : ''}`);
  tile.style.setProperty('--rc', color);
  tile.innerHTML = `<div class="aicon">${def.icon}</div><div class="aname">${def.name}</div>${rarityTag(a.rarity)}`
    + `<div class="abon">${describeBonuses(artifactBonuses(a.id, a.rarity)).join('<br>')}</div>`;
  tile.title = equipped ? 'Click to unequip' : 'Click to equip';
  tile.addEventListener('click', onClick);
  if (onSalvage) {
    const s = h('button', 'salvage', armedSalvage ? `Salvage? +${RARITY_INFO[a.rarity].salvageXp} XP` : '✕');
    s.title = `Salvage for ${RARITY_INFO[a.rarity].salvageXp} commander XP`;
    s.addEventListener('click', (e) => { e.stopPropagation(); onSalvage(); });
    tile.append(s);
  }
  return tile;
}

/**
 * @param {HTMLElement} root
 * @param {object} cmd commander record
 * @param {{choose: (i:number) => void, equip: (uid:number) => void, unequip: (uid:number) => void,
 *          salvage: (uid:number) => void, back: () => void, backLabel: string}} on
 * @param {{armedSalvage?: number}} ui transient UI state
 */
export function renderCommander(root, cmd, on, ui = {}) {
  root.innerHTML = '';
  const box = h('div', 'box cmdbox');
  box.append(h('h2', '', 'Commander'));
  box.append(commanderSummary(cmd));

  // Level-up choice.
  if (cmd.pendingPicks && cmd.offer?.length) {
    const sec = h('div', 'cmdsec');
    sec.append(h('h3', '', `Level up! Choose one${cmd.pendingPicks > 1 ? ` (${cmd.pendingPicks} left)` : ''}`));
    const row = h('div', 'offer');
    cmd.offer.forEach((o, i) => {
      const p = PERKS[o.id];
      const card = h('button', `offercard r-${o.rarity}`);
      card.style.setProperty('--rc', RARITY_INFO[o.rarity].color);
      card.innerHTML = `${rarityTag(o.rarity)}<div class="pname">${p.name}</div>`
        + `<div class="pdesc">${describeBonuses({ [p.bonus]: perkValue(o.id, o.rarity) })[0]}</div>`;
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
    .sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || ARTIFACTS[a.id].name.localeCompare(ARTIFACTS[b.id].name));
  const st = h('div', 'cmdsec');
  st.append(h('h3', '', `Stash <span class="dim">${stash.length}</span>`));
  if (!stash.length) {
    st.append(h('div', 'dim small', 'Slay Wanderers (they cross the field between waves) and bosses to find artifacts.'));
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

  // Totals and perk list.
  const tot = h('div', 'cmdsec');
  tot.append(h('h3', '', 'Bonuses this run'));
  const lines = describeBonuses(totalBonuses(cmd));
  tot.append(h('div', 'totals', lines.length ? lines.map((l) => `<span>${l}</span>`).join('') : '<span class="dim">None yet. Finish runs to level up.</span>'));
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
