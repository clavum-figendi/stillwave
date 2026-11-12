# Stillwave

Offline-first generative soundscapes for focus, relaxation, sleep and meditation.
A static web PWA and a bundled Android app: no accounts, subscriptions, audio
streaming, analytics, external fonts or paid generation APIs.

## Get Stillwave

- **Web app:** https://clavum-figendi.github.io/stillwave/
- **Android 1.0.1:** signed APK in the [release](https://github.com/clavum-figendi/stillwave/releases/tag/v1.0.1).
- **Runtime evidence:** [Android 8, 10 and 15 emulator run](https://github.com/clavum-figendi/stillwave/actions/runs/43114537411),
  including cold offline start, UI controls, notification transport and screen-off
  native playback. Physical-device/OEM battery behavior is not yet measured.

The Android update uses the same package and signing identity as the 1.0.0 test
build. Install it over the test build to retain local app data.

## Sound and interface

The expanded listening workbench includes:

- **Six composition styles:** Ambient, Lo-fi, Deep, Glass, Drift and Tape.
- **Four synth voices:** Sine, Triangle, FM and Organ.
- **Generated atmosphere:** rain-like patter, brown noise, pink noise, ocean-like
  wash, wind-like movement and fire-like crackle, or no atmosphere. These are
  synthesized textures, not field recordings.
- **Sound controls:** music/bass/melody layer levels, brightness, space, stereo
  width, note density, modulation depth/rate, master/atmosphere volume and timer.
- **Six visual palettes:** Paper, Graphite, Moss, Sand, Dusk and Night; plus
  comfortable/compact controls, text size, signal visibility and motion settings.
- **Listening helpers:** separate confirmed sound/display resets, contextual
  control notes, offline guidance, research references and development credits.

The browser waveform measures software output. Android displays an explicitly
illustrative modulation sketch, not an output or brain-activity measurement.
Display motion respects system reduced motion and stops when paused or hidden.
Appearance changes do not alter sound settings. Preferences remain on-device.
Research, corrections, limitations and credits are bundled in the interface and
[`web/RESEARCH.md`](web/RESEARCH.md), including Brain.fm author affiliations.
The paper's band-limited experimental stimuli are **not** reproduced by this app.

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
are bundled into the committed classic `web/app.bundle.js` for Chromium 61 syntax
compatibility. After editing JavaScript sources, regenerate and verify it:

```sh
npm ci --prefix tests
npm --prefix tests run build
node --test tests/*.test.mjs
python tests/browser_test.py
python tests/expansion_audio_test.py
python tests/expansion_ui_test.py
```

Use relative paths to host under a GitHub Pages project path or at the root on
Cloudflare Pages/Vercel/Netlify. Publish **web/**, not the repository root.
Android build instructions are in `android/README.md`.

## Design

The UI is shared. Browsers use Web Audio; Android passes the same locally saved
settings through a restricted bridge to a native audio engine. A low-mid musical
layer receives adjustable amplitude modulation while bass and other layers are
mixed separately. All sound is generated from synthesis and procedural noise.
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
