# Stillwave

Offline-first generative soundscapes for focus, relaxation, sleep and meditation.
A static web PWA and a bundled Android app: no accounts, subscriptions, audio
streaming, analytics, external fonts or paid generation APIs.

## Get Stillwave

- **Android:** 2.0.0 builds from this source; the latest signed APK is [1.1.0](https://github.com/clavum-figendi/stillwave/releases/tag/v1.1.0).
- **Android:** 2.0.0 builds from this source; the last signed release is 1.1.0, signed APK in the [release](https://github.com/clavum-figendi/stillwave/releases/tag/v1.1.0).
- **Runtime evidence:** [Android 8, 10 and 15 emulator run](https://github.com/clavum-figendi/stillwave/actions/runs/43152424725),
  including cold offline start, UI controls, notification transport and screen-off
  native playback. Physical-device/OEM battery behavior is not yet measured.

The Android update uses the same package and signing identity as the 1.0.0 test
build and 1.0.1 release. Install it over either to retain local app data.
The emulator matrix tests debug APKs of the same production source; the signed
release is independently verified for signature, permissions and bundled assets.

## What's new in 2.0

- **A real composer.** Every session is written live from a seed: a key and mode, chord
  progressions from style-specific harmonic languages (bright, jazz, modal, loops), smooth
  voice-leading, two-bar melodic motifs that return and vary (A A B A), walking or pulsing
  bass lines, arpeggios, swung drum patterns and an energy arc that thins and builds. Long
  sessions get new progressions and gentle key changes, so nothing loops.
- **Ten styles with their own instruments:** Ambient (warm pads, bells), Lo-fi (electric
  piano, walking bass, soft drums, vinyl), Piano (felt piano), Kalimba (plucked tines),
  Pulse (minimalist phasing arpeggios), Glass (shimmering FM bells), Drift (wide modal
  swells), Choir (formant voices), Tape (worn organ, wow and flutter) and Deep (low drones).
  Twenty-two synthesized voices in all, plus a feedback-delay-network reverb and a
  tempo-synced ping-pong delay.
- **Same music everywhere.** The engine is written once in JavaScript (AudioWorklet on the
  web) and ported line for line to Java for the Android foreground service; a parity test
  shows both render identical output to float32 rounding.
- **A calmer interface.** One screen: a live score of the notes being played, four modes,
  ten styles, nine atmospheres and a single transport bar. Mixing (chords, melody, bass,
  beat, atmosphere, tone, space, width, activity), timer, appearance and everything
  technical (timbre, key, scale, pulse depth/rate, seed, WAV export up to 5 minutes,
  offline, resets) live in sheets, with the technical part folded under Advanced.
- **Atmospheres:** rain, stream, ocean, wind, fire, night, brown and pink noise. All are
  synthesized textures, not field recordings.
- Seven palettes (Auto follows the system), bundled Fraunces and Figtree fonts (OFL),
  text size, motion and score toggles. v1 preferences migrate automatically.

The browser score draws the notes the engine actually triggers. On Android it is driven
by the same composer running alongside the native engine; it is a picture of the music,
not a measurement of output or brain activity. Display motion respects reduced motion
and stops when paused or hidden. Research, corrections, limitations and credits are
bundled in the interface and [`web/RESEARCH.md`](web/RESEARCH.md). The paper's
band-limited experimental stimuli are **not** reproduced by this app.

## Offline use

- **Web:** open the hosted app online once, use the offline-save/check control and
  wait for **Ready offline**. Keep the site data. Subsequent visits and music
  generation work without a connection. Browser/OS storage eviction or clearing
  site data removes the cache; installation alone is not a permanent guarantee.
- **Android:** install the signed APK. All UI and synthesis code is bundled, so
  even the first launch works in airplane mode. The phone generates audio using
  a native AudioTrack foreground service rather than streaming from a server.
- Web background/screen-locked playback depends on browser/OS policy. Use the
  Android app for the native foreground playback path. Android manufacturers may
  impose additional battery restrictions; actual hardware behavior must be tested.
- No microphone, contacts, location or shared-storage permission is required.

## Local web development

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

Open http://localhost:8080. Service workers require HTTPS or localhost.
No installation or build is required to **serve the included app**. Source modules
are bundled into the committed classic `web/app.bundle.js` and `web/worklet.bundle.js`
for Chromium 61 syntax compatibility. After editing JavaScript sources, regenerate and
verify them (details in [`tests/README.md`](tests/README.md)):

```sh
npm ci --prefix tests
npm --prefix tests run build
node --test tests/*.test.mjs
python tests/browser_test.py
sh android/run-core-tests.sh
```

Code map: `web/js/engine/composer.js` decides what to play, `web/js/engine/synth.js`
renders it; their Java twins are `android/.../audio/Composer.java`, `Voice.java`,
`Svf.java`, `Rng.java` and `SignalGenerator.java`. Change both sides together; the
parity test fails otherwise.

Use relative paths to host under a GitHub Pages project path or at the root on
Cloudflare Pages/Vercel/Netlify. Publish **web/**, not the repository root.
Android build instructions are in `android/README.md`.

## Design

The UI is shared. Browsers run the engine in an AudioWorklet (ScriptProcessor on old
engines); Android passes the same locally saved settings through a restricted bridge to
the Java port of the engine. The chord and melody bus receives adjustable amplitude
modulation while bass, drums and atmosphere are mixed separately. All sound is generated from synthesis and procedural noise.
Use comfortable volume. This is a wellness/audio experiment, not a treatment,
and does not reproduce or validate Brain.fm's proprietary algorithms or outcomes.
Sleep/relax/meditation labels are sound presets, not guaranteed brain states.

## Provenance

Inspired by the open-source projects [OpenFM](https://github.com/adam13331/OpenFM)
and [focusmusic](https://github.com/petrbrzek/focusmusic). These projects and the
public amplitude-modulation literature informed the approach; Stillwave is not
associated with Brain.fm. Research reference:
https://pmc.ncbi.nlm.nih.gov/articles/PMC11499863/.

## Hosting and updates

The static app is hosted by GitHub Pages using `.github/workflows/pages.yml`.
Android builds use `.github/workflows/android.yml`. Releases are signed using a
private keystore supplied by GitHub Actions secrets; no signing secrets belong in
this repository. Keep the original signing key for future APK updates.

Source is MIT licensed. Third-party patents, if relevant to commercialization,
require independent review; an open-source copyright license is not a patent
clearance opinion.
