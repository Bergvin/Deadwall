// Persistent records in localStorage. Every read is validated; a missing, corrupted or
// outdated save falls back to defaults and can never stop the game from starting.
const KEY = 'deadwall.save';
const VERSION = 1;

const DEFAULTS = () => ({
  version: VERSION,
  bestWave: 0,
  highScore: 0,
  totalKills: 0,
  runs: 0,
  settings: { muted: false, volume: 0.7 },
});

const nonNegInt = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Returns a clean save object built only from valid fields of `raw`. */
export function sanitize(raw) {
  const d = DEFAULTS();
  if (!raw || typeof raw !== 'object' || raw.version !== VERSION) return d;
  return {
    version: VERSION,
    bestWave: nonNegInt(raw.bestWave),
    highScore: nonNegInt(raw.highScore),
    totalKills: nonNegInt(raw.totalKills),
    runs: nonNegInt(raw.runs),
    settings: {
      muted: typeof raw.settings?.muted === 'boolean' ? raw.settings.muted : d.settings.muted,
      volume: Number.isFinite(raw.settings?.volume) ? Math.min(1, Math.max(0, raw.settings.volume)) : d.settings.volume,
    },
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
