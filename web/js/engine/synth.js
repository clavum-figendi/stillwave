// Per-sample synthesizer and mixer. Mirrors android/.../audio/SignalGenerator.java: keep both in step.
// Allocation-free after construction; every random value comes from seeded generators.
import {Composer, Rng, I, L} from './composer.js';

const TAU = Math.PI * 2;
const AMBIENCES = ['rain', 'stream', 'ocean', 'wind', 'fire', 'night', 'brown', 'pink'];
// attack s, decay time-constant s, sustain level, release s (to -60 dB), gain
const ENV = [
  [1.2, 3, .8, 2.5, .5], [1.5, 3, .8, 3, .5], [1.8, 4, .75, 3, .32], [1.2, 3, .7, 3, .42], [.08, 2, .85, .6, .3],
  [.004, 1.6, 0, .4, .55], [.003, 2.2, 0, 1.6, .62], [.002, 4, 0, .25, 1.1], [.003, 2.6, 0, .6, .62], [.002, .8, 0, .35, .7],
  [1.6, 4, .8, 3, .2], [.12, 3, .85, .6, .5], [.02, 1.5, .6, .25, .45], [1, 4, .9, 2, .36], [.003, .3, .15, .15, .32],
  [.004, 1.8, 0, 1.3, .58], [.001, .2, 0, .05, .8], [.001, .11, 0, .05, .45], [.001, .035, 0, .02, .16], [.012, .05, 0, .03, .32],
  [.001, .03, 0, .02, .5], [.03, .17, 0, .08, .3],
];
const TONAL_MAX = I.GLASS;

function blep(p, dt) {
  let v = 2 * p - 1;
  if (p < dt) { const t = p / dt; v -= t + t - t * t - 1; } else if (p > 1 - dt) { const t = (p - 1) / dt; v -= t * t + t + t + 1; }
  return v;
}

/** Topology-preserving state-variable filter (Simper). */
class Svf {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 1; this.low = 0; this.band = 0; this.high = 0; }
  set(sampleRate, cutoff, q) {
    const g = Math.tan(Math.PI * Math.min(cutoff, sampleRate * .45) / sampleRate);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  reset() { this.ic1 = 0; this.ic2 = 0; }
  run(v0) {
    const v3 = v0 - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.low = v2; this.band = v1; this.high = v0 - this.k * v1 - v2;
    return v2;
  }
}

