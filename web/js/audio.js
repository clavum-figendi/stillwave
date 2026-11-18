import {normalizeSettings} from './settings.js';
import {Renderer} from './engine/synth.js';

// Browser host for the shared engine. Modern browsers run it in an AudioWorklet; older ones
// (factory WebViews) fall back to a ScriptProcessor. No samples, streams or network requests.
const FADE_MS = 230;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export class StillwaveEngine {
  constructor() {
    this.context = null; this.node = null; this.renderer = null; this.analyser = null;
    this.playing = false; this.elapsed = 0; this.startedAt = 0; this.timer = null; this.generation = 0;
    this.settings = normalizeSettings(); this.error = null; this.notes = []; this.offset = 0; this.since = 0;
    this.workletUrl = new URL('./worklet.bundle.js', document.baseURI).href;
  }
  async build(context) {
    const settings = this.settings;
    this.analyser = context.createAnalyser(); this.analyser.fftSize = 512;
    this.visualization = new Uint8Array(this.analyser.fftSize);
    if (context.audioWorklet && typeof AudioWorkletNode === 'function') {
      await context.audioWorklet.addModule(this.workletUrl);
      this.node = new AudioWorkletNode(context, 'stillwave', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {settings}});
      this.node.port.onmessage = event => {
        const data = event.data;
        if (data.type === 'notes') { this.offset = data.now - data.frames / context.sampleRate; this.collect(data.notes); }
      };
    } else {
      const renderer = this.renderer = new Renderer(context.sampleRate, settings);
      this.node = context.createScriptProcessor(2048, 0, 2);
      this.node.onaudioprocess = event => {
        const out = event.outputBuffer;
        renderer.render(out.getChannelData(0), out.getChannelData(1), out.length);
        this.offset = event.playbackTime - renderer.frames / context.sampleRate + out.length / context.sampleRate;
        const notes = renderer.recentNotes(this.since);
        if (notes.length) { this.since = renderer.logTotal; this.collect(notes); }
      };
    }
    this.node.connect(this.analyser); this.analyser.connect(context.destination);
  }
  collect(flat) {
    for (let i = 0; i < flat.length; i += 5) this.notes.push({time: flat[i] + this.offset, midi: flat[i + 1], layer: flat[i + 2], velocity: flat[i + 3], length: flat[i + 4]});
    if (this.notes.length > 400) this.notes.splice(0, this.notes.length - 400);
  }
  send(message) {
    if (this.renderer) { if (message.type === 'settings') this.renderer.setSettings(message.settings); else this.renderer.setPlaying(message.value); }
    else if (this.node) this.node.port.postMessage(message);
  }
  async start(settings) {
    this.settings = normalizeSettings(settings); this.error = null;
    if (this.playing && this.context && this.context.state === 'running') { this.update(this.settings); return; }
    if (this.playing) { this.elapsed = this.getState().elapsed; this.playing = false; clearInterval(this.timer); this.timer = null; }
    const token = ++this.generation;
    try {
      if (!this.context || this.context.state === 'closed') {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) throw Error('This browser does not support Web Audio.');
        this.context = new Context({latencyHint: 'playback'});
        this.notes = []; this.since = 0;
        await this.build(this.context);
      } else this.send({type: 'settings', settings: this.settings});
      await this.context.resume();
      if (token !== this.generation) return;
      if (this.context.state !== 'running') throw Error('Audio is blocked. Tap play again to allow sound.');
      this.send({type: 'playing', value: true});
      this.startedAt = this.context.currentTime; this.playing = true;
      this.tick(); this.timer = setInterval(() => this.tick(), 250);
    } catch (error) {
      if (token === this.generation) { this.stop(); this.error = error.message; }
      throw error;
    }
  }
  tick() {
    if (!this.playing) return;
    const limit = this.settings.duration * 60;
    if (limit && this.getState().elapsed >= limit) this.stop();
  }
  async pause() {
    if (!this.playing) return;
    const token = ++this.generation, context = this.context;
    this.elapsed = this.getState().elapsed; this.playing = false;
    clearInterval(this.timer); this.timer = null;
    this.send({type: 'playing', value: false});
    await wait(FADE_MS);
    if (token === this.generation && context && context.state === 'running') await context.suspend();
  }
  stop() {
    ++this.generation; clearInterval(this.timer); this.timer = null; this.playing = false; this.elapsed = 0;
    const context = this.context, node = this.node;
    this.send({type: 'playing', value: false});
    this.context = null; this.node = null; this.renderer = null;
    const close = () => { try { node && node.disconnect(); } catch (error) { /* already disconnected */ } if (context) context.close().catch(() => {}); };
    if (context && context.state === 'running') setTimeout(close, FADE_MS); else close();
  }
  update(settings) { this.settings = normalizeSettings(Object.assign({}, this.settings, settings)); this.send({type: 'settings', settings: this.settings}); this.tick(); }
  now() { return this.context ? this.context.currentTime : 0; }
  getNotes() { return this.notes; }
  getLevel() {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getByteTimeDomainData(this.visualization);
    let sum = 0; for (let i = 0; i < this.visualization.length; i++) { const v = (this.visualization[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / this.visualization.length);
  }
  getState() {
    const elapsed = this.elapsed + (this.playing && this.context ? Math.max(0, this.context.currentTime - this.startedAt) : 0);
    // An OS/browser suspension is not active playback. Resuming needs another user gesture.
    return {playing: this.playing && !!this.context && this.context.state === 'running', elapsed, error: this.error};
  }
}

/** Renders a WAV file off the audio thread's clock, yielding to keep the page responsive. */
export async function renderWav(settings, seconds, {sampleRate = 44100, onProgress} = {}) {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600) throw new RangeError('Export length must be 1 second to 10 minutes.');
  const frames = Math.ceil(seconds * sampleRate), bytes = new ArrayBuffer(44 + frames * 4), view = new DataView(bytes);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 4, true);
  const renderer = new Renderer(sampleRate, normalizeSettings(Object.assign({}, settings, {duration: 0})));
  renderer.setPlaying(true);
  const block = 8192, left = new Float32Array(block), right = new Float32Array(block), fade = Math.min(frames, sampleRate * 2);
  for (let at = 0; at < frames; at += block) {
    const count = Math.min(block, frames - at);
    renderer.render(left, right, count);
    for (let i = 0; i < count; i++) {
      const frame = at + i, gain = frame > frames - fade ? (frames - frame) / fade : 1;
      view.setInt16(44 + frame * 4, Math.max(-32768, Math.min(32767, Math.round(left[i] * gain * 32767))), true);
      view.setInt16(46 + frame * 4, Math.max(-32768, Math.min(32767, Math.round(right[i] * gain * 32767))), true);
    }
    if ((at / block) % 16 === 15) { if (onProgress) onProgress(at / frames); await wait(0); }
  }
  return new Blob([bytes], {type: 'audio/wav'});
}
