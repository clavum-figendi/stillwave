# Stillwave Android

Native Java Android app: `net.stillwave.app`, version `1.1.0` (3), minimum API 26,
compile/target API 35. Java 17, Gradle wrapper 8.9 (distribution SHA-256 pinned),
Android Gradle Plugin 8.7.3. No AndroidX or other runtime dependencies.

## Build

Supply the actual UI at `../web/index.html` before building. `bundleWeb` uses a
Gradle Sync task to copy **the complete web directory** into generated, ignored
`app/src/main/assets/web`. Asset merges and lint depend on it. Missing source UI
fails the build; stale generated files are deleted, not accidentally shipped.

```sh
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk
# Accept Android SDK licenses and install platforms;android-35 and build-tools;34.0.0.
./gradlew --no-daemon :app:test :app:lintRelease :app:assembleRelease
./gradlew --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest
```

Without signing environment variables the release output is explicitly unsigned:
`app/build/outputs/apk/release/app-release-unsigned.apk`. It is not installable
until signed. The debug APK at `app/build/outputs/apk/debug/app-debug.apk` is
installable but uses a development signing identity.

Release signing uses all of:

- `STILLWAVE_KEYSTORE`: absolute path to a keystore **outside the repository**.
- `STILLWAVE_STORE_PASSWORD`
- `STILLWAVE_KEY_PASSWORD`
- Key alias must be `stillwave`.

A partially configured signing environment fails instead of silently producing
an unsigned build. When complete, output is `app/build/outputs/apk/release/app-release.apk`.
Keep the same signing key for future app updates. Never commit signing material.

## GitHub Actions

`.github/workflows/android.yml` runs on relevant pushes and `workflow_dispatch`:

1. Java 17, Gradle 8.9, Android SDK 35, core tests, Android lint, signed release,
   debug app, and the dependency-free instrumentation APK.
2. Keystore is decoded to `$RUNNER_TEMP`, never the checkout. CI **requires**
   `STILLWAVE_KEYSTORE_B64`, `STILLWAVE_STORE_PASSWORD`, and
   `STILLWAVE_KEY_PASSWORD` GitHub repository secrets; there is no unsigned CI fallback.
3. `apksigner verify --verbose --print-certs` verifies the release artifact.
4. Artifact **`stillwave-apk`** contains the signed release APK.
5. API 26, 29 and 35 x86_64 emulator jobs download the debug APKs and cold-launch
   after `pm clear`, with airplane mode set, Wi-Fi/mobile data disabled, and
   notification permission explicitly denied on API 33+.

The emulator test checks bundled modules and initialized UI, native bridge,
AudioTrack frame production, pause/retained elapsed, resume/rapid resume,
notification play/pause/stop PendingIntents, background/screen-off frame
production, wake-lock acquisition/release, stop/reset and notification cleanup.
Security assertions cover the manifest's lack of Internet permission, local
HTTPS origin validation, traversal/foreign origins and JavaScript MIME.
Logs, service/media-session dumps and a screenshot are retained as artifacts.
Jobs are bounded by timeouts; public GitHub-hosted runners need no paid service.

Run the same emulator test manually with a running emulator/device:

```sh
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
bash ci-offline-test.sh
# This test clears app data, changes radios, denies notifications, and sleeps the screen.
```

`ci-offline-test.sh` fails unless the runner explicitly reports completion;
`adb am instrument` returning exit code zero alone is not accepted as success.
`connectedDebugAndroidTest` can also run the custom platform instrumentation
runner after configuring the emulator's airplane/permission state.

## Native bridge contract

The bundled UI uses `window.NativeAudio`:

```js
NativeAudio.start(JSON.stringify(settings)); // starts or resumes
NativeAudio.pause();                         // retains elapsed
NativeAudio.stop();                          // stops, releases, resets elapsed
NativeAudio.update(JSON.stringify(settings));// smoothed live changes
JSON.parse(NativeAudio.getState());          // safe from the WebView bridge thread
```

Required state fields are `{playing: boolean, elapsed: seconds}` with optional
`error: string`. Diagnostic fields are `renderedFrames`, `sampleRate`, and
`wakeLockHeld`. `elapsed` uses a synchronized monotonic clock, never wall time;
pause time is excluded. Short fade/drain tails after a pause are not charged.
The service does not auto-restart audio after process death or reboot.

Settings: mode `focus|relax|sleep|meditate`; style
`ambient|lofi|deep|glass|drift|tape`; synth `sine|triangle|fm|organ`; volume 0–1,
intensity 0–0.6, pulse rate 0.25–32 Hz; ambience
`none|rain|brown|pink|ocean|wind|fire`, ambience volume 0–1; brightness, space,
stereo, density, musicVolume, bassVolume and melodyVolume each 0–1; duration
exactly 0/15/25/45/60/90 minutes; positive JS-safe integer seed.
Native accepts `rate` and the web UI's `rateHz` alias. Missing update fields
retain their existing values. Values are bounded, nonfinite values get defaults,
and malformed settings produce a recoverable error rather than a crash.
Default mode rates are 16/8/1/6 Hz and defaults match the web UI. UI-only theme,
spacing, text-size and visual-display preferences are not synthesis controls.
Browser and native synthesis share the control contract, not bit-identical DSP.
For a consistent fresh seed, Stop then Start after editing; resume is not a restart.

