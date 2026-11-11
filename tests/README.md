# Stillwave web verification

Run from the project root:

```sh
npm ci --prefix tests
npm --prefix tests run check:build
node --test tests/*.test.mjs
python tests/browser_test.py
```

Serving `web/` and packaging the APK require **no install, build, CDN or network dependencies**: the compatible `web/app.bundle.js` is included. Developer verification uses pinned dev-only esbuild and Acorn under `tests/`; `npm ci --prefix tests` installs those tools, not runtime libraries. The browser suite uses installed Python Playwright and Chromium. Its local threaded HTTP server mounts the real `web/` directory at `/stillwave/` to exercise GitHub Pages-style deployment, then shuts down automatically.

After changing any source module, regenerate the included bundle with `npm --prefix tests run build`, bump the cache version in `web/sw.js`, and rerun verification. `check:build` and the Node suite fail if the generated bundle is stale. Build output is deterministic from either the project root or `tests/`.

The legacy regression first reproduced the top-level-await parse failure. It now parses both distributed executable scripts (bootstrap and service worker) with the independent Acorn ES2017 grammar, stricter than Chromium 61's syntax baseline. A real current Chromium test boots the native branch with `globalThis`, `Promise.allSettled`, `Array.at`, and `String.replaceAll` unavailable; checks stored preferences and start/pause/resume/stop; forbids browser AudioContext construction and source-module/remote requests. Another browser test removes modern-only CSS declarations and exercises the flex-gap fallback, range styling, narrow layout and scrollable help. These are compatibility regressions, **not execution on a physical Chromium 61 WebView**; factory-WebView Android cold-start/airplane-mode verification remains an Android integration responsibility.

Coverage includes safe defaults and corrupt/blocked local storage; complete relative precaching; manifest and PNG dimensions; real Chromium OfflineAudioContext PCM generation; 16 Hz modulation versus depth-zero control; silent volume-zero output; clock alignment; actual pause/resume and external suspension; partial updates; finite timer expiry and node disposal; native JSON bridge ownership and service timer polling; mobile overflow; 44 px interactive targets; dialog Escape behavior; reduced motion; offline navigation and playback; missing-cache detection and repair; retry after a failed first install; and an actual downloaded stereo PCM WAV.

The timer expiry test accelerates the engine's accumulated elapsed time near a real 15-minute deadline, then waits for the real interval and AudioContext disposal. It does not wait 15 minutes.

Generated evidence:

- `tests/stillwave-mobile.png` — 390 px viewport, full page.
- `tests/stillwave-desktop.png` — 1440 px viewport, full page.
- `tests/stillwave-preview.wav` — actual 30-second, 44.1 kHz, stereo 16-bit PCM export.

Icons are bundled. To regenerate them, `python tests/generate_icons.py` uses Pillow, with no downloaded fonts or media.

## Integration contract

The maintained source is vanilla ES modules. The document loads the included classic/deferred IIFE `web/app.bundle.js` (`id="stillwaveBootstrap"`), generated for Chromium 61 with no runtime imports or top-level await. `web/js/audio.js` still exports `StillwaveEngine` and `renderAudio` for focused browser/audio tests. Settings use `duration` (minutes), **not** `durationMinutes`; all values are normalized in `web/js/settings.js`.

`window.__stillwaveReady === true` is set only after controls, persistence, immediate service-state polling and event handlers are initialized. Android instrumentation must poll this flag and enabled/live UI, **not** dynamically import `script[type=module]` (there is no module entry now). Default Focus at 16 Hz is labeled as grid aligned; other rates/mode presets are explicitly labeled experimental independent modulation, not a rate-derived musical clock.

When `window.NativeAudio` exists, `web/js/native.js` forwards `start(JSON.stringify(settings))`, `pause()`, `stop()`, `update(JSON.stringify(settings))` and parses `getState()` JSON with `playing`, `elapsed` (seconds), and optional `error`. The native path does not initialize or construct the browser audio engine/AudioContext (its code is included in the static bundle), skips service-worker registration, reports bundled offline readiness, and disables unsupported native WAV export. It reads service state immediately and every second, so an already-running service is reflected on UI reload.

The native bridge tests use a simulated bridge in real Chromium; they do **not** validate an Android AudioTrack, foreground service, APK, signing or hardware playback. Those need Android integration tests. Browser background/lock-screen playback is not guaranteed, and the UI explicitly says so.

## Hosting and updates

Serve `web/` via HTTPS (localhost is permitted for development). All URLs, manifest scope/start URL and the worker registration are relative. The worker caches all distributed web files and the navigation shell, verifies actual cached responses before reporting readiness, and namespaces caches by scope. Increment the cache version in `web/sw.js` whenever app files change. Successful activation removes only older shell caches for this scope, never local preferences or unrelated cache storage. Cached app updates take effect on navigation; no forced reload interrupts active playback.

The generator and branding are original; no OpenFM/Brain.fm source or audio was copied into `web/`. No third-party runtime dependencies, remote fonts, media, analytics, accounts or paid APIs are used.
