# Stillwave verification

Run from the project root:

```sh
npm ci --prefix tests
npm --prefix tests run check:build      # committed bundles match the sources
node --test tests/*.test.mjs           # settings, engine, Java↔JS parity, distribution, ES2017 parse
python tests/browser_test.py           # real Chromium: UI, AudioWorklet + fallback host, offline, export
sh android/run-core-tests.sh           # Java engine contracts and the AudioTrack worker
```

Serving `web/` and packaging the APK need **no install, build, CDN or network dependency**: the Chrome 61-compatible `web/app.bundle.js` (page) and `web/worklet.bundle.js` (AudioWorklet processor) are committed. `npm ci --prefix tests` installs dev-only esbuild and Acorn. After editing any JavaScript source, run `npm --prefix tests run build`, bump the cache version in `web/sw.js`, and rerun verification.

What the suites cover:

- **engine.test.mjs** renders real PCM in Node with the shared engine: determinism per seed; every style, timbre and atmosphere audible, bounded and distinct; every mixer control audible; exact silence, exact mono and pause fade; measured 16 Hz modulation versus depth zero; key/scale respected and voice-led harmony; long-session variety (new progressions and key changes); real-time headroom.
- **parity.test.mjs** compiles the Java engine (skipped without `javac`) and renders the same settings in Java and JavaScript: outputs agree to float32 rounding, so the Android app plays the same music as the web app.
- **expansion-settings / settings** cover v2 defaults, v1→v2 migration in the existing storage slot and sanitizing untrusted values.
- **legacy / distribution** parse the bootstrap, worklet and service worker with Acorn's ES2017 grammar (stricter than Chrome 61) and check that every file in `web/` is precached with relative URLs.
- **browser_test.py** mounts `web/` at `/stillwave/` (GitHub Pages layout) and checks the AudioWorklet and ScriptProcessor hosts produce audible notes; play/pause/resume/stop and the timer; persistence and layout from 360 to 1600 px; Advanced settings; v1 migration; the native bridge (no Web Audio constructed, score driven by the shadow composer); a legacy boot without `globalThis`, `Promise.prototype.finally`, `AudioWorkletNode` and friends; offline save, missing-cache detection, failed-install retry and an offline reload that plays; a real 30 s stereo WAV export; 44 px targets, Escape, Space and reduced motion.

These are compatibility regressions, **not runs on a physical Chromium 61 WebView**. The Android emulator workflow covers cold offline start on devices.
