import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Renderer} from '../web/js/engine/synth.js';
import {normalizeSettings, STYLES} from '../web/js/settings.js';

// The Android app plays the Java port; this proves both engines compose and render the same music.
const root = fileURLToPath(new URL('../android/', import.meta.url));
let javac = true;
try { execFileSync('javac', ['-version'], {stdio: 'ignore'}); } catch { javac = false; }

test('Java and JavaScript engines render the same music', {skip: !javac && 'javac not installed'}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'stillwave-parity-'));
  try {
    const sources = [...readdirSync(join(root, 'app/src/main/java/net/stillwave/audio')).map(f => join(root, 'app/src/main/java/net/stillwave/audio', f)), join(root, 'core-tests/net/stillwave/audio/ParityDump.java')];
    execFileSync('javac', ['--release', '17', '-d', dir, ...sources.filter(f => f.endsWith('.java'))], {stdio: 'pipe'});
    const cases = [...STYLES.map(style => ({style})), {style: 'lofi', synth: 'organ', ambience: 'rain', key: 4, scale: 'lydian'}, {style: 'ambient', mode: 'sleep', ambience: 'night', intensity: .5}];
    for (const extra of cases) {
      const settings = normalizeSettings({seed: 4242, volume: .7, ...extra}), seconds = 8, rate = 44100;
      const file = join(dir, 'out.f32');
      const args = Object.entries({...settings, rate: settings.rateHz}).filter(([k]) => !['theme', 'textScale', 'motionEnabled', 'visualizer', 'v'].includes(k)).map(([k, v]) => `${k}=${v}`);
      execFileSync('java', ['-cp', dir, 'net.stillwave.audio.ParityDump', file, String(rate), String(seconds), ...args], {stdio: 'pipe'});
      const bytes = readFileSync(file), java = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
      const r = new Renderer(rate, settings); r.setPlaying(true);
      const js = new Float32Array(rate * seconds * 2);
      for (let at = 0; at < rate * seconds; at += 1024) r.render(js.subarray(at * 2), null, Math.min(1024, rate * seconds - at));
      let worst = 0, energy = 0;
      for (let i = 0; i < js.length; i++) { worst = Math.max(worst, Math.abs(js[i] - java[i])); energy += js[i] * js[i]; }
      assert.ok(energy > 1, `${JSON.stringify(extra)} is audible`);
      assert.ok(worst < 1e-3, `${JSON.stringify(extra)} differs by ${worst}`);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
