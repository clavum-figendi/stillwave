export const MODE_DEFAULTS = Object.freeze({
  focus: { rateHz: 16, intensity: 0.22, style: 'ambient' },
  relax: { rateHz: 8, intensity: 0.16, style: 'ambient' },
  sleep: { rateHz: 1, intensity: 0.12, style: 'deep' },
  meditate: { rateHz: 6, intensity: 0.18, style: 'ambient' },
});
export const DURATIONS = Object.freeze([0, 15, 25, 45, 60, 90]);
export const STORAGE_KEY = 'stillwave.settings.v1';
export function loadSettings(storage) {
  try { return normalizeSettings(JSON.parse((storage ?? window.localStorage).getItem(STORAGE_KEY))); }
  catch { return normalizeSettings(); }
}
export function saveSettings(settings, storage) {
  try { (storage ?? window.localStorage).setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings))); return true; }
  catch { return false; }
}
export function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`;
}
const choose = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const bounded = (value, low, high, fallback) => Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.max(low, Math.min(high, Number(value))) : fallback;
export function normalizeSettings(input = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const mode = choose(raw.mode, Object.keys(MODE_DEFAULTS), 'focus');
  const defaults = MODE_DEFAULTS[mode];
  return {
    mode, style: choose(raw.style, ['ambient','lofi','deep'], defaults.style),
    volume: bounded(raw.volume,0,1,0.55), intensity: bounded(raw.intensity,0,0.6,defaults.intensity),
    rateHz: bounded(raw.rateHz,0.25,32,defaults.rateHz),
    ambience: choose(raw.ambience,['none','rain','brown'],'none'),
    ambienceVolume: bounded(raw.ambienceVolume,0,1,0.2),
    duration: choose(raw.duration,DURATIONS,25),
    seed: Number.isSafeInteger(raw.seed) && raw.seed > 0 ? raw.seed : (Math.floor(Math.random() * 2147483646) + 1),
  };
}
