// Deterministic generative composer. Mirrors android/.../audio/Composer.java line for line:
// keep both in step. It decides *what* to play, one bar at a time; synth.js decides how it sounds.

export class Rng {
  constructor(seed) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next() { let x = this.s; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this.s = x; return x / 4294967296; }
  int(n) { return Math.floor(this.next() * n); }
  range(a, b) { return a + (b - a) * this.next(); }
  chance(p) { return this.next() < p; }
}

// Instruments and layers are shared integer codes (see Synth.java).
export const I = {SINE: 0, TRI: 1, WARM: 2, FMPAD: 3, ORGAN: 4, EPIANO: 5, BELL: 6, PLUCK: 7, PIANO: 8, MALLET: 9, CHOIR: 10, FLUTE: 11,
  BASS: 12, SUB: 13, SYNTH: 14, GLASS: 15, KICK: 16, SNARE: 17, HAT: 18, SHAKER: 19, RIM: 20, BRUSH: 21};
export const L = {PAD: 0, ARP: 1, MELODY: 2, BASS: 3, DRUMS: 4};
export const SYNTH_OVERRIDE = {sine: I.SINE, triangle: I.TRI, warm: I.WARM, fm: I.FMPAD, organ: I.ORGAN, epiano: I.EPIANO, bell: I.BELL, pluck: I.PLUCK};

const SCALE_STEPS = {major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10]};
const MINORISH = {minor: true, dorian: true};
// Pentatonic subsets (scale-degree indices) avoid the half-step tensions of each mode.
const PENTA_MAJOR = [0, 1, 2, 4, 5], PENTA_MINOR = [0, 2, 3, 4, 6];

// Harmonic languages: weighted Markov transitions between scale degrees 0..6.
const LANGS = {
  bright: [[[3, 3], [5, 3], [4, 2], [1, 1.5], [2, 1]], [[4, 4], [3, 1], [0, 1]], [[5, 3], [3, 2]], [[0, 3], [4, 3], [1, 1.5], [5, 1]], [[0, 4], [5, 2], [3, 1]], [[3, 3], [1, 2], [4, 2], [2, 1]], [[0, 3], [2, 1]]],
  jazz: [[[5, 3], [1, 2], [3, 2], [2, 1]], [[4, 5], [6, 1]], [[5, 3], [1, 1]], [[4, 2], [1, 2], [2, 1], [0, 1]], [[0, 4], [2, 1], [5, 1]], [[1, 4], [3, 2]], [[2, 2], [0, 1]]],
  modal: [[[6, 3], [5, 3], [3, 2], [2, 1]], [[0, 2], [6, 1]], [[5, 2], [6, 2]], [[0, 3], [6, 1], [5, 1]], [[0, 3], [5, 1]], [[6, 3], [0, 2], [3, 1]], [[0, 4], [5, 1]]],
};
const LOOPS = [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4], [0, 3, 5, 4], [3, 0, 4, 5], [0, 6, 5, 6], [0, 3, 6, 5], [0, 2, 3, 4]];