export class Voice {
  constructor(sampleRate) {
    this.sr = sampleRate; this.active = false; this.rng = new Rng(1);
    this.ph = new Float64Array(6); this.inc = new Float64Array(6); this.amp = new Float64Array(6); this.coef = new Float64Array(6);
    this.f1 = new Svf(); this.f2 = new Svf(); this.f3 = new Svf();
    this.ks = new Float32Array(Math.ceil(sampleRate / 25) + 4);
  }
  start(inst, layer, midi, velocity, length, pan, seed, brightness) {
    const sr = this.sr, env = ENV[inst];
    this.inst = inst; this.layer = layer; this.active = true; this.t = 0; this.length = length; this.releasing = false;
    this.freq = 440 * Math.pow(2, (midi - 69) / 12);
    this.gain = velocity * env[4];
    this.attack = 1 / Math.max(1, env[0] * sr); this.decay = Math.exp(-1 / (env[1] * sr)); this.sustain = env[2];
    this.release = Math.exp(Math.log(.001) / (env[3] * sr)); this.env = 0; this.stage = 0;
    const angle = (Math.max(-1, Math.min(1, pan)) + 1) * Math.PI / 4;
    this.gl = Math.cos(angle); this.gr = Math.sin(angle);
    this.rng.s = (seed >>> 0) || 1; this.bright = brightness; this.y = 0; this.z = 0; this.w = 0;
    for (let i = 0; i < 6; i++) { this.ph[i] = this.rng.next(); this.amp[i] = 0; }
    this.f1.reset(); this.f2.reset(); this.f3.reset();
    const f = this.freq;
    if (inst === I.WARM) this.f1.set(sr, f * (2 + 7 * brightness), .7);
    else if (inst === I.PIANO) {
      const decay = .55 + f / 700;
      for (let n = 1; n <= 6; n++) {
        this.inc[n - 1] = f * n * Math.sqrt(1 + .00035 * n * n) / sr;
        this.amp[n - 1] = Math.pow(n, -1.4) * (n === 1 ? 1 : .35 + .65 * brightness) * (n > 4 ? .6 : 1);
        this.coef[n - 1] = Math.exp(-decay * (1 + .55 * (n - 1)) / sr);
      }
    } else if (inst === I.PLUCK) {
      const size = this.ks.length, delay = Math.min(size - 3, Math.max(2, sr / f - .5));
      this.delay = delay; this.write = 0; this.ks.fill(0);
      let smooth = 0;
      const a = .06 + (.15 + .45 * brightness) * Math.min(1, f / 600);
      for (let i = 0; i < Math.ceil(delay) + 1; i++) { smooth += a * ((this.rng.next() * 2 - 1) - smooth); this.ks[i] = smooth; }
      this.write = Math.ceil(delay) + 1;
      this.damp = .4985 + .0012 * brightness - Math.min(.004, f / 400000);
    } else if (inst === I.SNARE) this.f1.set(sr, 1800, .8);
    else if (inst === I.HAT) this.f1.set(sr, 7200, .7);
    else if (inst === I.SHAKER) this.f1.set(sr, 5600, 1.4);
    else if (inst === I.RIM) this.f1.set(sr, 2100, 2);
    else if (inst === I.BRUSH) this.f1.set(sr, 4200, .5);
    else if (inst === I.FLUTE) this.f1.set(sr, f * 3, .5);
    else if (inst === I.MALLET) this.f1.set(sr, 2500, .7);
    this.lfo = this.rng.next();
  }
  noise() { return this.rng.next() * 2 - 1; }
  /** One mono sample. pitch is the global tape wow multiplier. */
  next(pitch) {
    const sr = this.sr, f = this.freq, t = this.t / sr, inst = this.inst;
    if (!this.releasing && this.t >= this.length) { this.releasing = true; this.stage = 2; }
    if (this.stage === 0) { this.env += this.attack; if (this.env >= 1) { this.env = 1; this.stage = 1; } }
    else if (this.stage === 1) this.env = this.sustain + (this.env - this.sustain) * this.decay;
    else this.env *= this.release;
    if ((this.stage === 2 || this.sustain === 0) && this.env < 1e-5 && this.t > 64) { this.active = false; return 0; }
    this.t++;
    const dt = f * (inst <= TONAL_MAX ? pitch : 1) / sr;
    const ph = this.ph;
    let s = 0;
    switch (inst) {
      case I.SINE: ph[0] = (ph[0] + dt) % 1; s = Math.sin(TAU * ph[0]) + .12 * Math.sin(2 * TAU * ph[0]); break;
      case I.TRI: { ph[0] = (ph[0] + dt) % 1; const x = TAU * ph[0]; s = .81 * (Math.sin(x) - Math.sin(3 * x) / 9 + Math.sin(5 * x) / 25 - Math.sin(7 * x) / 49); break; }
      case I.WARM: {
        ph[0] = (ph[0] + dt * 1.0025) % 1; ph[1] = (ph[1] + dt * .9975) % 1; ph[2] = (ph[2] + dt * .5) % 1;
        s = this.f1.run(.5 * (blep(ph[0], dt) + blep(ph[1], dt)) + .3 * Math.sin(TAU * ph[2])); break;
      }
      case I.FMPAD: { ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 2) % 1; const index = .45 + .7 * Math.exp(-t * .6) * (.5 + this.bright); s = Math.sin(TAU * ph[0] + index * Math.sin(TAU * ph[1])); break; }
      case I.ORGAN: { ph[0] = (ph[0] + dt) % 1; const x = TAU * ph[0]; s = (Math.sin(x) + .5 * Math.sin(2 * x) + .28 * Math.sin(3 * x) + .14 * Math.sin(4 * x) * this.bright + .07 * Math.sin(6 * x) * this.bright) / 1.7; break; }
      case I.EPIANO: {
        ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 14) % 1; const index = (1.6 * (.4 + .6 * this.bright)) * Math.exp(-t * 2.6) + .22;
        s = Math.sin(TAU * ph[0] + index * Math.sin(TAU * ph[0])) + .07 * Math.exp(-t * 22) * Math.sin(TAU * ph[1]); break;
      }
      case I.BELL: { ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 3.5) % 1; ph[2] = (ph[2] + dt * 2.76) % 1; s = Math.sin(TAU * ph[0] + 1.5 * Math.exp(-t * 1.2) * Math.sin(TAU * ph[1])) + .22 * Math.exp(-t * 2.5) * Math.sin(TAU * ph[2]); break; }
      case I.PLUCK: {
        const size = this.ks.length;
        let read = this.write - this.delay; if (read < 0) read += size;
        const i0 = Math.floor(read), frac = read - i0, a = this.ks[i0 % size], b = this.ks[(i0 + 1) % size];
        const y = a + (b - a) * frac;
        const out = (y + this.y) * this.damp; this.y = y;
        this.ks[this.write] = out; this.write = (this.write + 1) % size;
        s = y * 1.6; break;
      }
      case I.PIANO: {
        for (let n = 0; n < 6; n++) { ph[n] = (ph[n] + this.inc[n] * pitch) % 1; this.amp[n] *= this.coef[n]; s += this.amp[n] * Math.sin(TAU * ph[n]); }
        if (this.t < sr * .006) s += this.noise() * .05 * this.bright * (1 - this.t / (sr * .006)); break;
      }
      case I.MALLET: { ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 4.07) % 1; s = Math.sin(TAU * ph[0]) + .35 * Math.exp(-t * 14) * Math.sin(TAU * ph[1]); if (this.t < sr * .003) s += this.f1.run(this.noise()) * .25; break; }
      case I.CHOIR: {
        ph[0] = (ph[0] + dt * 1.003) % 1; ph[1] = (ph[1] + dt * .997) % 1;
        if ((this.t & 63) === 1) { const m = .5 + .5 * Math.sin(TAU * (this.lfo + t * .07)); this.f1.set(sr, 800 - 350 * m, 6); this.f2.set(sr, 1150 - 350 * m, 7); this.f3.set(sr, 2900 - 120 * m, 9); }
        const src = blep(ph[0], dt) + blep(ph[1], dt);
        this.f1.run(src); this.f2.run(src); this.f3.run(src);
        s = (this.f1.band + .6 * this.f2.band + .25 * this.f3.band) * .9; break;
      }
      case I.FLUTE: {
        const vibrato = 1 + .0045 * Math.sin(TAU * (5.2 * t + this.lfo)) * Math.min(1, t / .7);
        ph[0] = (ph[0] + dt * vibrato) % 1; const x = TAU * ph[0];
        s = Math.sin(x) + .18 * Math.sin(2 * x) + .06 * Math.sin(3 * x) + .1 * this.f1.run(this.noise()); break;
      }
      case I.BASS: { ph[0] = (ph[0] + dt) % 1; const x = TAU * ph[0]; s = Math.sin(x) + (.18 + .25 * this.bright) * Math.sin(2 * x) + .06 * Math.sin(3 * x); break; }
      case I.SUB: ph[0] = (ph[0] + dt) % 1; s = Math.sin(TAU * ph[0]) + .06 * Math.sin(2 * TAU * ph[0]); break;
      case I.SYNTH: {
        ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 1.006) % 1;
        if ((this.t & 15) === 1) this.f1.set(sr, f * (1.2 + (3 + 9 * this.bright) * Math.exp(-t * 9)), 1.4);
        s = this.f1.run(.5 * (blep(ph[0], dt) + blep(ph[1], dt))); break;
      }
      case I.GLASS: { ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 2.76) % 1; ph[2] = (ph[2] + dt * 5.4) % 1; s = Math.sin(TAU * ph[0]) + .3 * Math.exp(-t * 3) * Math.sin(TAU * ph[1]) + .12 * Math.exp(-t * 6) * Math.sin(TAU * ph[2]); break; }
      case I.KICK: ph[0] = (ph[0] + (44 + 80 * Math.exp(-t * 30)) / sr) % 1; s = Math.sin(TAU * ph[0]) + (this.t < sr * .002 ? this.noise() * .2 : 0); break;
      case I.SNARE: s = this.f1.run(this.noise()) * 1.4 * Math.exp(-t * 4) + .4 * Math.exp(-t * 35) * Math.sin(TAU * 190 * t); break;
      case I.HAT: this.f1.run(this.noise()); s = this.f1.high; break;
      case I.SHAKER: this.f1.run(this.noise()); s = this.f1.band * 1.5; break;
      case I.RIM: this.f1.run(this.noise()); s = .6 * Math.sin(TAU * 820 * t) * Math.exp(-t * 70) + this.f1.band * .8; break;
      case I.BRUSH: s = this.f1.run(this.noise()); break;
      default: s = 0;
    }
    return s * this.env * this.gain;
  }
}

