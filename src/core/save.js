// Persistent records in localStorage. Every read is validated; a missing, corrupted or
// outdated save falls back to defaults and can never stop the game from starting.
// Version 1 saves (before the Commander) are upgraded: their records and settings are kept.
import { commanderDefaults, slotCount } from './commander.js';
import { PERKS, ARTIFACTS, RARITIES, COMMANDER } from '../config/commander.js';

const KEY = 'deadwall.save';
const VERSION = 2;

const DEFAULTS = () => ({
  version: VERSION,
  bestWave: 0,
  highScore: 0,
  totalKills: 0,
  runs: 0,
  settings: { muted: false, volume: 0.7, shadows: true, showPath: true },
  commander: commanderDefaults(),
});

const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

const nonNegInt = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const isRarity = (r) => RARITIES.includes(r);
const validPerk = (p) => p && PERKS[p.id] && isRarity(p.rarity) && PERKS[p.id].values[RARITIES.indexOf(p.rarity)] != null;

/** Clean commander record: unknown perks/artifacts are dropped, equipment fits the slots. */
export function sanitizeCommander(raw) {
  const d = commanderDefaults();
  if (!raw || typeof raw !== 'object') return d;
  const level = Math.max(1, nonNegInt(raw.level));
  const perks = Array.isArray(raw.perks) ? raw.perks.filter(validPerk).map((p) => ({ id: p.id, rarity: p.rarity })) : [];
  const seen = new Set();
  const artifacts = (Array.isArray(raw.artifacts) ? raw.artifacts : [])
    .filter((a) => a && ARTIFACTS[a.id] && isRarity(a.rarity) && Number.isInteger(a.uid) && a.uid > 0 && !seen.has(a.uid) && seen.add(a.uid))
    .slice(0, COMMANDER.maxStash)
    .map((a) => ({ uid: a.uid, id: a.id, rarity: a.rarity, level: Math.min(COMMANDER.artifactMaxLevel, Math.max(1, nonNegInt(a.level))) }));
  const uids = new Set(artifacts.map((a) => a.uid));
  const equipped = [...new Set(Array.isArray(raw.equipped) ? raw.equipped : [])]
    .filter((u) => uids.has(u)).slice(0, slotCount(level));
  const pendingPicks = nonNegInt(raw.pendingPicks);
  const offer = pendingPicks && Array.isArray(raw.offer) && raw.offer.length && raw.offer.every(validPerk)
    ? raw.offer.map((p) => ({ id: p.id, rarity: p.rarity })) : null;
  const artifactOffer = Array.isArray(raw.artifactOffer) && raw.artifactOffer.length
    && raw.artifactOffer.length <= COMMANDER.offerSize && raw.artifactOffer.every((a) => a && ARTIFACTS[a.id] && isRarity(a.rarity))
    ? raw.artifactOffer.map((a) => ({ id: a.id, rarity: a.rarity })) : null;
  return {
    level,
    xp: Math.min(nonNegInt(raw.xp), COMMANDER.xpToNext(level) - 1),
    pendingPicks,
    offer,
    perks,
    artifacts,
    equipped,
    nextUid: Math.max(nonNegInt(raw.nextUid), ...artifacts.map((a) => a.uid + 1), 1),
    artifactOffer,
  };
}

/** Returns a clean save object built only from valid fields of `raw`. */
export function sanitize(raw) {
  const d = DEFAULTS();
  if (!raw || typeof raw !== 'object' || (raw.version !== VERSION && raw.version !== 1)) return d;
  return {
    version: VERSION,
    bestWave: nonNegInt(raw.bestWave),
    highScore: nonNegInt(raw.highScore),
    totalKills: nonNegInt(raw.totalKills),
    runs: nonNegInt(raw.runs),
    settings: {
      muted: bool(raw.settings?.muted, d.settings.muted),
      volume: Number.isFinite(raw.settings?.volume) ? Math.min(1, Math.max(0, raw.settings.volume)) : d.settings.volume,
      shadows: bool(raw.settings?.shadows, d.settings.shadows),
      showPath: bool(raw.settings?.showPath, d.settings.showPath),
    },
    commander: sanitizeCommander(raw.commander),
  };
}

export function loadSave(storage = globalThis.localStorage) {
  try {
    return sanitize(JSON.parse(storage?.getItem(KEY) ?? 'null'));
  } catch {
    return DEFAULTS();
  }
}

export function writeSave(save, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(sanitize(save)));
    return true;
  } catch {
    return false;
  }
}

/** Folds a finished run into the records. Returns the new save and whether records broke. */
export function recordRun(save, summary) {
  const next = sanitize(save);
  const newBestWave = summary.wave > next.bestWave;
  const newHighScore = summary.score > next.highScore;
  next.bestWave = Math.max(next.bestWave, nonNegInt(summary.wave));
  next.highScore = Math.max(next.highScore, nonNegInt(summary.score));
  next.totalKills += nonNegInt(summary.kills);
  next.runs += 1;
  return { save: next, newBestWave, newHighScore };
}
