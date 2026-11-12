import { normalizeSettings, SYNTHS, AMBIENCES } from './settings.js';

// Original synthesizer. No samples, streaming services or network requests.
function randomSource(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state,1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
const midi = note => 440 * 2 ** ((note - 69) / 12);
const character = {
  ambient:{tone:650,chord:12,length:15,attack:2.8,step:1,detune:5},
  lofi:{tone:380,chord:12,length:10,attack:1.2,step:.5,detune:9},
  deep:{tone:260,chord:12,length:16,attack:3.5,step:2,detune:3},
  glass:{tone:1600,chord:12,length:8,attack:.35,step:1.5,detune:2},
  drift:{tone:800,chord:18,length:21,attack:4,step:2,detune:12},
  tape:{tone:470,chord:12,length:13,attack:1.8,step:.75,detune:8},
};
const tune = (param, value, now, fade = 0.12) => {
  if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(now);
  else {const held=param.value;param.cancelScheduledValues(now);param.setValueAtTime(held,now);}
  // Finite ramps settle to exact zero/mono rather than an asymptotic residue.
  param.linearRampToValueAtTime(value,now+fade*3);
};

class SoundGraph {
  constructor(context, settings, origin = context.currentTime) {
    this.context = context; this.settings = normalizeSettings(settings); this.origin = origin;
    this.random = randomSource(this.settings.seed); this.nodes = new Set(); this.sources = new Set();this.voices=new Set();
    this.organWave=context.createPeriodicWave(new Float32Array([0,0,0,0,0,0,0,0,0]),new Float32Array([0,1,.45,.2,.1,0,0,0,.04]));
    this.nextChord = origin; this.nextNote = origin + 0.5; this.chordIndex = 0;
    this.master = this.node(context.createGain());
    this.master.gain.setValueAtTime(0,origin);
    this.master.gain.linearRampToValueAtTime(this.outputLevel(),origin+1.2);
    this.masterAutomation={time:origin,start:0,value:this.outputLevel(),end:origin+1.2};
    this.limiter = this.node(context.createDynamicsCompressor());
    this.limiter.threshold.value=-9; this.limiter.knee.value=6; this.limiter.ratio.value=8;
    this.limiter.attack.value=0.008; this.limiter.release.value=0.25;
    this.master.connect(this.limiter);
    // A final mid/side matrix covers every layer and the stereo diffusion tail.
    // Width zero is true mono, including notes that began before an update.
    const split=this.node(context.createChannelSplitter(2)),merge=this.node(context.createChannelMerger(2));
    this.widthGains=[];this.limiter.connect(split);
    for(let input=0;input<2;input++)for(let output=0;output<2;output++){
      const gain=this.node(context.createGain());
      gain.gain.value=(1+(input===output?1:-1)*this.settings.stereo)/2;
      split.connect(gain,input);gain.connect(merge,0,output);
      this.widthGains.push({gain:gain.gain,sign:input===output?1:-1});
    }
    this.analyser=this.node(context.createAnalyser());this.analyser.fftSize=256;
    this.visualization=new Uint8Array(this.analyser.fftSize);
    merge.connect(this.analyser);this.analyser.connect(context.destination);
    this.music=this.node(context.createGain());this.music.gain.value=this.settings.musicVolume;
    this.bass=this.node(context.createGain());this.bass.gain.value=this.settings.bassVolume;
    this.melody=this.node(context.createGain());this.melody.gain.value=this.settings.melodyVolume;
    this.modBus = this.node(context.createGain());
    this.modBus.gain.value=1-this.settings.intensity/2;
    this.toneFilter = this.node(context.createBiquadFilter());
    this.toneFilter.type='lowpass'; this.toneFilter.frequency.value=this.cutoff();
    this.modBus.connect(this.toneFilter); this.toneFilter.connect(this.master);
    this.music.connect(this.modBus);this.melody.connect(this.modBus);
    this.bass.connect(this.master);
    this.lfo = this.source(context.createOscillator());
    this.lfo.frequency.value=this.settings.rateHz;
    this.lfoDepth=this.node(context.createGain()); this.lfoDepth.gain.value=this.settings.intensity/2;
    this.lfo.connect(this.lfoDepth); this.lfoDepth.connect(this.modBus.gain); this.lfo.start(origin);
    // Broad chord/melody bus AM, not a band-selective process. Bass/air bypass AM.
    this.reverb=this.node(context.createConvolver());
    const impulse=context.createBuffer(2,Math.ceil(context.sampleRate*1.8),context.sampleRate);
    for(let ch=0;ch<2;ch++){
      const data=impulse.getChannelData(ch);
      for(let i=0;i<data.length;i++) data[i]=(this.random()*2-1)*Math.exp(-i/(context.sampleRate*.38))*.18;
    }
    this.reverb.buffer=impulse;
    this.wet=this.node(context.createGain());this.wet.gain.value=this.settings.space*.48;
    this.toneFilter.connect(this.reverb);this.reverb.connect(this.wet);this.wet.connect(this.master);
    this.bass.connect(this.reverb);
    this.wow=this.source(context.createOscillator());this.wow.frequency.value=.19;
    this.wowDepth=this.node(context.createGain());this.wowDepth.gain.value=this.settings.style==='tape'?8:this.settings.style==='drift'?3:0;
    this.wow.connect(this.wowDepth);this.wow.start(origin);
    this.createAmbience(origin);
  }
  node(node){this.nodes.add(node);return node;}
  outputLevel(){
    const s=this.settings;
    return s.musicVolume===0&&s.bassVolume===0&&s.melodyVolume===0&&(s.ambience==='none'||s.ambienceVolume===0)?0:s.volume*.7;
  }
  masterValue(at){
    const a=this.masterAutomation,dt=Math.max(0,at-a.time);
    return a.constant?a.value+(a.start-a.value)*Math.exp(-dt/a.constant):a.start+(a.value-a.start)*Math.min(1,dt/Math.max(.00001,a.end-a.time));
  }
  holdMaster(at){
    const value=this.masterValue(at),p=this.master.gain,a=this.masterAutomation;
    if(typeof p.cancelAndHoldAtTime==='function')p.cancelAndHoldAtTime(at);
    else {
      p.cancelScheduledValues(at);
      if(!a.constant&&at<=a.end)p.linearRampToValueAtTime(value,at);
      else p.setValueAtTime(value,at);
    }
    return value;
  }
  cutoff(){return character[this.settings.style].tone*2**(this.settings.brightness*3);}
  source(node){
    this.node(node);this.sources.add(node);
    node.onended=()=>{node.disconnect();this.nodes.delete(node);this.sources.delete(node);};
    return node;
  }
  createAmbience(origin){
    const c=this.context, random=randomSource(this.settings.seed^0x51f15e);
    this.textures=[];
    for(const kind of AMBIENCES.slice(1)){
      const buffer=c.createBuffer(1,c.sampleRate*8,c.sampleRate),data=buffer.getChannelData(0);
      let brown=0,slow=0,mid=0,fast=0,crackle=0;
      for(let i=0;i<data.length;i++){
        const white=random()*2-1,t=i/c.sampleRate;
        brown=.997*brown+.035*white;
        slow=.98*slow+.02*white;mid=.85*mid+.15*white;fast=.5*fast+.5*white;
        const pink=slow*2.5+mid*.8+fast*.3+white*.08;
        crackle*=.985;if(random()<.0007)crackle=.3+random()*.7;
        let value=kind==='rain'?white*.45+fast*.2:kind==='brown'?brown*2.5:kind==='pink'?pink:
          kind==='ocean'?pink*(.25+.75*Math.sin(t*Math.PI/8)**2):
          kind==='wind'?(mid-slow)*1.8*(.4+.6*Math.sin(t*Math.PI/4)**2):brown*.4+white*crackle;
        // Short seam fades prevent a discontinuity in the bounded generated loop.
        const seam=Math.min(1,i/(c.sampleRate*.03),(data.length-1-i)/(c.sampleRate*.03));
        data[i]=Math.tanh(value)*seam;
      }
      const source=this.source(c.createBufferSource()),gain=this.node(c.createGain());
      source.buffer=buffer;source.loop=true;gain.gain.value=this.settings.ambience===kind?this.settings.ambienceVolume*.24:0;
      source.connect(gain);gain.connect(this.master);source.start(origin);
      this.textures.push({kind,gain:gain.gain});
    }
  }
  voice(frequency, start, length, gain, type='sine', bass=false, pan=0, melody=false){
    const c=this.context,envelope=this.node(c.createGain()),panner=this.node(c.createStereoPanner());
    const local=[envelope,panner],oscillators=[],mixes=[];
    panner.pan.value=pan;
    const detune=bass?0:(this.random()-.5)*character[this.settings.style].detune;
    for(const kind of bass?['sine']:SYNTHS){
      const oscillator=this.source(c.createOscillator()),mix=this.node(c.createGain());
      oscillator.frequency.value=frequency;oscillator.detune.value=detune;
      if(kind==='organ')oscillator.setPeriodicWave(this.organWave);
      else oscillator.type=kind==='triangle'?'triangle':'sine';
      if(!bass)this.wowDepth.connect(oscillator.detune);
      mix.gain.value=bass||this.settings.synth===kind?1:0;
      oscillator.connect(mix);mix.connect(envelope);local.push(oscillator,mix);oscillators.push(oscillator);mixes.push({kind,gain:mix.gain});
      if(kind==='fm'){
        const mod=this.source(c.createOscillator()),depth=this.node(c.createGain());
        mod.frequency.value=frequency*2;depth.gain.value=frequency*.65;
        mod.connect(depth);depth.connect(oscillator.frequency);local.push(mod,depth);oscillators.push(mod);
      }
    }
    const attack=Math.min(length*.25,bass?.8:melody?.08:character[this.settings.style].attack),end=start+length;
    envelope.gain.setValueAtTime(0,start);envelope.gain.linearRampToValueAtTime(gain,start+attack);
    envelope.gain.setValueAtTime(gain*.8,start+length*.55);envelope.gain.linearRampToValueAtTime(0,end);
    envelope.connect(panner);panner.connect(bass?this.bass:melody?this.melody:this.music);
    const record={mixes,bass};this.voices.add(record);
    oscillators[0].onended=()=>{
      for(const oscillator of oscillators)if(!bass){try{this.wowDepth.disconnect(oscillator.detune);}catch{/* Not a carrier. */}}
      for(const n of local){n.disconnect();this.nodes.delete(n);this.sources.delete(n);}this.voices.delete(record);
    };
    for(const oscillator of oscillators){oscillator.start(start);oscillator.stop(end+.02);}
  }
  schedule(until){
    const s=this.settings,preset=character[s.style];
    while(this.nextChord<until){
      const time=this.nextChord, roots=[57,53,60,55,58,53,62,55];
      const root=roots[(this.chordIndex+Math.floor(this.chordIndex/8))%roots.length];
      // Voicing and timing evolve continuously; no fixed audio or phrase loop.
      const inversion=this.random()>.55?12:0;
      [0,7,12,15].forEach((interval,i)=>{
        const note=Math.max(57,root+interval+(i===0?inversion:0)+(s.style==='glass'?12:s.style==='deep'?-12:0));
        this.voice(midi(Math.min(95,note)),time+i*(s.mode==='focus'?.0625:.09),preset.length+this.random(),.065,'sine',false,(i-1.5)*.22);
      });
      this.voice(midi(root-24),time,13,.075,'sine',true);
      // Focus events share a 60 BPM clock; 16 Hz is sixteen cycles per beat.
      this.chordIndex++;this.nextChord+=s.mode==='focus'?preset.chord:preset.chord+(this.random()-.5)*.5;
    }
    while(this.nextNote<until){
      const sleep=s.mode==='sleep', step=(sleep?2:preset.step)*2**(1-2*s.density);
      if(this.random()>(sleep?.7:.33)){
        const degrees=[0,3,5,7,10,12,15],note=57+degrees[Math.floor(this.random()*degrees.length)];
        this.voice(midi(note),this.nextNote, s.style==='lofi'?1.4:3.8,
          s.style==='deep'?.012:.032, s.style==='lofi'?'triangle':'sine',false,(this.random()-.5)*.85,true);
      }
      this.nextNote+=step;
    }
  }
  update(settings){
    this.settings=normalizeSettings(settings);const s=this.settings,t=this.context.currentTime;
    const held=this.holdMaster(t);this.master.gain.linearRampToValueAtTime(this.outputLevel(),t+.36);
    this.masterAutomation={time:t,start:held,value:this.outputLevel(),end:t+.36};
    tune(this.modBus.gain,1-s.intensity/2,t);
    tune(this.lfoDepth.gain,s.intensity/2,t);tune(this.lfo.frequency,s.rateHz,t);
    tune(this.toneFilter.frequency,this.cutoff(),t,.5);
    tune(this.music.gain,s.musicVolume,t);tune(this.bass.gain,s.bassVolume,t);tune(this.melody.gain,s.melodyVolume,t);
    tune(this.wet.gain,s.space*.48,t,.3);
    for(const entry of this.widthGains)tune(entry.gain,(1+entry.sign*s.stereo)/2,t);
    for(const texture of this.textures)tune(texture.gain,s.ambience===texture.kind?s.ambienceVolume*.24:0,t,.3);
    for(const voice of this.voices)if(!voice.bass)for(const mix of voice.mixes)tune(mix.gain,mix.kind===s.synth?1:0,t);
    tune(this.wowDepth.gain,s.style==='tape'?8:s.style==='drift'?3:0,t,.5);
  }
  fadeOut(at,seconds=.8){
    const held=this.holdMaster(at);this.master.gain.linearRampToValueAtTime(0,at+seconds);
    this.masterAutomation={time:at,start:held,value:0,end:at+seconds};
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
  getVisualizationData(){
    if(!this.graph)return new Uint8Array(0);
    this.graph.analyser.getByteTimeDomainData(this.graph.visualization);return this.graph.visualization;
  }
  getState(){
    const elapsed=this.elapsed+(this.playing?Math.max(0,this.context.currentTime-this.startedAt):0);
    // An OS/browser suspension is not active playback. Resume needs another user gesture.
    return {playing:this.playing&&this.context?.state==='running',elapsed,error:this.error};
  }
}
