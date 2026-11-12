# Sound, evidence and credits

This text is included with Stillwave so its limitations and references remain available offline. Source pages require an internet connection; the bundled Android sandbox does not navigate to external websites. URLs are provided for opening separately in a browser.

## What the research does — and does not — establish

Woods, Sampaio, James, Przysinda, Cordovez, Hewett, Spencer, Morillon and Loui (2024), *Rapid modulation in music supports attention in listeners with attentional difficulties*, Communications Biology 7, 1376, DOI 10.1038/s42003-024-07026-3, studied amplitude-modulated music, task performance and neural responses. Effects varied with experimental order and listeners' self-reported attentional difficulties; this is not evidence that a particular pulse rate universally improves attention.[1]

For the controlled stimulus manipulation, added modulation was confined to the 200 Hz–1 kHz frequency band, with musical content and spectral balance controlled across conditions.[1] Stillwave instead modulates a generated music bus, with separate bass/atmosphere routing: this is NOT a reproduction of those band-limited stimuli. Relax, Sleep and Meditate are descriptive listening presets, not validated brain states. No study of Stillwave establishes benefits for focus, ADHD, sleep or meditation.

The paper's corrected disclosure states that Kevin J. P. Woods is a Brain.fm employee with unexercised equity options and Adam Hewett was an employee and held equity when the research was conducted.[5] A separate correction added Bernardo Cordovez to the author list.[6] These corrections matter when interpreting the evidence, which should not be presented as independent validation of this app.

## Listening and controls

Stillwave uses amplitude modulation (loudness changes), not binaural beats. Headphones are optional for its operation; stereo width can be set to zero for mono output. This is a signal-processing property, not a claim that speakers and headphones have equal cognitive effects. A waveform indicates software output, not measured loudspeaker pressure or brain activity. In the native app the modulation sketch is illustrative, not an output measurement.

Start quietly and use whichever texture is comfortable. If the pulse distracts you, set Modulation depth to 0%. More depth is not necessarily better. Compare settings at a similar comfortable perceived loudness rather than assuming equal slider positions produce equal perceived volume. Hearing risk depends on loudness and exposure duration; WHO recommends keeping volume down and taking breaks.[2] App volume percentages cannot be converted to safe decibels without calibrated device/headphone measurements. Stop if uncomfortable and do not mask surroundings where awareness matters.

Styles select compositional recipes; synths select oscillator timbres. The atmosphere sounds are synthesized approximations, not field recordings. Brightness changes the music's tone; Space changes the diffusion/reverb mix; Width sets stereo spread; Activity changes note density. Music, Bass and Notes levels balance the layers. Presets are starting points, not promises of outcomes. Stop resets the timer; Pause preserves it; New sound chooses a new procedural seed.

## Credits and independence

- Stillwave: original interface, branding, procedural compositions and Web Audio/native Java synthesis, developed for this project with Hermes Agent (Nous Research) and OpenAI coding assistance. No Brain.fm recordings, private code or branding are included. Stillwave is not affiliated with or endorsed by Brain.fm.
- OpenFM by adam13331 and contributors: an MIT-licensed conceptual reference explored during initial research, not vendored into this implementation. Its README's efficacy claims are not adopted as clinical claims here.[3]
- focusmusic by Petr Brzek: another conceptual reference explored during initial research, not vendored into Stillwave; its README identifies the project as MIT licensed.[7]
- Browser audio uses the standard Web Audio API; MDN contributors' documentation is a technical reference, not clinical evidence.[4]
- Android playback uses Android platform AudioTrack, a foreground playback service and MediaSession. No runtime external audio service, account or paid model API is needed.
- Build tooling: esbuild 0.25.12 (MIT) and acorn (MIT); tests use Playwright (Apache-2.0). These are development tools, not bundled runtime libraries. Android build tooling uses Gradle and the Android Gradle Plugin.
- Typography uses locally available Georgia and Trebuchet MS with serif/humanist sans fallbacks. Fonts are not downloaded or redistributed; appearance depends on fonts installed on the device.
- Stillwave source is MIT licensed. A copyright license does not establish third-party patent clearance.

## Privacy and offline boundary

Preferences stay in local browser/WebView storage. No analytics, microphone use or runtime audio uploads. The host can log ordinary website requests. The web app needs one successful online cache save; browser storage can be evicted. The APK bundles its interface and native generator for first-launch offline use. Browsers may suspend background audio; the Android app uses its native playback service, although manufacturer battery management can still interfere.

## Sources

[1] https://pmc.ncbi.nlm.nih.gov/articles/PMC11499863 — Woods et al. (2024), Rapid modulation in music supports attention in listeners with attentional difficulties
[2] https://www.who.int/news-room/questions-and-answers/item/deafness-and-hearing-loss-safe-listening — WHO, Deafness and hearing loss: Safe listening
[3] https://github.com/adam13331/OpenFM — OpenFM, concept reference
[4] https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API — MDN contributors, Web Audio API
[5] https://pmc.ncbi.nlm.nih.gov/articles/PMC13076772 — 2026 correction: competing interests
[6] https://pmc.ncbi.nlm.nih.gov/articles/PMC12420781 — 2025 correction: author list
[7] https://github.com/petrbrzek/focusmusic — Petr Brzek, focusmusic, conceptual reference
