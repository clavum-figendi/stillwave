import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSettings, loadSettings, saveSettings, STORAGE_KEY, STYLES, SYNTHS, AMBIENCES, SCALES, THEMES} from '../web/js/settings.js';

test('v2 defaults and migration in the existing storage slot', () => {
  const s = normalizeSettings({seed: 42});
  assert.deepEqual([s.brightness, s.space, s.stereo, s.density, s.musicVolume, s.bassVolume, s.melodyVolume, s.beatVolume], [.5, .35, .65, .5, .8, .5, .5, .5]);
  assert.deepEqual([s.synth, s.key, s.scale, s.theme, s.textScale, s.motionEnabled, s.visualizer, s.v], ['auto', -1, 'auto', 'auto', 1, true, true, 2]);
  assert.deepEqual([s.volume, s.rateHz, s.intensity, s.ambienceVolume, s.duration], [.55, 16, .22, .3, 25]);
  let stored = JSON.stringify({seed: 42, mode: 'sleep', volume: .3, synth: 'sine', theme: 'paper'});
  const storage = {getItem(k) { assert.equal(k, STORAGE_KEY); return stored; }, setItem(k, v) { assert.equal(k, STORAGE_KEY); stored = v; }};
  const migrated = loadSettings(storage);
  assert.deepEqual([migrated.style, migrated.volume, migrated.synth, migrated.theme], ['deep', .3, 'auto', 'auto']);
  assert.ok(saveSettings({...migrated, synth: 'sine', theme: 'paper'}, storage));
  assert.deepEqual([loadSettings(storage).synth, loadSettings(storage).theme], ['sine', 'paper'], 'explicit v2 choices are kept');
});

test('every supported option survives normalization and unsafe values cannot leak', () => {
  for (const [key, list] of [['style', STYLES], ['synth', SYNTHS], ['ambience', AMBIENCES], ['scale', SCALES], ['theme', THEMES]])
    for (const value of list) assert.equal(normalizeSettings({[key]: value})[key], value);
  for (const key of ['brightness', 'space', 'stereo', 'density', 'musicVolume', 'bassVolume', 'melodyVolume', 'beatVolume']) {
    assert.equal(normalizeSettings({[key]: -1})[key], 0); assert.equal(normalizeSettings({[key]: 2})[key], 1);
    assert.equal(normalizeSettings({[key]: NaN})[key], normalizeSettings()[key]);
    assert.equal(normalizeSettings({[key]: true})[key], normalizeSettings()[key]);
  }
  for (const key of [0, 7, 11]) assert.equal(normalizeSettings({key}).key, key);
  for (const key of [12, -2, 2.5, 'C', null]) assert.equal(normalizeSettings({key}).key, -1);
  const s = normalizeSettings({synth: 'url', theme: 'url', scale: 'phrygian', textScale: 2, motionEnabled: 'false', visualizer: 0});
  assert.deepEqual([s.synth, s.theme, s.scale, s.textScale, s.motionEnabled, s.visualizer], ['auto', 'auto', 'auto', 1, true, true]);
  assert.equal(normalizeSettings({motionEnabled: false, textScale: 1.15}).motionEnabled, false);
});