## Playback and security architecture

- `MainActivity` loads only
  `https://appassets.androidplatform.net/assets/web/index.html`.
  `shouldInterceptRequest` maps strictly validated paths to bundled assets,
  assigns ES-module MIME types, blocks other requests and supplies a restrictive
  CSP. No remote navigation, external intents, file/content access, remote media,
  CDN, microphone, storage, or Internet permission. DOM storage persists locally.
- `PlaybackService` is non-exported, `mediaPlayback` foreground type. It enters
  foreground before requesting audio focus, as required for target 35. Native
  MediaSession and immutable explicit PendingIntents implement transport controls.
  Notification denial does not bypass foreground policy. MediaSession playback
  notifications are an Android notification-permission exemption.
- Audio focus loss (including transient/duck requests) and unplugging headphones
  pause; gain does not unexpectedly auto-resume. The Activity can close while
  service playback continues.
- `AudioEngine` owns a single audio-priority worker and streaming stereo PCM-float
  AudioTrack, 44.1 kHz with 48 kHz fallback, 1,024-frame chunks. No UI synthesis.
  A partial wake lock is held only during playback/fade/drain, renewed while
  playing with an expiry safety net, and released on pause, errors and cleanup.
  Closing is asynchronous to avoid blocking the UI; the worker drains its fade,
  releases AudioTrack and exits. A paused worker waits rather than spinning.
- `SignalGenerator` is pure Java: evolving chord pads, bass, gentle notes and
  generated textures and four crossfaded synth timbres. Sinusoidal AM acts on the
  broad pad/melody bus, with separate bass/atmosphere paths; this is not the
  paper's 200–1000 Hz band-limited stimulus. Controls and frequencies interpolate,
  starts/resumes fade in,
  pauses/stops fade out and drain before pausing output. A bounded tanh output
  preserves headroom. No medical/clinical effectiveness claim is made.

Battery restrictions and vendor task killers may still interrupt background
playback. Emulator frame production is not a measurement of acoustic output,
phone battery use, long-session stability or vendor-specific screen-off behavior.

## Tests and verification performed

```sh
JAVA_HOME=/path/to/jdk-17 ./run-core-tests.sh
```

The pure Java suite needs no SDK, Gradle, Android classes, JUnit, or network.
It covers bounded/invalid settings, shared defaults and aliases, deterministic
seeded output, exact stereo sample duration, finite/nonzero RMS, headroom,
zero-volume silence, fade-to-silence, smooth live changes, AM behavior, buffer
validation, and monotonic pause/resume/reset.

Observed local JVM output:

```text
PASS 124 expansion scenarios
Audio metrics: RMS=0.04396 peak=0.13504 maxStep=0.00446 liveMaxStep=0.08523
PASS 176442 core assertions
```

The assertion count includes individual sample finite/headroom checks. TDD red
runs first demonstrated missing Settings, SignalGenerator and SessionClock, and
later caught the native/web rate alias and negative timer becoming unlimited.
Android sources and instrumentation APK have actually compiled locally with SDK
35/JDK 17; release lint and debug/unsigned release assembly have passed. Lint's
JavaScript-enabled warning is expected for the strictly bundled-only WebView.

**Verified locally:** signed release assembly and v2 APK signature verification,
release lint, debug/test APK compilation, pure Java tests, and exact parity of all
14 bundled web files. The UI ships a classic Chromium61/ES2017-compatible
bundle; Android tests poll its actual initialized controls and start playback by
clicking the real player button. Source freshness and legacy-runtime regressions
are also checked before CI packaging.

**1.1.0 runtime verification passed:** [CI run 43152424725](https://github.com/clavum-figendi/stillwave/actions/runs/43152424725)
passed on API26, API29 and API35 (Android 8, 10 and 15). Each job cold-launched
after clearing app data with airplane mode enabled, Wi-Fi disabled and no active
default network. The tests exercised expanded real DOM controls reaching validated native
settings, the actual player button, native AudioTrack
frames, pause/resume/stop, notification controls, screen-off playback, wake-lock
release and notification cleanup. Android 13+ notifications were denied.

The emulator runtime tests used the debug APK of the same production source.
The signed release was separately checked for signature identity, version,
permissions, ZIP integrity and byte-for-byte bundled-asset parity. Physical
phones, OEM battery restrictions and long-session acoustic/battery performance
remain untested. No rooting is required to install or run Stillwave; only old
CI emulator images use privileged test setup to switch off their radios.