const recipe = (o) => o;
// One recipe per style: tempo, harmony, instruments, patterns and space.
export const STYLE = {
  ambient: recipe({bpm: [62, 72], lang: 'bright', scales: ['major', 'lydian'], penta: false, bars: 2, ext: 2, pad: I.WARM, comp: 'swell', padLo: 50, padHi: 74, bass: I.SUB, bassPat: 'drone', lead: I.BELL, leadRate: .45, leadLo: 70, leadHi: 88, grid: 8, arp: -1, arpPat: '', spark: I.GLASS, kit: '', swing: 0, reverb: .85, delay: .3, tape: 0, vinyl: 0}),
  lofi: recipe({bpm: [70, 86], lang: 'jazz', scales: ['major', 'dorian'], penta: false, bars: 1, ext: 2, pad: I.EPIANO, comp: 'stab', padLo: 50, padHi: 72, bass: I.BASS, bassPat: 'walk', lead: I.PLUCK, leadRate: .9, leadLo: 64, leadHi: 84, grid: 16, arp: -1, arpPat: '', spark: -1, kit: 'lofi', swing: .17, reverb: .45, delay: .15, tape: .5, vinyl: .6}),
  piano: recipe({bpm: [58, 70], lang: 'bright', scales: ['major', 'minor'], penta: false, bars: 1, ext: 1, pad: I.PIANO, comp: 'broken', padLo: 48, padHi: 70, bass: I.PIANO, bassPat: 'roots', lead: I.PIANO, leadRate: .75, leadLo: 67, leadHi: 88, grid: 8, arp: -1, arpPat: '', spark: -1, kit: '', swing: 0, reverb: .6, delay: .08, tape: 0, vinyl: 0}),
  kalimba: recipe({bpm: [92, 108], lang: 'loop', scales: ['major', 'mixolydian'], penta: true, bars: 1, ext: 0, pad: I.SINE, comp: 'hold', padLo: 52, padHi: 70, bass: I.PLUCK, bassPat: 'roots', lead: I.MALLET, leadRate: .8, leadLo: 72, leadHi: 90, grid: 8, arp: I.MALLET, arpPat: 'random', spark: -1, kit: 'shaker', swing: .06, reverb: .45, delay: .35, tape: 0, vinyl: 0}),
  pulse: recipe({bpm: [104, 120], lang: 'loop', scales: ['minor', 'dorian'], penta: false, bars: 2, ext: 1, pad: I.WARM, comp: 'hold', padLo: 50, padHi: 70, bass: I.BASS, bassPat: 'pulse', lead: I.BELL, leadRate: .35, leadLo: 72, leadHi: 88, grid: 8, arp: I.SYNTH, arpPat: 'phase', spark: -1, kit: 'pulse', swing: 0, reverb: .5, delay: .4, tape: 0, vinyl: 0}),
  glass: recipe({bpm: [84, 98], lang: 'loop', scales: ['lydian', 'major'], penta: true, bars: 1, ext: 2, pad: I.FMPAD, comp: 'swell', padLo: 55, padHi: 76, bass: I.SUB, bassPat: 'roots', lead: I.GLASS, leadRate: .55, leadLo: 76, leadHi: 96, grid: 8, arp: I.BELL, arpPat: 'updown', spark: I.GLASS, kit: '', swing: 0, reverb: .7, delay: .5, tape: 0, vinyl: 0}),
  drift: recipe({bpm: [50, 58], lang: 'modal', scales: ['dorian', 'lydian', 'minor'], penta: false, bars: 4, ext: 2, pad: I.WARM, comp: 'swell', padLo: 48, padHi: 72, bass: I.SUB, bassPat: 'drone', lead: I.FLUTE, leadRate: .3, leadLo: 64, leadHi: 82, grid: 8, arp: -1, arpPat: '', spark: I.BELL, kit: '', swing: 0, reverb: 1, delay: .3, tape: .2, vinyl: 0}),
  choir: recipe({bpm: [54, 64], lang: 'modal', scales: ['minor', 'dorian', 'major'], penta: false, bars: 2, ext: 1, pad: I.CHOIR, comp: 'swell', padLo: 50, padHi: 72, bass: I.SUB, bassPat: 'drone', lead: I.FLUTE, leadRate: .35, leadLo: 65, leadHi: 82, grid: 8, arp: -1, arpPat: '', spark: I.BELL, kit: '', swing: 0, reverb: .95, delay: .15, tape: 0, vinyl: 0}),
  tape: recipe({bpm: [66, 78], lang: 'bright', scales: ['major', 'mixolydian'], penta: false, bars: 2, ext: 1, pad: I.ORGAN, comp: 'hold', padLo: 50, padHi: 72, bass: I.BASS, bassPat: 'roots', lead: I.FLUTE, leadRate: .7, leadLo: 66, leadHi: 84, grid: 8, arp: -1, arpPat: '', spark: -1, kit: 'brush', swing: .1, reverb: .4, delay: .2, tape: 1, vinyl: .3}),
  deep: recipe({bpm: [48, 56], lang: 'modal', scales: ['minor', 'dorian'], penta: false, bars: 4, ext: 1, pad: I.TRI, comp: 'swell', padLo: 40, padHi: 62, bass: I.SUB, bassPat: 'drone', lead: I.FLUTE, leadRate: .2, leadLo: 55, leadHi: 72, grid: 8, arp: -1, arpPat: '', spark: I.BELL, kit: '', swing: 0, reverb: 1, delay: .2, tape: 0, vinyl: 0}),
};
const MODE = {focus: {tempo: 1, energy: 1, drums: true}, relax: {tempo: .9, energy: .85, drums: true}, meditate: {tempo: .85, energy: .7, drums: false}, sleep: {tempo: .78, energy: .5, drums: false}};
// Drum patterns: 16 steps per bar, values are hit probabilities × velocity.
const KITS = {
  lofi: [[I.KICK, [1, 0, 0, 0, 0, 0, 0, .35, 0, 0, .9, 0, 0, 0, 0, 0]], [I.SNARE, [0, 0, 0, 0, .85, 0, 0, 0, 0, 0, 0, 0, .85, 0, 0, .15]], [I.HAT, [.6, 0, .45, 0, .6, 0, .45, 0, .6, 0, .45, 0, .6, 0, .45, .3]]],
  pulse: [[I.KICK, [.7, 0, 0, 0, .7, 0, 0, 0, .7, 0, 0, 0, .7, 0, 0, 0]], [I.HAT, [0, 0, .5, 0, 0, 0, .5, 0, 0, 0, .5, 0, 0, 0, .5, 0]], [I.SHAKER, [.25, .15, .25, .15, .25, .15, .25, .15, .25, .15, .25, .15, .25, .15, .25, .15]]],
  shaker: [[I.SHAKER, [.5, 0, .3, 0, .5, 0, .3, 0, .5, 0, .3, 0, .5, 0, .3, .2]], [I.RIM, [0, 0, 0, 0, 0, 0, .3, 0, 0, 0, 0, 0, 0, 0, .25, 0]]],
  brush: [[I.KICK, [.6, 0, 0, 0, 0, 0, 0, 0, .5, 0, 0, 0, 0, 0, 0, 0]], [I.BRUSH, [0, 0, 0, 0, .7, 0, 0, 0, 0, 0, 0, 0, .7, 0, 0, 0]], [I.HAT, [.3, 0, .2, 0, .3, 0, .2, 0, .3, 0, .2, 0, .3, 0, .2, 0]]],
};

