import {Renderer} from './engine/synth.js';

// Runs the shared engine on the audio thread; posts note-ons for the score display.
class StillwaveProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.renderer = new Renderer(sampleRate, options.processorOptions.settings);
    this.since = 0; this.blocks = 0;
    this.port.onmessage = event => {
      const data = event.data;
      if (data.type === 'settings') this.renderer.setSettings(data.settings);
      else if (data.type === 'playing') this.renderer.setPlaying(data.value);
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    this.renderer.render(out[0], out[1], out[0].length);
    if (++this.blocks % 8 === 0 && this.renderer.logTotal > this.since) {
      const notes = this.renderer.recentNotes(this.since);
      this.since = this.renderer.logTotal;
      this.port.postMessage({type: 'notes', notes, frames: this.renderer.frames, now: currentTime + out[0].length / sampleRate});
    }
    return true;
  }
}
registerProcessor('stillwave', StillwaveProcessor);
