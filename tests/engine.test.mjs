import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer} from '../web/js/engine/synth.js';
import {Composer, STYLE} from '../web/js/engine/composer.js';
import {normalizeSettings, STYLES, SYNTHS, AMBIENCES} from '../web/js/settings.js';

const SR = 22050;
function render(extra = {}, seconds = 6, sampleRate = SR) {
  const r = new Renderer(sampleRate, normalizeSettings({seed: 42, volume: .7, intensity: 0, space: 0, ...extra}));
  r.setPlaying(true);
  const out = new Float32Array(sampleRate * seconds * 2);
  for (let i = 0; i < out.length / 2; i += 512) r.render(out.subarray(i * 2), null, Math.min(512, out.length / 2 - i));
  return out;
}
const rms = a => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const difference = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };
const peak = a => { let p = 0; for (const x of a) { assert.ok(Number.isFinite(x), 'finite sample'); p = Math.max(p, Math.abs(x)); } return p; };

test('rendering is deterministic per seed and changes with the seed', () => {
  const a = render(), b = render();
  assert.deepEqual(a, b);
  assert.ok(difference(a, render({seed: 55})) > 1e-4);
});

test('every style is audible, bounded and distinct', () => {
  const signals = STYLES.map(style => render({style}, 8));
  signals.forEach((signal, i) => {
    const p = peak(signal);
    assert.ok(p > .01 && p < .81, `${STYLES[i]} peak ${p}`);
    for (let j = 0; j < i; j++) assert.ok(difference(signal, signals[j]) > 1e-3, `${STYLES[i]} differs from ${STYLES[j]}`);
  });
});

test('every timbre override and atmosphere is audible and distinct', () => {
  const overrides = SYNTHS.slice(1), synths = overrides.map(synth => render({synth}));
  synths.forEach((s, i) => { for (let j = 0; j < i; j++) assert.ok(difference(s, synths[j]) > 1e-4, `${overrides[i]} / ${overrides[j]}`); });
  const airs = AMBIENCES.slice(1).map(ambience => render({ambience, ambienceVolume: 1, musicVolume: 0, bassVolume: 0, melodyVolume: 0, beatVolume: 0}, 4));
  airs.forEach((s, i) => {
    assert.ok(rms(s) > .002, `${AMBIENCES[i + 1]} audible`);
    for (let j = 0; j < i; j++) assert.ok(difference(s, airs[j]) > 1e-3, `${AMBIENCES[i + 1]} / ${AMBIENCES[j + 1]}`);
  });
});

test('each control audibly changes the sound', () => {
  const reference = render({style: 'lofi'}, 8);
  for (const key of ['musicVolume', 'bassVolume', 'melodyVolume', 'beatVolume', 'brightness', 'space', 'stereo', 'density'])
    assert.ok(difference(reference, render({style: 'lofi', [key]: key === 'space' ? 1 : 0}, 8)) > 5e-5, key);
});

test('silence, mono and pause contracts are exact', () => {
  assert.equal(peak(render({volume: 0})), 0);
  assert.equal(peak(render({musicVolume: 0, bassVolume: 0, melodyVolume: 0, beatVolume: 0, space: 1})), 0);
  const mono = render({stereo: 0, space: 1});
  for (let i = 0; i < mono.length; i += 2) assert.equal(mono[i], mono[i + 1]);
  const r = new Renderer(SR, normalizeSettings({seed: 3}));
  const out = new Float32Array(SR * 2);
  r.setPlaying(true); r.render(out, null, SR);
  r.setPlaying(false); r.render(out, null, SR);
  assert.equal(out[out.length - 1], 0); assert.ok(r.isSilent());
});

test('amplitude modulation is measurable at the pulse rate and absent at depth zero', () => {
  const depth = intensity => {
    const audio = render({musicVolume: 1, bassVolume: 0, melodyVolume: 0, beatVolume: 0, intensity, rateHz: 16, style: 'ambient'}, 6);
    let re = 0, im = 0, power = 0; const hop = 60;
    for (let i = SR * 2; i < audio.length / 2 - hop; i += hop) {
      let sum = 0; for (let j = i; j < i + hop; j++) sum += audio[j * 2] ** 2;
      const env = Math.sqrt(sum / hop), t = (i + hop / 2) / SR;
      power += env; re += env * Math.cos(2 * Math.PI * 16 * t); im += env * Math.sin(2 * Math.PI * 16 * t);
    }
    return 2 * Math.hypot(re, im) / power;
  };
  const off = depth(0), on = depth(.6);
  assert.ok(on > .12 && on > off * 5, `on ${on} off ${off}`);
});

test('composer respects key and scale and voice-leads within the register', () => {
  for (const style of STYLES) {
    const c = new Composer(normalizeSettings({seed: 9, style, key: 2, scale: 'dorian'}));
    const allowed = [0, 2, 3, 5, 7, 9, 10].map(x => (x + 2) % 12);
    let moves = 0, count = 0;
    for (let bar = 0; bar < 32; bar++) c.bar({note(beat, beats, midi, velocity, inst, layer) {
      assert.ok(beat >= 0 && beat < 4.5 && beats > 0 && velocity > 0 && velocity <= 1);
      if (layer === 0 && inst < 16) { assert.ok(allowed.includes(midi % 12), `${style} pad note ${midi} in D dorian`); count++; }
    }});
    assert.ok(count > 0, `${style} plays harmony`);
    assert.equal(c.root % 12, 2);
    moves += c.prev.slice(0, c.prevCount).every(n => n >= STYLE[style].padLo - 1 && n <= STYLE[style].padHi + 16) ? 0 : 1;
    assert.equal(moves, 0, `${style} voicing stays near its register`);
  }
});

test('long sessions vary: new progressions, motifs and gentle key changes', () => {
  const c = new Composer(normalizeSettings({seed: 21, style: 'piano'}));
  const homes = new Set(), roots = new Set();
  for (let bar = 0; bar < 400; bar++) { c.bar({note() {}}); homes.add(c.home.join()); roots.add(c.root % 12); }
  assert.ok(homes.size >= 3, `progressions ${homes.size}`);
  assert.ok(roots.size >= 2, `keys ${roots.size}`);
});

test('real-time headroom: one minute renders well under a minute', () => {
  const started = performance.now();
  render({style: 'glass'}, 20, 44100);
  assert.ok(performance.now() - started < 10000);
});
