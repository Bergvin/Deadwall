// Persistent records in localStorage. Every read is validated; a missing, corrupted or
// outdated save falls back to defaults and can never stop the game from starting.
// This game has its own key: DW Classic keeps its old save ('deadwall.save') untouched.
import { commanderDefaults, slotCount } from './commander.js';
import { PERKS, ARTIFACTS, RARITIES, COMMANDER } from '../config/commander.js';
import { MAPS } from '../config/maps.js';

const KEY = 'deadwall.towers.save';
const VERSION = 3;

const DEFAULTS = () => ({
  version: VERSION,
  bestWave: 0,
  highScore: 0,
  totalKills: 0,
  runs: 0,
  /** Per map: best wave and high score. A map is unlocked by its `unlock` rule (maps.js). */
  maps: {},
  settings: {
    muted: false, volume: 0.7, shadows: true, showRanges: true,
    /** Spells that auto-cast (spell id -> on); autoCastAll covers every spell without a choice. */
    autoCast: {},
    autoCastAll: false,
  },
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
    autoSalvage: {
      on: bool(raw.autoSalvage?.on, d.autoSalvage.on),
      keep: Array.isArray(raw.autoSalvage?.keep) ? RARITIES.filter((r) => raw.autoSalvage.keep.includes(r)) : d.autoSalvage.keep,
    },
  };
}

/** Returns a clean save object built only from valid fields of `raw`. */
export function sanitize(raw) {
  const d = DEFAULTS();
  if (!raw || typeof raw !== 'object' || raw.version !== VERSION) return d;
  const maps = {};
  for (const m of MAPS) {
    const r = raw.maps?.[m.id];
    if (r && typeof r === 'object') maps[m.id] = { bestWave: nonNegInt(r.bestWave), highScore: nonNegInt(r.highScore) };
  }
  const autoCast = {};
  for (const [k, v] of Object.entries(raw.settings?.autoCast ?? {})) if (typeof v === 'boolean' && /^[a-zA-Z]+$/.test(k)) autoCast[k] = v;
  return {
    version: VERSION,
    bestWave: nonNegInt(raw.bestWave),
    highScore: nonNegInt(raw.highScore),
    totalKills: nonNegInt(raw.totalKills),
    runs: nonNegInt(raw.runs),
    maps,
    settings: {
      muted: bool(raw.settings?.muted, d.settings.muted),
      volume: Number.isFinite(raw.settings?.volume) ? Math.min(1, Math.max(0, raw.settings.volume)) : d.settings.volume,
      shadows: bool(raw.settings?.shadows, d.settings.shadows),
      showRanges: bool(raw.settings?.showRanges, d.settings.showRanges),
      autoCast,
      autoCastAll: bool(raw.settings?.autoCastAll, d.settings.autoCastAll),
    },
    commander: sanitizeCommander(raw.commander),
  };
}

/** Whether a map can be played: the first always, others once their unlock rule is met. */
export function isMapUnlocked(save, map) {
  if (!map.unlock) return true;
  return (save.maps?.[map.unlock.map]?.bestWave ?? 0) >= map.unlock.wave;
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
  const rec = next.maps[summary.map] ?? { bestWave: 0, highScore: 0 };
  const newBestWave = summary.wave > rec.bestWave;
  const newHighScore = summary.score > rec.highScore;
  const wasLocked = MAPS.filter((m) => !isMapUnlocked(next, m)).map((m) => m.id);
  rec.bestWave = Math.max(rec.bestWave, nonNegInt(summary.wave));
  rec.highScore = Math.max(rec.highScore, nonNegInt(summary.score));
  if (MAPS.some((m) => m.id === summary.map)) next.maps[summary.map] = rec;
  next.bestWave = Math.max(next.bestWave, nonNegInt(summary.wave));
  next.highScore = Math.max(next.highScore, nonNegInt(summary.score));
  next.totalKills += nonNegInt(summary.kills);
  next.runs += 1;
  const unlocked = MAPS.filter((m) => wasLocked.includes(m.id) && isMapUnlocked(next, m)).map((m) => m.id);
  return { save: next, newBestWave, newHighScore, unlocked };
}