export class Composer {
  constructor(settings) {
    this.rng = new Rng(settings.seed);
    this.prev = [0, 0, 0, 0, 0];
    this.prevCount = 0;
    this.motif = new Float64Array(32); // triples: step, length(steps), interval
    this.motifCount = 0;
    this.motifB = new Float64Array(32);
    this.motifBCount = 0;
    this.home = [0, 0, 0, 0];
    this.phrase = [0, 0, 0, 0];
    this.chordTones = [0, 0, 0, 0, 0];
    this.chordCount = 0;
    this.leadNote = 0;
    this.arpStep = 0;
    this.configure(settings, true);
  }

  /** Applies new settings at the next bar; keeps key, phrase and motif unless the style or key changes. */
  configure(s, initial) {
    const styleChanged = initial || s.style !== this.styleName;
    this.settings = s;
    this.styleName = s.style;
    this.style = STYLE[s.style] || STYLE.ambient;
    this.mode = MODE[s.mode] || MODE.focus;
    if (styleChanged || s.key !== this.keySetting || s.scale !== this.scaleSetting) {
      const st = this.style;
      this.keySetting = s.key; this.scaleSetting = s.scale;
      this.root = 48 + (s.key >= 0 ? s.key : this.rng.int(12));
      if (this.root > 54) this.root -= 12;
      this.scaleName = s.scale !== 'auto' ? s.scale : st.scales[this.rng.int(st.scales.length)];
      this.baseBpm = st.bpm[0] + (st.bpm[1] - st.bpm[0]) * this.rng.next();
      this.newHome();
      this.barInPhrase = 0; this.phraseCount = 0; this.sectionPhrase = 0;
      this.energy = .3; this.energyTarget = .5;
      this.copyPhrase(this.home);
      this.makeMotif(this.motif, true);
      this.makeMotif(this.motifB, false);
      this.leadNote = (st.leadLo + st.leadHi) >> 1;
    }
    this.scale = SCALE_STEPS[this.scaleName];
    this.chordBars = this.style.bars * (this.settings.mode === 'sleep' || (this.settings.mode === 'meditate' && this.style.bars === 1) ? 2 : 1);
    this.bpm = this.baseBpm * this.mode.tempo;
  }

