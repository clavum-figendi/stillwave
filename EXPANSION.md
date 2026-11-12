# Stillwave 1.1 expansion

## Acceptance criteria
- Preserve web + APK offline contracts, no runtime external dependencies, first launch bundled native audio, old Chrome 61 WebView baseline, no Internet permission.
- Six compositional styles: ambient, lofi, deep, glass, drift, tape. Four synth timbres: sine, triangle, fm, organ.
- Seven atmosphere choices: none, rain, brown, pink, ocean, wind, fire. Clearly describe them as synthesized textures, not field recordings.
- Shared numeric sound controls (0..1): brightness=.5, space=.25, stereo=.65, density=.5, musicVolume=.8, bassVolume=.5, melodyVolume=.5. Retain volume, intensity, rateHz, ambienceVolume, seed, mode, duration. All controls must audibly affect real rendered audio in web and native; algorithms need not be bit-identical.
- Persistent UI controls in existing settings storage: theme=paper (paper, graphite, moss, sand, dusk, night); uiDensity=comfortable (comfortable, compact); textScale=1 (1,1.15,1.3); motionEnabled=true, visualizer=true. Native may ignore UI-only values.
- Instrument/Operate surface: no marketing hero, generic SaaS feature cards, gradients/glass/orbs, default Inter/system-ui. Useful hierarchy, large phone controls, persistent transport, progressive disclosure; genuinely distinct selectable visual palettes with accessible contrast. Choose Georgia editorial headings and Trebuchet MS/humanist control stack or bundled licensed font. No network fonts.
- Real Web Audio oscilloscope when available, clearly labeled illustrative modulation display in native (no pretending to measure output). Pause/stop visual motion appropriately; respect reduced motion and visibility.
- Contextual helpers, getting-started/reset/preset helpers, documented speakers/headphones and pulse off; citations and credits readable offline. Source findings to be supplied by parent at web/RESEARCH.md. Do not claim scientific equivalence to Brain.fm.
- New controls, themes, state migration, real audio differences, native settings, baseline regression suites, mobile/desktop screenshot review, offline behavior tested. Independent spec then code-quality reviews. Build version 1.1.0 code 3; sign, verify and deliver same signing identity and hosted update.

## Ownership
- Audio worker owns web/js/settings.js, web/js/audio.js, android audio settings/generator + related DSP and normalization tests.
- UI worker owns web/index.html, web/styles.css, web/js/app.js, web/sw.js, UI/browser tests (new expansion_ui_test.py), help/credits UI. Do not change settings/audio or Android Java.
- Parent owns integration, verified research copy, build/package changes, CI, release, broad regression fixes, final reviews and delivery. Do not commit other workers' files or reset the working tree.
