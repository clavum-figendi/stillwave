import test from 'node:test';
import assert from 'node:assert/strict';

const path = new URL('../web/js/settings.js', import.meta.url);
test('persistence tolerates corrupt and unavailable storage, preserving zero controls', async () => {
  const { loadSettings, saveSettings, formatTime } = await import(path);
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key,value) => data.set(key,value) };
  assert.equal(loadSettings(storage).duration,25);
  data.set('stillwave.settings.v1','{broken');
  assert.equal(loadSettings(storage).mode,'focus');
  assert.equal(saveSettings({intensity:0, volume:0, duration:0, seed:42},storage),true);
  assert.equal(loadSettings(storage).intensity,0);
  assert.equal(loadSettings(storage).duration,0);
  const blocked = {getItem(){throw Error('denied');},setItem(){throw Error('full');}};
  assert.equal(loadSettings(blocked).duration,25);
  assert.equal(saveSettings({},blocked),false);
  assert.equal(formatTime(3661.9),'61:01');
  assert.equal(formatTime(-3),'00:00');
});
test('settings have safe defaults and sanitize untrusted persisted input', async () => {
  const { normalizeSettings, MODE_DEFAULTS } = await import(path);
  const defaults = normalizeSettings();
  assert.equal(defaults.mode, 'focus');
  assert.equal(defaults.duration, 25);
  assert.equal(defaults.rateHz, 16);
  assert.ok(defaults.seed > 0 && Number.isInteger(defaults.seed));
  const bad = normalizeSettings({mode:'bogus',style:'bogus',volume:99,intensity:-8,rateHz:Infinity,ambience:'ocean',ambienceVolume:-1,duration:2,seed:-1});
  assert.equal(bad.mode,'focus'); assert.equal(bad.style,'ambient');
  assert.equal(bad.volume,1); assert.equal(bad.intensity,0); assert.equal(bad.rateHz,16);
  assert.equal(bad.ambience,'none'); assert.equal(bad.ambienceVolume,0); assert.equal(bad.duration,25);
  assert.equal(MODE_DEFAULTS.sleep.rateHz,1);
  assert.equal(MODE_DEFAULTS.relax.rateHz,8);
  assert.equal(MODE_DEFAULTS.meditate.rateHz,6);
});