  pickWeighted(options) {
    let total = 0;
    for (let i = 0; i < options.length; i++) total += options[i][1];
    let r = this.rng.next() * total;
    for (let i = 0; i < options.length; i++) { r -= options[i][1]; if (r <= 0) return options[i][0]; }
    return options[options.length - 1][0];
  }

  newHome() {
    if (this.style.lang === 'loop') { const loop = LOOPS[this.rng.int(LOOPS.length)]; for (let i = 0; i < 4; i++) this.home[i] = loop[i]; return; }
    const table = LANGS[this.style.lang];
    let degree = 0;
    this.home[0] = 0;
    for (let i = 1; i < 4; i++) { degree = this.pickWeighted(table[degree]); this.home[i] = degree; }
    if (this.home[3] === 0) this.home[3] = this.style.lang === 'modal' ? 6 : 4;
  }

  copyPhrase(source) { for (let i = 0; i < 4; i++) this.phrase[i] = source[i]; }

  /** A 2-bar motif: rhythm on the style grid plus scale-step intervals; `answer` rises, the other falls. */
  makeMotif(target, question) {
    const st = this.style, steps = st.grid * 2, stride = st.grid === 16 ? 2 : 1;
    let count = 0, step = this.rng.chance(.4) ? stride : 0;
    while (step < steps - stride && count < 10) {
      const lengths = st.grid === 16 ? [2, 2, 4, 3, 6] : [1, 2, 2, 3, 4];
      const length = lengths[this.rng.int(lengths.length)];
      const interval = this.rng.chance(.15) ? (this.rng.chance(.5) ? 3 : -3) : this.rng.int(5) - 2;
      target[count * 3] = step; target[count * 3 + 1] = length; target[count * 3 + 2] = question ? interval : -Math.abs(interval) + (this.rng.chance(.3) ? 1 : 0);
      count++;
      step += length + (this.rng.chance(.25) ? stride * 2 : 0);
    }
    target[(count - 1) * 3 + 1] = Math.max(target[(count - 1) * 3 + 1], st.grid === 16 ? 6 : 3);
    if (target === this.motif) this.motifCount = count; else this.motifBCount = count;
  }

  pitch(degree) { const d = ((degree % 7) + 7) % 7; return this.root + this.scale[d] + 12 * Math.floor(degree / 7); }

  buildChord(degree) {
    const extra = this.style.ext;
    let n = 0;
    const tones = [0, 2, 4, 6, 8];
    const count = extra === 0 ? 3 : extra === 1 ? 4 : 5;
    for (let i = 0; i < count; i++) {
      // Five-note chords often drop the 5th so the 9th stays clear.
      if (count === 5 && i === 2 && this.rng.chance(.6)) continue;
      if (i === 4 && ((this.pitch(degree + 8) - this.pitch(degree)) % 12 + 12) % 12 !== 2) continue; // only major 9ths
      this.chordTones[n++] = this.pitch(degree + tones[i]) % 12;
    }
    this.chordCount = n;
  }