/** Composer + voice pool + mixer + effects. render() is the only per-sample entry point. */
export class Renderer {
  constructor(sampleRate, settings) {
    if (!(sampleRate >= 8000 && sampleRate <= 192000)) throw RangeError('Unsupported sample rate');
    const sr = sampleRate;
    this.sr = sr; this.settings = settings; this.pending = null;
    this.composer = new Composer(settings);
    this.voices = []; for (let i = 0; i < 40; i++) this.voices.push(new Voice(sr));
    const cap = 512;
    this.cap = cap; this.evTime = new Float64Array(cap); this.evDur = new Float64Array(cap); this.evMidi = new Float64Array(cap);
    this.evVel = new Float64Array(cap); this.evInst = new Int32Array(cap); this.evLayer = new Int32Array(cap); this.evPan = new Float64Array(cap);
    this.head = 0; this.count = 0; this.barStart = Math.round(sr * .05); this.frames = 0;
    // Recent note-ons for the score display: time (s), midi, layer, velocity, length (s).
    this.log = new Float64Array(64 * 5); this.logHead = 0; this.logTotal = 0;
    this.noiseRng = new Rng((settings.seed ^ 0x51f15e) >>> 0);
    this.voiceSeed = new Rng((settings.seed ^ 0x2545f491) >>> 0);
    this.playing = false; this.envelope = 0;
    this.volume = settings.volume; this.intensity = settings.intensity; this.rate = settings.rateHz;
    this.music = settings.musicVolume; this.bass = settings.bassVolume; this.melody = settings.melodyVolume; this.beat = settings.beatVolume;
    this.space = settings.space; this.stereo = settings.stereo; this.ambienceVolume = settings.ambienceVolume;
    this.tone = this.toneTarget(); this.textures = new Float64Array(AMBIENCES.length);
    const texture = AMBIENCES.indexOf(settings.ambience); if (texture >= 0) this.textures[texture] = 1;
    this.tape = this.composer.style.tape; this.vinyl = this.composer.style.vinyl; this.delayMix = this.composer.style.delay; this.size = this.composer.style.reverb;
    this.ramp = 1 / (sr * .3); this.smooth = 1 - Math.exp(-1 / (sr * .2));
    this.amPhase = 0; this.wow = 0; this.flutter = 0; this.lp1L = 0; this.lp1R = 0; this.lp2L = 0; this.lp2R = 0;
    this.brown = 0; this.slow = 0; this.mid = 0; this.fast = 0; this.crackle = 0; this.drip = 0; this.chirp = 0; this.ambL = 0; this.ambR = 0; this.pop = 0;
    this.windF = new Svf(); this.windF.set(sr, 600, 2); this.streamF = new Svf(); this.streamF.set(sr, 900, 6);
    // Ping-pong delay and a 4-line feedback delay network reverb.
    this.dSize = Math.ceil(sr * 1.6); this.dL = new Float32Array(this.dSize); this.dR = new Float32Array(this.dSize); this.dWrite = 0;
    this.dTime = this.delayTarget();
    const lengths = [.0371, .0437, .0497, .0563];
    this.fdn = []; this.fdnLen = new Int32Array(4); this.fdnIdx = new Int32Array(4); this.fdnLp = new Float64Array(4); this.fdnGain = new Float64Array(4); this.fdnOut = new Float64Array(4);
    for (let i = 0; i < 4; i++) { this.fdnLen[i] = Math.round(lengths[i] * sr * 1.9); this.fdn.push(new Float32Array(this.fdnLen[i])); }
    this.apLen = [Math.round(sr * .0047), Math.round(sr * .0036), Math.round(sr * .0127), Math.round(sr * .0093)];
    this.ap = this.apLen.map(n => new Float32Array(n)); this.apIdx = new Int32Array(4);
    this.preLen = Math.round(sr * .018); this.pre = new Float32Array(this.preLen); this.preIdx = 0;
    this.limit = 1;
    this.updateReverb();
    this.sinkBar = 0; this.sinkSpb = 1;
    this.sink = {note: (beat, beats, midi, velocity, inst, layer, pan) => this.push(beat, beats, midi, velocity, inst, layer, pan)};
  }
  toneTarget() { return 1 - Math.exp(-TAU * 650 * Math.pow(2, this.settings.brightness * 5) / this.sr); }
  delayTarget() { return Math.min(this.dSize - 4, this.sr * 60 / this.composer.bpm * .75); }
  updateReverb() {
    const rt60 = 1.1 + 4.6 * this.size * (.35 + .65 * this.space);
    for (let i = 0; i < 4; i++) this.fdnGain[i] = Math.pow(10, -3 * this.fdnLen[i] / (rt60 * this.sr));
  }
  setSettings(next) { this.pending = next; this.settings = next; }
  setPlaying(playing) { this.playing = playing; }
  isSilent() { return this.envelope === 0; }
  framesGenerated() { return this.frames; }

