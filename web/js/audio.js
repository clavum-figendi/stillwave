import { normalizeSettings } from './settings.js';

// Original synthesizer. No samples, streaming services or network requests.
function randomSource(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state,1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
const midi = note => 440 * 2 ** ((note - 69) / 12);
const tune = (param, value, now, fade = 0.12) => {
  param.cancelScheduledValues(now); param.setTargetAtTime(value,now,fade);
};

class SoundGraph {
  constructor(context, settings, origin = context.currentTime) {
    this.context = context; this.settings = normalizeSettings(settings); this.origin = origin;
    this.random = randomSource(this.settings.seed); this.nodes = new Set(); this.sources = new Set();
    this.nextChord = origin; this.nextNote = origin + 0.5; this.chordIndex = 0;
    this.master = this.node(context.createGain());
    this.master.gain.setValueAtTime(0,origin);
    this.master.gain.linearRampToValueAtTime(this.settings.volume * 0.7,origin+1.2);
    this.limiter = this.node(context.createDynamicsCompressor());
    this.limiter.threshold.value=-9; this.limiter.knee.value=6; this.limiter.ratio.value=8;
    this.limiter.attack.value=0.008; this.limiter.release.value=0.25;
    this.master.connect(this.limiter); this.limiter.connect(context.destination);
    this.modBus = this.node(context.createGain());
    this.modBus.gain.value=1-this.settings.intensity/2;
    this.toneFilter = this.node(context.createBiquadFilter());
    this.toneFilter.type='lowpass'; this.toneFilter.frequency.value=this.settings.style==='deep'?900:1500;
    this.modBus.connect(this.toneFilter); this.toneFilter.connect(this.master);
    this.lfo = this.source(context.createOscillator());
    this.lfo.frequency.value=this.settings.rateHz;
    this.lfoDepth=this.node(context.createGain()); this.lfoDepth.gain.value=this.settings.intensity/2;
    this.lfo.connect(this.lfoDepth); this.lfoDepth.connect(this.modBus.gain); this.lfo.start(origin);
    // Small, generated diffusion tail; only the 200–1000 Hz music bus is modulated.
    this.reverb=this.node(context.createConvolver());
    const impulse=context.createBuffer(2,Math.ceil(context.sampleRate*1.8),context.sampleRate);
    for(let ch=0;ch<2;ch++){
      const data=impulse.getChannelData(ch);
      for(let i=0;i<data.length;i++) data[i]=(this.random()*2-1)*Math.exp(-i/(context.sampleRate*.38))*.18;
    }
    this.reverb.buffer=impulse;
    this.wet=this.node(context.createGain());this.wet.gain.value=.12;
    this.toneFilter.connect(this.reverb);this.reverb.connect(this.wet);this.wet.connect(this.master);
    this.createAmbience(origin);
  }
  node(node){this.nodes.add(node);return node;}
  source(node){
    this.node(node);this.sources.add(node);
    node.onended=()=>{node.disconnect();this.nodes.delete(node);this.sources.delete(node);};
    return node;
  }
  createAmbience(origin){
    const c=this.context, buffer=c.createBuffer(1,c.sampleRate*11,c.sampleRate);
    const data=buffer.getChannelData(0);let last=0;
    for(let i=0;i<data.length;i++){
      const white=this.random()*2-1;
      last=(last+.035*white)/1.035;data[i]=last*4.5;
    }
    this.noise=this.source(c.createBufferSource());this.noise.buffer=buffer;this.noise.loop=true;
    this.noiseFilter=this.node(c.createBiquadFilter());this.noiseFilter.type='lowpass';
    this.noiseFilter.frequency.value=this.settings.ambience==='rain'?2800:500;
    this.noiseGain=this.node(c.createGain());
    this.noiseGain.gain.value=this.settings.ambience==='none'?0:this.settings.ambienceVolume*.24;
    this.noise.connect(this.noiseFilter);this.noiseFilter.connect(this.noiseGain);this.noiseGain.connect(this.master);
    this.breeze=this.source(c.createOscillator());this.breeze.frequency.value=.037;
    this.breezeGain=this.node(c.createGain());this.breezeGain.gain.value=100;
    this.breeze.connect(this.breezeGain);this.breezeGain.connect(this.noiseFilter.frequency);
    this.noise.start(origin);this.breeze.start(origin);
  }
  voice(frequency, start, length, gain, type='sine', bass=false, pan=0){
    const c=this.context, oscillator=this.source(c.createOscillator()), envelope=this.node(c.createGain());
    const panner=this.node(c.createStereoPanner());panner.pan.value=pan;
    oscillator.type=type;oscillator.frequency.value=frequency;
    oscillator.detune.value=bass?0:(this.random()-.5)*5;
    const attack=Math.min(length*.25,bass?.8:2.8), end=start+length;
    envelope.gain.setValueAtTime(0,start);
    envelope.gain.linearRampToValueAtTime(gain,start+attack);
    envelope.gain.setValueAtTime(gain*.8,start+length*.55);
    envelope.gain.linearRampToValueAtTime(0,end);
    oscillator.connect(envelope);envelope.connect(panner);panner.connect(bass?this.master:this.modBus);
    oscillator.onended=()=>{
      for(const n of [oscillator,envelope,panner]){n.disconnect();this.nodes.delete(n);this.sources.delete(n);}
    };
    oscillator.start(start);oscillator.stop(end+.02);
  }
  schedule(until){
    const s=this.settings;
    while(this.nextChord<until){
      const time=this.nextChord, roots=[57,53,60,55,58,53,62,55];
      const root=roots[(this.chordIndex+Math.floor(this.chordIndex/8))%roots.length];
      // Voicing and timing evolve continuously; no fixed audio or phrase loop.
      const inversion=this.random()>.55?12:0;
      [0,7,12,15].forEach((interval,i)=>{
        const note=Math.max(57,root+interval+(i===0?inversion:0));
        this.voice(midi(Math.min(83,note)),time+i*(s.mode==='focus'?.0625:.09),14+this.random()*2,.065,'sine',false,(i-1.5)*.22);
      });
      this.voice(midi(root-24),time,13,.075,'sine',true);
      // Focus events share a 60 BPM clock; 16 Hz is sixteen cycles per beat.
      this.chordIndex++;this.nextChord+=s.mode==='focus'?12:12+(this.random()-.5)*.5;
    }
    while(this.nextNote<until){
      const sleep=s.mode==='sleep', step=sleep?2:(s.style==='lofi'?.5:1);
      if(this.random()>(sleep?.7:.33)){
        const degrees=[0,3,5,7,10,12,15],note=57+degrees[Math.floor(this.random()*degrees.length)];
        this.voice(midi(note),this.nextNote, s.style==='lofi'?1.4:3.8,
          s.style==='deep'?.012:.032, s.style==='lofi'?'triangle':'sine',false,(this.random()-.5)*.85);
      }
      this.nextNote+=step;
    }
  }
  update(settings){
    this.settings=normalizeSettings(settings);const s=this.settings,t=this.context.currentTime;
    tune(this.master.gain,s.volume*.7,t);tune(this.modBus.gain,1-s.intensity/2,t);
    tune(this.lfoDepth.gain,s.intensity/2,t);tune(this.lfo.frequency,s.rateHz,t);
    tune(this.toneFilter.frequency,s.style==='deep'?900:1500,t,.5);
    tune(this.noiseGain.gain,s.ambience==='none'?0:s.ambienceVolume*.24,t,.3);
    tune(this.noiseFilter.frequency,s.ambience==='rain'?2800:500,t,.5);
  }
  fadeOut(at,seconds=.8){
    this.master.gain.cancelAndHoldAtTime(at);this.master.gain.linearRampToValueAtTime(0,at+seconds);
  }
  dispose(){
    for(const source of this.sources){try{source.stop();}catch{/* Already stopped. */}}
    for(const node of this.nodes){try{node.disconnect();}catch{/* Already disconnected. */}}
    this.sources.clear();this.nodes.clear();
  }
}

export async function renderAudio(settings, seconds = 30, {sampleRate = 44100} = {}) {
  if(!Number.isFinite(seconds)||seconds<1||seconds>90) throw new RangeError('Export length must be 1–90 seconds.');
  const context=new OfflineAudioContext(2,Math.ceil(seconds*sampleRate),sampleRate);
  const graph=new SoundGraph(context,settings,0);graph.schedule(seconds);
  graph.fadeOut(Math.max(0,seconds-1),.95);
  try { return await context.startRendering(); } finally { graph.dispose(); }
}

export class StillwaveEngine {
  constructor(){this.context=null;this.graph=null;this.playing=false;this.elapsed=0;this.startedAt=0;this.timer=null;this.generation=0;this.settings=normalizeSettings();this.error=null;}
  async start(settings){
    this.settings=normalizeSettings(settings);this.error=null;
    if(this.playing&&this.context?.state==='running'){this.update(this.settings);return;}
    if(this.playing){
      this.elapsed=this.getState().elapsed;this.playing=false;
      clearInterval(this.timer);this.timer=null;
    }
    const token=++this.generation;
    try{
      if(!this.context||this.context.state==='closed'){
        const Audio=window.AudioContext||window.webkitAudioContext;
        if(!Audio)throw Error('This browser does not support Web Audio.');
        this.context=new Audio({latencyHint:'playback'});
      }
      await this.context.resume();
      if(token!==this.generation)return;
      if(this.context.state!=='running')throw Error('Audio is blocked. Tap Start again to allow playback.');
      if(!this.graph)this.graph=new SoundGraph(this.context,this.settings);
      else this.graph.update(this.settings);
      this.startedAt=this.context.currentTime;this.playing=true;
      this.tick();this.timer=setInterval(()=>this.tick(),100);
    }catch(error){
      if(token===this.generation){this.error=error.message;this.stop();this.error=error.message;}
      throw error;
    }
  }
  tick(){
    if(!this.playing||!this.graph)return;
    const elapsed=this.getState().elapsed,limit=this.settings.duration*60;
    if(limit && elapsed>=limit){this.stop();return;}
    this.graph.schedule(this.context.currentTime+1.2);
    if(limit&&limit-elapsed<1.1)this.graph.fadeOut(this.context.currentTime,Math.max(.05,limit-elapsed));
  }
  async pause(){
    if(!this.playing)return;
    const token=++this.generation,context=this.context;
    this.elapsed=this.getState().elapsed;this.playing=false;
    clearInterval(this.timer);this.timer=null;
    if(context?.state==='running'){
      this.graph?.fadeOut(context.currentTime,.06);
      await new Promise(resolve=>setTimeout(resolve,85));
      if(token===this.generation&&context.state==='running')await context.suspend();
    }
  }
  stop(){
    ++this.generation;clearInterval(this.timer);this.timer=null;this.playing=false;this.elapsed=0;
    const graph=this.graph,context=this.context;this.graph=null;this.context=null;
    if(graph&&context?.state==='running'){
      graph.fadeOut(context.currentTime,.2);
      setTimeout(()=>{graph.dispose();context.close().catch(()=>{});},230);
    }else{graph?.dispose();context?.close().catch(()=>{});}
  }
  update(settings){this.settings=normalizeSettings({...this.settings,...settings});this.graph?.update(this.settings);this.tick();}
  getState(){
    const elapsed=this.elapsed+(this.playing?Math.max(0,this.context.currentTime-this.startedAt):0);
    // An OS/browser suspension is not active playback. Resume needs another user gesture.
    return {playing:this.playing&&this.context?.state==='running',elapsed,error:this.error};
  }
}