  /** Voice-leading: choose the inversion closest to the previous voicing inside the register. */
  voice(out, lo, hi) {
    const n = this.chordCount, tones = this.chordTones;
    let best = -1, bestCost = 1e9;
    const candidate = [0, 0, 0, 0, 0];
    for (let r = 0; r < n; r++) {
      let note = lo + ((tones[r] - lo) % 12 + 12) % 12;
      for (let k = 0; k < n; k++) {
        const pc = tones[(r + k) % n];
        if (k > 0) { note += ((pc - note) % 12 + 12) % 12; if (note <= candidate[k - 1]) note += 12; }
        candidate[k] = note;
      }
      if (candidate[n - 1] > hi + 4) continue;
      let cost = 0;
      if (this.prevCount === n) for (let k = 0; k < n; k++) cost += Math.abs(candidate[k] - this.prev[k]);
      else cost = Math.abs(candidate[0] + candidate[n - 1] - lo - hi);
      cost += this.rng.next() * .5;
      if (cost < bestCost) { bestCost = cost; best = r; for (let k = 0; k < n; k++) out[k] = candidate[k]; }
    }
    if (best < 0) { for (let k = 0; k < n; k++) out[k] = lo + ((tones[k] - lo) % 12 + 12) % 12 + (k > 0 && tones[k] < tones[0] ? 12 : 0); }
    for (let k = 0; k < n; k++) this.prev[k] = out[k];
    this.prevCount = n;
    return n;
  }

  nextPhrase() {
    this.phraseCount++; this.sectionPhrase++;
    if (this.sectionPhrase >= 4) {
      this.sectionPhrase = 0;
      // A new section: sometimes new home progression, occasionally a gentle key change for long sessions.
      if (this.rng.chance(.5)) this.newHome();
      if (this.settings.key < 0 && this.rng.chance(.25)) { this.root += this.rng.chance(.5) ? 5 : -5; if (this.root > 55) this.root -= 12; if (this.root < 43) this.root += 12; }
      this.makeMotif(this.motif, true);
    }
    const form = this.sectionPhrase; // A A B A
    this.copyPhrase(this.home);
    if (form === 2) {
      const changes = 1 + this.rng.int(2);
      for (let c = 0; c < changes; c++) {
        const at = 1 + this.rng.int(3), table = LANGS[this.style.lang === 'loop' ? 'bright' : this.style.lang];
        this.phrase[at] = this.pickWeighted(table[this.phrase[at - 1]]);
      }
      this.makeMotif(this.motifB, false);
    }
    this.barInPhrase = 0;
  }

