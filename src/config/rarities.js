// Rarity tiers shared by everything that rolls rarity: hero abilities, weapons and gear,
// commander perks and artifacts. Order matters: index 0 is the weakest.
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythical'];

export const RARITY_INFO = {
  common: { name: 'Common', color: '#b9b3a6', salvageXp: 10, salvageGold: 5 },
  uncommon: { name: 'Uncommon', color: '#5fd35f', salvageXp: 30, salvageGold: 12 },
  rare: { name: 'Rare', color: '#4aa3ff', salvageXp: 80, salvageGold: 25 },
  epic: { name: 'Epic', color: '#b06cff', salvageXp: 140, salvageGold: 45 },
  legendary: { name: 'Legendary', color: '#ff9f1a', salvageXp: 250, salvageGold: 80 },
  mythical: { name: 'Mythical', color: '#ff4f6a', salvageXp: 600, salvageGold: 150 },
};
