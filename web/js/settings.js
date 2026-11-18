// Shared, validated controls. Android receives the same object as JSON (see Settings.java).
export const MODE_DEFAULTS = Object.freeze({
  focus: { rateHz: 16, intensity: 0.22, style: 'ambient' },
  relax: { rateHz: 8, intensity: 0.16, style: 'piano' },
  sleep: { rateHz: 1, intensity: 0.12, style: 'deep' },
  meditate: { rateHz: 6, intensity: 0.18, style: 'drift' },
});
export const MODES = Object.freeze(Object.keys(MODE_DEFAULTS));
export const STYLES = Object.freeze(['ambient', 'lofi', 'piano', 'kalimba', 'pulse', 'glass', 'drift', 'choir', 'tape', 'deep']);
export const SYNTHS = Object.freeze(['auto', 'sine', 'triangle', 'warm', 'fm', 'organ', 'epiano', 'bell', 'pluck']);
export const AMBIENCES = Object.freeze(['none', 'rain', 'stream', 'ocean', 'wind', 'fire', 'night', 'brown', 'pink']);
export const SCALES = Object.freeze(['auto', 'major', 'minor', 'dorian', 'lydian', 'mixolydian']);
export const THEMES = Object.freeze(['auto', 'paper', 'sand', 'moss', 'dusk', 'night', 'graphite']);
export const DURATIONS = Object.freeze([0, 15, 25, 45, 60, 90]);
export const STORAGE_KEY = 'stillwave.settings.v1';
const VERSION = 2;

export function loadSettings(storage) {
  try {
    const stored = JSON.parse((storage || window.localStorage).getItem(STORAGE_KEY));
    // v1 stored the old defaults (timbre 'sine', theme 'paper') for everyone; v2 uses each style's instruments and the system theme.
    if (stored && stored.v !== VERSION) { if (stored.synth === 'sine') stored.synth = 'auto'; if (stored.theme === 'paper') stored.theme = 'auto'; }
    return normalizeSettings(stored);
  }
  catch (error) { return normalizeSettings(); }
}
export function saveSettings(settings, storage) {
  try { (storage || window.localStorage).setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings))); return true; }
  catch (error) { return false; }
}
export function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
const choose = (value, allowed, fallback) => allowed.indexOf(value) !== -1 ? value : fallback;
const bounded = (value, low, high, fallback) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Number(value))) : fallback;
const boolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;

export function normalizeSettings(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const mode = choose(raw.mode, MODES, 'focus');
  const defaults = MODE_DEFAULTS[mode];
  const key = typeof raw.key === 'number' ? raw.key : NaN;
  return {
    v: VERSION,
    mode, style: choose(raw.style, STYLES, defaults.style), synth: choose(raw.synth, SYNTHS, 'auto'),
    key: Number.isInteger(key) && key >= 0 && key <= 11 ? key : -1, scale: choose(raw.scale, SCALES, 'auto'),
    brightness: bounded(raw.brightness, 0, 1, 0.5), space: bounded(raw.space, 0, 1, 0.35),
    stereo: bounded(raw.stereo, 0, 1, 0.65), density: bounded(raw.density, 0, 1, 0.5),
    musicVolume: bounded(raw.musicVolume, 0, 1, 0.8), bassVolume: bounded(raw.bassVolume, 0, 1, 0.5),
    melodyVolume: bounded(raw.melodyVolume, 0, 1, 0.5), beatVolume: bounded(raw.beatVolume, 0, 1, 0.5),
    theme: choose(raw.theme, THEMES, 'auto'), textScale: choose(raw.textScale, [1, 1.15, 1.3], 1),
    motionEnabled: boolean(raw.motionEnabled, true), visualizer: boolean(raw.visualizer, true),
    volume: bounded(raw.volume, 0, 1, 0.55), intensity: bounded(raw.intensity, 0, 0.6, defaults.intensity),
    rateHz: bounded(raw.rateHz, 0.25, 32, defaults.rateHz),
    ambience: choose(raw.ambience, AMBIENCES, 'none'), ambienceVolume: bounded(raw.ambienceVolume, 0, 1, 0.3),
    duration: choose(raw.duration, DURATIONS, 25),
    seed: Number.isSafeInteger(raw.seed) && raw.seed > 0 ? raw.seed : (Math.floor(Math.random() * 2147483646) + 1),
  };
}