  push(beat, beats, midi, velocity, inst, layer, pan) {
    if (this.count >= this.cap) return;
    const time = this.sinkBar + beat * this.sinkSpb;
    let slot = (this.head + this.count) % this.cap;
    // Insertion within the current bar keeps the ring sorted by start time.
    let moved = 0;
    while (moved < this.count) {
      const prev = (slot - 1 + this.cap) % this.cap;
      if (this.evTime[prev] <= time || this.evTime[prev] < this.sinkBar) break;
      this.copy(prev, slot); slot = prev; moved++;
    }
    this.evTime[slot] = time; this.evDur[slot] = beats * this.sinkSpb; this.evMidi[slot] = midi; this.evVel[slot] = velocity;
    this.evInst[slot] = inst; this.evLayer[slot] = layer; this.evPan[slot] = pan; this.count++;
  }
  copy(from, to) {
    this.evTime[to] = this.evTime[from]; this.evDur[to] = this.evDur[from]; this.evMidi[to] = this.evMidi[from]; this.evVel[to] = this.evVel[from];
    this.evInst[to] = this.evInst[from]; this.evLayer[to] = this.evLayer[from]; this.evPan[to] = this.evPan[from];
  }
  composeUntil(frame) {
    while (this.barStart < frame) {
      if (this.pending) {
        if (this.pending.seed !== this.composer.settings.seed) { this.composer = new Composer(this.pending); this.voiceSeed = new Rng((this.pending.seed ^ 0x2545f491) >>> 0); }
        else this.composer.configure(this.pending, false);
        this.pending = null;
      }
      const spb = this.sr * 60 / this.composer.bpm;
      this.sinkBar = this.barStart; this.sinkSpb = spb;
      this.composer.bar(this.sink);
      this.barStart += Math.round(spb * 4);
    }
  }
  trigger(slot) {
    let voice = null, quietest = 2;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (!v.active) { voice = v; break; }
      const level = v.env * (v.releasing ? .5 : 1) * (v.layer === L.BASS ? 3 : 1);
      if (level < quietest) { quietest = level; voice = v; }
    }
    const midi = this.evMidi[slot], layer = this.evLayer[slot], inst = this.evInst[slot];
    voice.start(inst, layer, midi, this.evVel[slot], Math.max(1, Math.round(this.evDur[slot])), this.evPan[slot], Math.floor(this.voiceSeed.next() * 4294967295), this.settings.brightness);
    const at = this.logHead * 5;
    this.log[at] = this.evTime[slot] / this.sr; this.log[at + 1] = midi; this.log[at + 2] = layer; this.log[at + 3] = this.evVel[slot]; this.log[at + 4] = this.evDur[slot] / this.sr;
    this.logHead = (this.logHead + 1) % 64; this.logTotal++;
  }
  rampTo(current, target) { const d = target - current; return Math.abs(d) <= this.ramp ? target : current + (d > 0 ? this.ramp : -this.ramp); }

  /** Renders stereo frames into left/right (or interleaved when right is null) starting at offset 0. */
  render(left, right, frameCount) {
    const s = this.settings, sr = this.sr;
    const texture = AMBIENCES.indexOf(s.ambience);
    const allMuted = s.musicVolume === 0 && s.bassVolume === 0 && s.melodyVolume === 0 && s.beatVolume === 0 && (texture < 0 || s.ambienceVolume === 0);
    const targetVolume = allMuted ? 0 : s.volume, toneTarget = this.toneTarget();
    this.composeUntil(this.frames + frameCount + Math.round(sr * .1));
    const st = this.composer.style;
    for (let n = 0; n < frameCount; n++, this.frames++) {
      while (this.count > 0 && this.evTime[this.head] <= this.frames) { this.trigger(this.head); this.head = (this.head + 1) % this.cap; this.count--; }
      this.volume = this.rampTo(this.volume, targetVolume); this.intensity = this.rampTo(this.intensity, s.intensity);
      this.rate += (s.rateHz - this.rate) * this.smooth; this.tone += (toneTarget - this.tone) * this.smooth;
      this.music = this.rampTo(this.music, s.musicVolume); this.bass = this.rampTo(this.bass, s.bassVolume);
      this.melody = this.rampTo(this.melody, s.melodyVolume); this.beat = this.rampTo(this.beat, s.beatVolume);
      this.space = this.rampTo(this.space, s.space); this.stereo = this.rampTo(this.stereo, s.stereo);
      this.ambienceVolume = this.rampTo(this.ambienceVolume, s.ambienceVolume);
      this.tape += (st.tape - this.tape) * this.smooth; this.vinyl += (st.vinyl - this.vinyl) * this.smooth;
      this.delayMix += (st.delay - this.delayMix) * this.smooth; this.size += (st.reverb - this.size) * this.smooth;
      this.dTime += (this.delayTarget() - this.dTime) * this.smooth * .2;
      for (let i = 0; i < this.textures.length; i++) this.textures[i] += ((i === texture ? 1 : 0) - this.textures[i]) * this.smooth;
      if ((this.frames & 1023) === 0) this.updateReverb();
      this.envelope = this.playing ? Math.min(1, this.envelope + 1 / (sr * .4)) : Math.max(0, this.envelope - 1 / (sr * .18));

      this.wow += .45 / sr; if (this.wow >= 1) this.wow -= 1;
      this.flutter += 6.1 / sr; if (this.flutter >= 1) this.flutter -= 1;
      const pitch = 1 + this.tape * (.0028 * Math.sin(TAU * this.wow) + .0007 * Math.sin(TAU * this.flutter));
      let padL = 0, padR = 0, melL = 0, melR = 0, bassS = 0, drumL = 0, drumR = 0;
      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        if (!v.active) continue;
        const x = v.next(pitch);
        if (v.layer === L.PAD || v.layer === L.ARP) { padL += x * v.gl; padR += x * v.gr; }
        else if (v.layer === L.MELODY) { melL += x * v.gl; melR += x * v.gr; }
        else if (v.layer === L.BASS) bassS += x;
        else { drumL += x * v.gl; drumR += x * v.gr; }
      }
      // Broad amplitude modulation on the music bus; bass, drums and atmosphere bypass it.
      this.amPhase += this.rate / sr; if (this.amPhase >= 1) this.amPhase -= 1;
      const am = 1 - this.intensity * .5 + this.intensity * .5 * Math.sin(TAU * this.amPhase);
      let mL = (padL * this.music + melL * this.melody) * am, mR = (padR * this.music + melR * this.melody) * am;
      const noise = this.noiseRng.next() * 2 - 1;
      if (this.tape > .001 || this.vinyl > .001) {
        this.pop *= .9; if (this.noiseRng.next() < .00012 * this.vinyl) this.pop = this.noiseRng.next() * .5;
        const grain = (noise * .006 * this.tape + this.pop * .08 * this.vinyl) * this.music;
        mL += grain; mR += grain;
        const drive = 1 + this.tape * .8;
        mL = Math.tanh(mL * drive) / drive; mR = Math.tanh(mR * drive) / drive;
      }
      this.lp1L += this.tone * (mL - this.lp1L); this.lp2L += this.tone * (this.lp1L - this.lp2L);
      this.lp1R += this.tone * (mR - this.lp1R); this.lp2R += this.tone * (this.lp1R - this.lp2R);
      mL = this.lp2L; mR = this.lp2R;
      const bassOut = bassS * this.bass, dL = drumL * this.beat, dR = drumR * this.beat;

      // Tempo-synced ping-pong delay on melody and arpeggios.
      const size = this.dSize;
      let read = this.dWrite - this.dTime; if (read < 0) read += size;
      const i0 = Math.floor(read), frac = read - i0, i1 = (i0 + 1) % size;
      const echoL = this.dL[i0] + (this.dL[i1] - this.dL[i0]) * frac, echoR = this.dR[i0] + (this.dR[i1] - this.dR[i0]) * frac;
      const feedback = .28 + .32 * this.space, send = this.delayMix * (.35 + .65 * this.space);
      this.dL[this.dWrite] = (melL * this.melody * am + padL * this.music * am * .3) * send + echoR * feedback;
      this.dR[this.dWrite] = echoL * feedback;
      this.dWrite = (this.dWrite + 1) % size;

      // Reverb: pre-delay → 2 diffusers → 4-line Householder FDN with damping.
      let input = (mL + mR) * .5 + bassOut * .2 + (dL + dR) * .1 + (echoL + echoR) * .3;
      const pre = this.pre[this.preIdx]; this.pre[this.preIdx] = input; this.preIdx = (this.preIdx + 1) % this.preLen;
      input = pre;
      for (let a = 0; a < 2; a++) {
        const buf = this.ap[a], idx = this.apIdx[a], delayed = buf[idx], v = input + delayed * .6;
        buf[idx] = v; this.apIdx[a] = (idx + 1) % this.apLen[a]; input = delayed - v * .6;
      }
      const o0 = this.fdn[0][this.fdnIdx[0]], o1 = this.fdn[1][this.fdnIdx[1]], o2 = this.fdn[2][this.fdnIdx[2]], o3 = this.fdn[3][this.fdnIdx[3]];
      const sum = (o0 + o1 + o2 + o3) * .5, damp = .35 - .25 * (s.brightness);
      const outs = this.fdnOut; outs[0] = o0; outs[1] = o1; outs[2] = o2; outs[3] = o3;
      for (let k = 0; k < 4; k++) {
        this.fdnLp[k] += (1 - damp) * ((outs[k] - sum) * this.fdnGain[k] - this.fdnLp[k]);
        this.fdn[k][this.fdnIdx[k]] = input + this.fdnLp[k];
        this.fdnIdx[k] = (this.fdnIdx[k] + 1) % this.fdnLen[k];
      }
      let wetL = o0 + o2 * .6, wetR = o1 + o3 * .6;
      for (let a = 2; a < 4; a++) { // decorrelate the two outputs
        const buf = this.ap[a], idx = this.apIdx[a], src = a === 2 ? wetL : wetR, delayed = buf[idx], v = src + delayed * .5;
        buf[idx] = v; this.apIdx[a] = (idx + 1) % this.apLen[a];
        if (a === 2) wetL = delayed - v * .5; else wetR = delayed - v * .5;
      }
      const wet = this.space * (.35 + .45 * this.size);

      // Generated atmosphere.
      let air = 0, airR = 0;
      if (this.ambienceVolume > 0 && (texture >= 0 || this.textures[0] + this.textures[1] + this.textures[2] + this.textures[3] + this.textures[4] + this.textures[5] + this.textures[6] + this.textures[7] > 1e-4)) {
        const tx = this.textures, seconds = this.frames / sr;
        this.brown = .997 * this.brown + .035 * noise; this.slow = .98 * this.slow + .02 * noise; this.mid = .85 * this.mid + .15 * noise; this.fast = .5 * this.fast + .5 * noise;
        const pink = this.slow * 2.5 + this.mid * .8 + this.fast * .3 + noise * .08;
        this.crackle *= .985; if (this.noiseRng.next() < .0007) this.crackle = .3 + this.noiseRng.next() * .7;
        this.drip *= .993; if (this.noiseRng.next() < .0009) this.drip = this.noiseRng.next();
        if ((this.frames & 255) === 0) { this.windF.set(sr, 400 + 500 * (.5 + .5 * Math.sin(seconds * .37) * Math.sin(seconds * .11)), 1.6); this.streamF.set(sr, 600 + this.noiseRng.next() * 1400, 7); }
        const wind = this.windF.run(noise) * (.5 + .5 * Math.sin(seconds * Math.PI / 5) ** 2) * 2;
        const stream = this.streamF.run(noise) * 1.8 + this.mid * .3;
        const swell = Math.sin(seconds * Math.PI / 9);
        const cycle = (seconds * 1.1) % 1, chirp = cycle < .3 ? Math.sin(TAU * 4300 * seconds) * Math.max(0, Math.sin(TAU * cycle * 23)) * (.5 + .5 * Math.sin(seconds * .23)) : 0;
        const value = tx[0] * (noise * .35 + this.fast * .2 + this.drip * noise * .55) + tx[1] * stream + tx[2] * pink * (.2 + .8 * swell * swell) + tx[3] * wind
          + tx[4] * (this.brown * .5 + noise * this.crackle) + tx[5] * (chirp * .18 + this.slow * .6) + tx[6] * this.brown * 2.5 + tx[7] * pink;
        this.ambL += .35 * (Math.tanh(value) * this.ambienceVolume * .28 - this.ambL);
        this.ambR += .35 * (Math.tanh(value * (1 - .3 * tx[2]) + this.mid * .2 * (tx[0] + tx[3])) * this.ambienceVolume * .28 - this.ambR);
        air = this.ambL; airR = this.ambR;
      }

      let L0 = mL + bassOut + dL + wetL * wet + air, R0 = mR + bassOut + dR + wetR * wet + airR;
      const midS = (L0 + R0) * .5, side = (L0 - R0) * .5 * this.stereo;
      L0 = midS + side; R0 = midS - side;
      const peak = Math.max(Math.abs(L0), Math.abs(R0));
      this.limit = peak * this.limit > .7 ? .7 / peak : Math.min(1, this.limit + .00002);
      const gain = this.volume * this.envelope * .9;
      const outL = gain === 0 ? 0 : Math.tanh(L0 * this.limit) * gain, outR = gain === 0 ? 0 : Math.tanh(R0 * this.limit) * gain;
      if (right) { left[n] = outL; right[n] = outR; } else { left[n * 2] = outL; left[n * 2 + 1] = outR; }
    }
  }

  /** Note-ons since `since` (a running total), oldest first: [time, midi, layer, velocity, length]×n. */
  recentNotes(since) {
    const available = Math.min(64, this.logTotal - since), out = [];
    for (let k = available; k > 0; k--) { const at = ((this.logHead - k + 64) % 64) * 5; out.push(this.log[at], this.log[at + 1], this.log[at + 2], this.log[at + 3], this.log[at + 4]); }
    return out;
  }
}