  /** Emits one bar of events through sink.note(beat, beats, midi, velocity, instrument, layer, pan). */
  bar(sink) {
    const st = this.style, s = this.settings, rng = this.rng;
    if (this.barInPhrase >= this.chordBars * 4) this.nextPhrase();
    const chordIndex = Math.floor(this.barInPhrase / this.chordBars), chordStart = this.barInPhrase % this.chordBars === 0;
    const degree = this.phrase[chordIndex];
    this.buildChord(degree);
    if ((this.phraseCount * 16 + this.barInPhrase) % 8 === 0) this.energyTarget = Math.max(.05, Math.min(1, .15 + .75 * s.density * this.mode.energy + rng.range(-.25, .25)));
    this.energy += (this.energyTarget - this.energy) * .35;
    const e = this.energy, density = .4 + s.density * 1.2;
    const padInst = s.synth !== 'auto' && SYNTH_OVERRIDE[s.synth] !== undefined ? SYNTH_OVERRIDE[s.synth] : st.pad;
    const voicing = [0, 0, 0, 0, 0];
    const n = this.voice(voicing, st.padLo, st.padHi);
    const rootMidi = this.pitch(degree) % 12;
    const bassRoot = 36 + ((rootMidi - 36) % 12 + 12) % 12;
    const swing = st.swing;
    const at16 = step => step / 4 + (step % 2 === 1 ? swing : 0);

    // Harmony
    if (st.comp === 'swell' || st.comp === 'hold') {
      if (chordStart) {
        const length = this.chordBars * 4 + (st.comp === 'swell' ? 1.5 : .25);
        for (let k = 0; k < n; k++) sink.note(k * (st.comp === 'swell' ? .12 : .02), length, voicing[k], .5 - k * .04, padInst, L.PAD, (k / Math.max(1, n - 1) - .5) * .8);
      }
    } else if (st.comp === 'stab') {
      const hits = rng.chance(.5) ? [0, 6] : rng.chance(.5) ? [0, 7, 10] : [2, 8];
      for (let h = 0; h < hits.length; h++) for (let k = 0; k < n; k++) sink.note(at16(hits[h]) + k * .012, h === hits.length - 1 ? 2.5 : 1.4, voicing[k], .42 - k * .03 + rng.range(-.04, .04), padInst, L.PAD, (k / Math.max(1, n - 1) - .5) * .6);
    } else if (st.comp === 'broken') {
      const pattern = rng.chance(.5) ? [0, 1, 2, 3, 2, 1, 2, 3] : [0, 2, 1, 3, 0, 2, 1, 3];
      for (let i = 0; i < 8; i++) { if (i > 0 && rng.next() > .5 + e * .5) continue; const note = voicing[pattern[i] % n]; sink.note(i * .5 + rng.range(0, .02), 3, note, .32 + (i === 0 ? .12 : 0) + rng.range(-.05, .05), padInst, L.PAD, (pattern[i] / 3 - .5) * .5); }
    }

    // Bass
    if (st.bassPat === 'drone') { if (chordStart) sink.note(0, this.chordBars * 4 + 1, bassRoot, .55, st.bass, L.BASS, 0); }
    else if (st.bassPat === 'roots') { sink.note(0, 2.5, bassRoot, .6, st.bass, L.BASS, 0); if (rng.chance(.4 + e * .4)) sink.note(2, 1.8, bassRoot + (rng.chance(.6) ? 7 : 12), .45, st.bass, L.BASS, 0); }
    else if (st.bassPat === 'walk') {
      const next = this.pitch(this.phrase[(chordIndex + 1) % 4]) % 12, target = 36 + ((next - 36) % 12 + 12) % 12;
      const line = [bassRoot, bassRoot + (rng.chance(.5) ? 7 : 4), bassRoot + (rng.chance(.5) ? 12 : 9), target + (rng.chance(.5) ? -1 : 1)];
      for (let b = 0; b < 4; b++) if (b === 0 || rng.chance(.35 + e * .5)) sink.note(b + (b % 2 ? swing * .5 : 0), .9, line[b], .55, st.bass, L.BASS, 0);
    } else if (st.bassPat === 'pulse') { for (let i = 0; i < 8; i++) sink.note(i * .5, .4, bassRoot + (i % 4 === 3 && rng.chance(.4) ? 12 : 0), i % 2 ? .38 : .5, st.bass, L.BASS, 0); }

    // Arpeggio
    if (st.arp >= 0 && (st.arpPat === 'phase' || e > .3)) {
      const grid = st.arpPat === 'phase' || st.arpPat === 'updown' ? 16 : 8;
      for (let i = 0; i < grid; i++) {
        let idx;
        if (st.arpPat === 'phase') idx = (this.arpStep * 3 + (this.arpStep >> 2)) % (n + 1); // 3-step cycle drifting against the bar
        else if (st.arpPat === 'updown') { const span = n * 2 - 2; const p = this.arpStep % Math.max(1, span); idx = p < n ? p : span - p; }
        else idx = rng.int(n + 1);
        this.arpStep++;
        if (rng.next() > (st.arpPat === 'phase' ? .92 : .25 + e * .55 * density)) continue;
        const note = (idx >= n ? voicing[0] + 12 : voicing[idx]) + 12 - (st.arp === I.SYNTH ? 12 : 0);
        sink.note(i * 4 / grid, grid === 16 ? .45 : .9, this.melodic(note), (st.arpPat === 'phase' ? .3 : .26) + (i % 4 === 0 ? .08 : 0) + rng.range(-.04, .04), st.arp, L.ARP, Math.sin(this.arpStep * .7) * .6);
      }
    }

    // Melody: motif A or B, varied on repetition, resting in some phrases.
    const playLead = s.melodyVolume > 0 && e > .25 && (this.sectionPhrase !== 1 || e > .55) && rng.next() < .55 + e * .5;
    if (playLead) {
      const motif = this.sectionPhrase === 2 ? this.motifB : this.motif, count = this.sectionPhrase === 2 ? this.motifBCount : this.motifCount;
      const half = this.barInPhrase % 2, stepsPerBar = st.grid, beat = 4 / stepsPerBar, phraseEnd = this.barInPhrase === this.chordBars * 4 - 1;
      if (this.barInPhrase === 0) this.leadNote = this.nearestChordTone((st.leadLo + st.leadHi) >> 1);
      for (let m = 0; m < count; m++) {
        const step = motif[m * 3], length = motif[m * 3 + 1];
        if (Math.floor(step / stepsPerBar) !== half) continue;
        if (rng.next() > st.leadRate * density + .15) continue;
        let interval = motif[m * 3 + 2];
        if (this.phraseCount % 2 === 1 && rng.chance(.3)) interval = -interval; // inversion variant
        let note = this.stepScale(this.leadNote, interval);
        const local = step % stepsPerBar;
        if (local % (stepsPerBar / 2) === 0) note = this.nearestChordTone(note);
        while (note > st.leadHi) note -= 12;
        while (note < st.leadLo) note += 12;
        this.leadNote = note;
        const last = phraseEnd && m === count - 1;
        sink.note(local * beat + (local % 2 === 1 && stepsPerBar === 16 ? swing : 0) + rng.range(0, .015), length * beat * (last ? 2 : 1.1), last ? this.nearestChordTone(note) : note, .5 + rng.range(-.08, .08), st.lead, L.MELODY, rng.range(-.3, .3));
      }
    }

    // Sparkles: rare high notes that drift across the stereo field.
    if (st.spark >= 0 && rng.chance(.12 + e * .25)) {
      const note = this.melodic(this.nearestChordTone(st.leadLo + 12 + rng.int(10)));
      sink.note(rng.int(8) * .5, 3, note, .22 + rng.range(0, .1), st.spark, L.MELODY, rng.range(-.8, .8));
    }

    // Drums
    if (st.kit && this.mode.drums && s.beatVolume > 0 && (e > .2 || st.kit === 'pulse')) {
      const kit = KITS[st.kit], fill = this.barInPhrase === this.chordBars * 4 - 1;
      for (let d = 0; d < kit.length; d++) {
        const inst = kit[d][0], pattern = kit[d][1];
        for (let i = 0; i < 16; i++) {
          let p = pattern[i];
          if (fill && i >= 12 && inst !== I.KICK) p = Math.max(p, .35);
          if (p <= 0 || rng.next() > Math.min(1, p * (.55 + e * .6))) continue;
          sink.note(at16(i) + rng.range(0, .012), .25, 60, Math.min(1, p * .9 + rng.range(-.1, .1)), inst, L.DRUMS, inst === I.HAT || inst === I.SHAKER ? .25 : 0);
        }
      }
    }
    this.barInPhrase++;
  }

