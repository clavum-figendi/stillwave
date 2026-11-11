import { normalizeSettings } from './settings.js';

// Android owns the streaming service. Never construct Web Audio on this path.
export class NativeEngine {
  constructor(bridge) { this.bridge=bridge; }
  async start(settings) { this.bridge.start(JSON.stringify(normalizeSettings(settings))); }
  pause() { this.bridge.pause(); }
  stop() { this.bridge.stop(); }
  update(settings) { this.bridge.update(JSON.stringify(normalizeSettings(settings))); }
  getState() {
    const state=JSON.parse(this.bridge.getState());
    if(!state||typeof state.playing!=='boolean'||!Number.isFinite(state.elapsed)||state.elapsed<0)throw Error('Invalid response from the audio service.');
    return {playing:state.playing,elapsed:state.elapsed,error:typeof state.error==='string'?state.error:null};
  }
}