  melodic(note) {
    if (!this.style.penta) return note;
    const allowed = MINORISH[this.scaleName] ? PENTA_MINOR : PENTA_MAJOR;
    for (let offset = 0; offset < 3; offset++) for (let sign = 0; sign < 2; sign++) {
      const candidate = note + (sign ? -offset : offset);
      for (let a = 0; a < allowed.length; a++) if (((candidate - this.root - this.scale[allowed[a]]) % 12 + 12) % 12 === 0) return candidate;
    }
    return note;
  }

  nearestChordTone(note) {
    let best = note, bestDistance = 99;
    for (let k = 0; k < this.chordCount; k++) for (let o = -1; o <= 1; o++) {
      const candidate = note - ((note - this.chordTones[k]) % 12 + 12) % 12 + o * 12;
      const distance = Math.abs(candidate - note);
      if (distance < bestDistance) { bestDistance = distance; best = candidate; }
    }
    return best;
  }

  /** Moves `steps` scale degrees (or pentatonic degrees) from a MIDI note. */
  stepScale(note, steps) {
    const allowed = this.style.penta ? (MINORISH[this.scaleName] ? PENTA_MINOR : PENTA_MAJOR) : [0, 1, 2, 3, 4, 5, 6];
    const size = allowed.length;
    let index = 0, octave = Math.floor((note - this.root) / 12), best = 99;
    for (let a = 0; a < size; a++) { const d = Math.abs(this.root + 12 * octave + this.scale[allowed[a]] - note); if (d < best) { best = d; index = a; } }
    let position = octave * size + index + steps;
    const o = Math.floor(position / size), i = ((position % size) + size) % size;
    return this.root + 12 * o + this.scale[allowed[i]];
  }
}
